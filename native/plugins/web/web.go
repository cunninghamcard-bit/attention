// Package web is the web viewer (RFC 0001 roadmap P3): a tab type for
// http(s) pages over mygo's WebView, a port of attention's WebViewerView
// (apps/web/builtin/webviewer/WebViewerPlugin.ts), and the CLI's web
// (apps/web/app/cli/commands/wordcountWebCli.ts).
//
// The page's address shows in the sidebar's address bar, with a reload
// button before it; Back and Forward are the tab's own history,
// which the page's navigations join (handleCommittedNavigation).
//
// Reader view shows the page's article as markdown
// (WebViewerReader.extractFromPage), from the page as it is in the web
// view, through internal/htmlextract.
//
// Left out for now: the address suggestions, the context menu, sessions.
package web

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"regexp"
	"strings"

	"github.com/arcships/rutis/go/rutis"
	"github.com/egoist/mygo"
	"github.com/egoist/mygo/ui"
	"github.com/egoist/mygo/ui/markdown"

	"github.com/cunninghamcard-bit/attention/native/internal/htmlextract"
	"github.com/cunninghamcard-bit/attention/native/plugins/actions"
	"github.com/cunninghamcard-bit/attention/native/plugins/bookmarks"
	"github.com/cunninghamcard-bit/attention/native/plugins/settings"
	"github.com/cunninghamcard-bit/attention/native/plugins/shell"
	"github.com/cunninghamcard-bit/attention/native/plugins/slots"
	"github.com/cunninghamcard-bit/attention/native/plugins/tabtypes"
	"github.com/cunninghamcard-bit/attention/native/plugins/webhistory"
	"github.com/cunninghamcard-bit/attention/native/plugins/workspace"
	aui "github.com/cunninghamcard-bit/attention/native/ui"
	"github.com/cunninghamcard-bit/attention/native/ui/icon"
)

const (
	// ID is the type's id; Kind its kind (WEBVIEWER_VIEW_TYPE).
	ID   = "web"
	Kind = "webviewer"

	// PageLoadedEvent is emitted by the web plugin when a page finished
	// loading, with its Page.
	PageLoadedEvent = "web/page-loaded"

	// configFile is the web viewer's settings file (its plugin data,
	// webviewer.json).
	configFile = "webviewer"
)

var (
	scheme = regexp.MustCompile(`(?i)^(https?|file|about):`)
	domain = regexp.MustCompile(`(?i)^[\w.-]+\.[a-z]{2,}(?:/.*)?$`)

	// Plugin registers the web tab type and its commands while loaded.
	Plugin = rutis.Define(rutis.Plugin[struct{}]{
		Name:     ID,
		Inject:   []string{"shell", "slots", "tabTypes", "workspace", "actions", "settings"},
		Optional: []string{"bookmarks", "web-history"},
		Apply: func(rctx *rutis.Ctx, _ struct{}) error {
			var (
				sh  *shell.Shell
				sl  *slots.Registry
				tt  *tabtypes.Registry
				ws  *workspace.Workspace
				act *actions.Service
				set *settings.Settings
			)
			if err := rctx.Use("shell", &sh); err != nil {
				return err
			}
			if err := rctx.Use("slots", &sl); err != nil {
				return err
			}
			if err := rctx.Use("tabTypes", &tt); err != nil {
				return err
			}
			if err := rctx.Use("workspace", &ws); err != nil {
				return err
			}
			if err := rctx.Use("actions", &act); err != nil {
				return err
			}
			if err := rctx.Use("settings", &set); err != nil {
				return err
			}
			v := &viewer{
				sh: sh, sl: sl, tt: tt, ws: ws, act: act, set: set,
				bm: func() *bookmarks.Bookmarks {
					var b *bookmarks.Bookmarks
					_, _ = rctx.Get("bookmarks", &b)
					return b
				},
				hist: func() *webhistory.History {
					var h *webhistory.History
					_, _ = rctx.Get("web-history", &h)
					return h
				},
				pages: map[int]*page{},
			}
			set.Load(configFile)
			// A service of no methods: who injects it hears its events
			// (web-index, PageLoadedEvent).
			rctx.Provide("web", struct{}{})
			emitCtx, cancel := context.WithCancel(context.Background())
			off := v.register(func(p Page) { _ = rctx.Emit(emitCtx, PageLoadedEvent, p) })
			offs := []func(){
				sl.RegisterSettingsSection(slots.SettingsSection{ID: "webviewer", Title: "Web viewer", Icon: icon.Must("globe"),
					Group: slots.CorePlugins, Keywords: []string{"Search engine", "Clear browsing data", "history"}, View: v.settingTab}),
				sl.RegisterPaletteSource(v.source()),
			}
			for _, cmd := range v.commands() {
				offs = append(offs, act.Add(cmd))
			}
			rctx.Effect(func(context.Context) error {
				for _, o := range offs {
					o()
				}
				cancel()
				sh.Update(off)
				return nil
			})
			return nil
		},
	})
)

// Page is a loaded page's article (internal/htmlextract), as markdown.
type Page struct {
	URL      string `json:"url"`
	Title    string `json:"title"`
	Markdown string `json:"markdown"`
}

// page is a tab's web view and what its header shows.
type page struct {
	view    *mygo.WebView
	err     string // the last failed load's, until the next navigation
	typed   string // the address bar's text
	shown   string // the address the bar last showed
	offs    []func()
	loading bool
	// reader is the article Reader view shows, nil for the page;
	// extracting is set while it is made.
	reader     *htmlextract.Result
	md         markdown.Options
	extracting bool
	focusBar   bool // Focus address bar asked for the caret
	// The address bar's suggestions (suggest.go): shown, the list shown
	// last, the highlighted one; whether the bar had the caret, and the
	// text it last held.
	suggesting bool
	suggested  []suggestion
	selected   int
	barFocused bool
	lastTyped  string
	// The find bar: shown, its text, the matches for found, and whether
	// it should take the caret.
	finding   bool
	query     string
	found     string
	res       mygo.FindResult
	findFocus bool
	// downloaded is the last download's file, or why it failed.
	downloaded *mygo.Download
}

type viewer struct {
	sh    *shell.Shell
	sl    *slots.Registry
	tt    *tabtypes.Registry
	ws    *workspace.Workspace
	act   *actions.Service
	set   *settings.Settings
	bm    func() *bookmarks.Bookmarks
	hist  func() *webhistory.History
	pages map[int]*page
}

// activePage is the active tab's page, nil when it shows no web page.
func (v *viewer) activePage() *page {
	if v.ws == nil {
		return nil
	}
	info, ok := v.ws.ActiveTab()
	if !ok || info.Kind != Kind {
		return nil
	}
	return v.pages[info.ID]
}

func (v *viewer) normalizeURL(input string) string {
	return normalizeURL(input, v.searchEngine())
}

// register adds the web tab type until off is called.
// loaded, when set, takes each page that finished loading: its article
// (PageLoadedEvent).
func (v *viewer) register(loaded func(Page)) (off func()) {
	get := func(p tabtypes.Props) *page {
		pg, ok := v.pages[p.Info.ID]
		if ok {
			return pg
		}
		pg = &page{typed: p.Info.Address, shown: p.Info.Address}
		v.pages[p.Info.ID] = pg
		w := v.sh.Window()
		if w == nil {
			pg.err = "No window to show the page in."
			return pg
		}
		wv, err := w.NewWebView(mygo.WebViewOptions{URL: p.Info.Address})
		if err != nil {
			pg.err = err.Error()
			return pg
		}
		pg.view = wv
		pg.loading = true
		id, retarget, setTitle := p.Info.ID, p.Retarget, p.SetTitle
		live := func() bool { return v.pages[id] == pg }
		// commit is handleCommittedNavigation: the tab moves to where the
		// page went, the address it showed kept in its history.
		commit := func(address string) {
			// A blob:, data: or javascript: page is no address a tab keeps.
			if !live() || !tabtypes.WebAddress(address) {
				return
			}
			pg.err = ""
			// The same page, the server's slash added, is no step to keep.
			if strings.TrimSuffix(address, "/") != strings.TrimSuffix(pg.shown, "/") {
				pg.reader = nil // reader mode is per page (exitReaderMode)
				pg.found, pg.res = "", mygo.FindResult{}
				retarget(address, titleFromURL(address))
			}
			v.record(address, "")
		}
		pv := wv.Page()
		pg.offs = append(pg.offs,
			pv.OnDidNavigate(func(address string) {
				v.sh.Update(func() { pg.loading = true; commit(address) })
			}),
			pv.OnPageTitleUpdated(func(e *mygo.TitleEvent) {
				e.PreventDefault() // the window's title is the workspace's
				title := e.Title
				address := pv.URL()
				v.sh.Update(func() {
					// A page that moved itself (history.pushState) says so
					// only by its URL.
					commit(address)
					if live() && title != "" {
						setTitle(title)
						v.record(address, title)
					}
				})
			}),
			pv.OnDownloadDone(func(d *mygo.Download) {
				v.sh.Update(func() { pg.downloaded = d })
			}),
			pv.OnDidFinishLoad(func() {
				v.sh.Update(func() { pg.loading = false })
				if loaded != nil {
					go announce(pv, loaded)
				}
			}),
			pv.OnDidFailLoad(func(e *mygo.LoadError) {
				v.sh.Update(func() {
					pg.loading = false
					// A cancelled load is a navigation going on (ERR_ABORTED).
					if live() && !strings.Contains(strings.ToLower(e.Description), "cancel") {
						pg.err = e.Description
					}
				})
			}),
		)
		// A link that asks for another window opens in a new tab.
		pv.SetWindowOpenHandler(func(req mygo.WindowOpenRequest) *mygo.WindowOptions {
			v.sh.Update(func() {
				if v.ws != nil && tabtypes.WebAddress(req.URL) {
					_ = v.ws.OpenResource(req.URL, workspace.OpenOptions{NewTab: true})
				}
			})
			return nil
		})
		return pg
	}
	return v.tt.Register(tabtypes.TabType{
		ID: ID, Kind: Kind, Priority: tabtypes.Builtin,
		Patterns: []string{"https://**", "http://**", "about:**"},
		Title:    titleFromURL,
		Icon:     icon.Must("globe"),
		Body: func(c *ui.Context, p tabtypes.Props) {
			pg := get(p)
			ui.Column(c).Grow(1).Fill().Children(func() {
				if pg.finding {
					v.findBar(c, pg)
				}
				if pg.err != "" {
					errorBanner(c, pg.err)
				}
				if pg.downloaded != nil {
					downloadBanner(c, pg)
				}
				// Reader view covers the web view rather than take its place:
				// the native view hidden and shown again at each switch
				// left its last picture behind for a moment.
				ui.Box(c).Grow(1).FillWidth().Children(func() {
					if pg.view != nil {
						ui.WebView(c, pg.view).Fill()
					}
					if pg.reader != nil {
						pg.md.OnLink = func(u string) { v.navigate(pg, p, u) }
						ui.Scroll(c).Key(fmt.Sprintf("reader-%d", p.Info.ID)).Absolute().Top(0).Left(0).Right(0).Bottom(0).
							Background(c.Theme().Background).Children(func() {
							ui.Column(c).PaddingX(48).PaddingY(32).MaxWidth(860).FillWidth().Children(func() {
								markdown.View(c, "# "+pg.reader.Title+"\n\n"+pg.reader.Markdown, &pg.md)
							})
						})
					}
				})
			})
		},
		Header: func(c *ui.Context, p tabtypes.Props) {
			pg := get(p)
			t := c.Theme()
			ui.Row(c).Grow(1).MinWidth(0).Gap(4).AlignItems(ui.Center).Children(func() {
				label, glyph := "Reload", icon.Must("rotate-cw")
				if pg.loading {
					label, glyph = "Stop", icon.Must("x")
				}
				aui.Button(c, aui.ButtonProps{Label: label, Icon: glyph, Variant: aui.ButtonGhost, Size: aui.ButtonIconSmall,
					IconColor: t.Text, OnClick: func() {
						if pg.view == nil {
							return
						}
						if pg.loading {
							pg.view.Page().Stop()
							pg.loading = false
						} else {
							reload(pg)
						}
					}})
				field := aui.Field(c, &pg.typed, "Search or enter address", false).Label("Address").Grow(1).MinWidth(0)
				// The bar follows the page while it is not being typed in
				// (syncAddressInput).
				if p.Info.Address != pg.shown {
					pg.shown = p.Info.Address
					if !field.Focused() {
						pg.typed = p.Info.Address
					}
				}
				if p.Info.Address == "about:blank" && pg.typed == "about:blank" {
					pg.typed = ""
					field.Focus() // a new page puts the caret in the bar (displayBlank)
				}
				if pg.focusBar {
					pg.focusBar = false
					field.Focus()
				}
				// The suggestions open as the bar takes the caret, and again
				// as its text changes.
				focused := field.Focused()
				if focused && (!pg.barFocused || pg.typed != pg.lastTyped) {
					pg.suggesting, pg.selected = true, 0
				}
				pg.barFocused, pg.lastTyped = focused, pg.typed
				open := func(u string) {
					v.navigate(pg, p, u)
					// The bar now shows where it went: no text typed.
					pg.suggesting, pg.lastTyped = false, pg.typed
				}
				if field.Submitted() {
					// Enter belongs to the suggestions while they show.
					if pg.suggesting && pg.selected >= 0 && pg.selected < len(pg.suggested) {
						open(pg.suggested[pg.selected].url)
					} else {
						open(pg.typed)
					}
				}
				v.suggestPanel(c, pg, field, open)
			})
		},
		Actions: func(c *ui.Context, p tabtypes.Props) {
			pg := get(p)
			label := "Reader view"
			if pg.reader != nil {
				label = "Web view"
			}
			aui.Button(c, aui.ButtonProps{Label: label, Icon: icon.Must("glasses"), Variant: aui.ButtonGhost, Size: aui.ButtonIconSmall,
				Disabled: pg.view == nil || pg.extracting, OnClick: func() { v.toggleReader(pg) }}).Tooltip(label)
		},
		Closed: func(id int) {
			pg := v.pages[id]
			if pg == nil {
				return
			}
			delete(v.pages, id)
			for _, off := range pg.offs {
				off()
			}
			if pg.view != nil {
				pg.view.Destroy()
			}
		},
	})
}

// searchEngine is the Search engine setting: "duckduckgo" or "google".
func (v *viewer) searchEngine() string {
	engine := "duckduckgo"
	if v.set != nil {
		v.set.Get(configFile, "searchEngine", &engine)
	}
	return engine
}

// settingTab is the Web viewer settings tab (WebViewerSettingTab): Search
// engine, and Clear browsing data for the history. Opening external URLs,
// ad blocking, the save path and sessions are not ported.
func (v *viewer) settingTab(c *ui.Context) {
	aui.SettingsSection(c, "Web viewer", func() {
		aui.PreferenceRow(c, "Search engine", "Used when the address bar input is not a URL.", func() {
			cur := v.searchEngine()
			val := cur
			aui.Select(c, aui.SelectProps{Key: "web-search-engine", Value: &val, Width: 160, Options: []aui.SelectOption{
				{Value: "duckduckgo", Label: "DuckDuckGo"}, {Value: "google", Label: "Google"},
			}})
			if val != cur && v.set != nil {
				v.set.Set(configFile, "searchEngine", val)
			}
		})
		aui.PreferenceRow(c, "Clear browsing data", "Clear local Web viewer history.", func() {
			var h *webhistory.History
			if v.hist != nil {
				h = v.hist()
			}
			aui.Button(c, aui.ButtonProps{Label: "Clear history", Variant: aui.ButtonSecondary, Disabled: h == nil || len(h.List()) == 0,
				OnClick: func() { h.Clear() }})
		})
	})
}

// record notes a visit in the web history, when one is loaded
// (WebViewerService.recordHistory).
func (v *viewer) record(address, title string) {
	if v.hist == nil || !tabtypes.WebAddress(address) {
		return
	}
	if h := v.hist(); h != nil {
		h.Record(address, title)
	}
}

// navigate is WebViewerView.navigate: the page loads what the bar names,
// the address it showed kept in the tab's history.
func (v *viewer) navigate(pg *page, p tabtypes.Props, input string) {
	address := v.normalizeURL(input)
	pg.typed = address
	if pg.view == nil || address == p.Info.Address {
		return
	}
	pg.err, pg.loading, pg.shown, pg.reader = "", true, address, nil
	p.Retarget(address, titleFromURL(address))
	if err := pg.view.Page().LoadURL(address); err != nil {
		pg.err, pg.loading = err.Error(), false
	}
}

// toggleReader leaves Reader view, or enters it: the article of the page
// as the web view has it, so a page its scripts made or a login shows
// reads too.
func (v *viewer) toggleReader(pg *page) {
	if pg.reader != nil {
		pg.reader = nil
		return
	}
	if pg.view == nil || pg.extracting {
		return
	}
	pg.extracting = true
	pv, from := pg.view.Page(), pg.shown
	go func() {
		var r htmlextract.Result
		val, err := pv.Eval("document.documentElement.outerHTML")
		html, _ := val.(string)
		if err == nil {
			r, err = htmlextract.Extract([]byte(html), pv.URL())
		}
		v.sh.Update(func() {
			pg.extracting = false
			debugf("web: reader %s: %q, %d bytes, err %v", from, r.Title, len(r.Markdown), err)
			if err != nil {
				pg.err = err.Error()
				return
			}
			if pg.shown == from { // not since gone elsewhere
				pg.reader = &r
			}
		})
	}()
}

// findBar is the page's find bar, as Obsidian's document search bar: the
// text, which match of how many, previous, next, close. Enter goes to the
// next match, Shift Enter the previous, Escape closes it.
func (v *viewer) findBar(c *ui.Context, pg *page) {
	t := c.Theme()
	ui.Row(c).Padding(4, 8).Gap(4).AlignItems(ui.Center).Background(t.Surface).BorderWidth(0, 0, 1, 0).BorderColor(t.Border).Children(func() {
		field := aui.Field(c, &pg.query, "Find...", false).Label("Find in page").Width(260)
		if pg.findFocus {
			pg.findFocus = false
			field.Focus()
		}
		focused := field.Focused()
		switch {
		case focused && c.Shortcut(0, ui.KeyEscape):
			closeFind(pg)
			return
		case focused && c.Shortcut(ui.Shift, ui.KeyEnter):
			v.find(pg, true)
		case field.Submitted():
			v.find(pg, false)
		case pg.query != pg.found:
			v.find(pg, false)
		}
		count := ""
		switch {
		case pg.found == "":
		case pg.res.Matches == 0:
			count = "No results"
		default:
			count = fmt.Sprintf("%d / %d", pg.res.Active, pg.res.Matches)
		}
		ui.Text(c, count).FontSize(12).TextColor(t.TextMuted).Shrink(0)
		ui.Box(c).Grow(1)
		button := func(label string, icon *ui.SVG, fn func()) {
			aui.Button(c, aui.ButtonProps{Label: label, Icon: icon, Variant: aui.ButtonGhost, Size: aui.ButtonIconSmall,
				IconColor: t.Text, OnClick: fn}).Tooltip(label)
		}
		button("Previous", icon.Must("arrow-up"), func() { v.find(pg, true) })
		button("Next", icon.Must("arrow-down"), func() { v.find(pg, false) })
		button("Close", icon.Must("x"), func() { closeFind(pg) })
	})
}

// find highlights pg.query in the page: the next match, or the previous
// one with back; the search starts over when the text changed.
func (v *viewer) find(pg *page, back bool) {
	if pg.view == nil {
		return
	}
	q, again := pg.query, pg.query == pg.found
	pg.found = q
	pv := pg.view.Page()
	if q == "" {
		pg.res = mygo.FindResult{}
		go pv.StopFindInPage()
		return
	}
	go func() {
		res, err := pv.FindInPage(q, mygo.FindOptions{Backward: back, FindNext: again})
		v.sh.Update(func() {
			if err == nil && pg.found == q {
				pg.res = res
			}
		})
	}()
}

// cliWeb is `web url=<url> [newtab]` (registerWebCliHandlers): a URL with
// no scheme goes over https.
func (v *viewer) cliWeb(ctx context.Context, a actions.Args) (string, error) {
	address := a.Params["url"]
	if address == "" {
		return "", fmt.Errorf("Missing required parameter: url\nUsage: web url=<url>")
	}
	if !strings.Contains(address, "://") {
		address = "https://" + address
	}
	newTab := a.Has("newtab")
	return shell.OnMain(ctx, v.sh, func() (string, error) {
		if v.ws == nil {
			return "", fmt.Errorf("No workspace to open %s in.", address)
		}
		if err := v.ws.OpenResource(address, workspace.OpenOptions{Kind: Kind, NewTab: newTab}); err != nil {
			return "", err
		}
		return "Opened: " + address, nil
	})
}

// onPage is a command on the active tab's web page, which does nothing on
// another tab (the TS controller's activeView).
func (v *viewer) onPage(id, title, keys string, fn func(pg *page)) actions.Command {
	main := func() {
		if pg := v.activePage(); pg != nil {
			fn(pg)
		}
	}
	return actions.Command{ID: id, Title: title, Keys: keys, CLI: true, Main: main,
		Run: func(ctx context.Context, _ actions.Args) (string, error) {
			return shell.OnMain(ctx, v.sh, func() (string, error) { main(); return "", nil })
		}}
}

// openBlank is Open Web viewer: a new tab on the blank page, its caret in
// the address bar.
func (v *viewer) openBlank() {
	if v.ws != nil {
		_ = v.ws.OpenResource("about:blank", workspace.OpenOptions{Kind: Kind, NewTab: true})
	}
}

// commands are the web viewer's (WebViewerPlugin's registerGlobalCommand).
func (v *viewer) commands() []actions.Command {
	return []actions.Command{
		{ID: "web", CLI: true, Flags: []string{"newtab"}, Run: v.cliWeb},
		{ID: "webviewer:open", Title: "Open Web viewer", Main: v.openBlank, CLI: true,
			Run: func(ctx context.Context, _ actions.Args) (string, error) {
				return shell.OnMain(ctx, v.sh, func() (string, error) { v.openBlank(); return "", nil })
			}},
		v.onPage("webviewer:refresh", "Refresh page", "Ctrl R", reload),
		v.onPage("webviewer:toggle-reader-mode", "Toggle reader mode", "", v.toggleReader),
		v.onPage("webviewer:find", "Find in page", "Ctrl F", func(pg *page) { pg.finding, pg.findFocus = true, true }),
		v.onPage("webviewer:focus-address-bar", "Focus address bar", "", func(pg *page) { pg.focusBar = true }),
	}
}

// DecodePage is an event's Page, in process or across one.
func DecodePage(arg any) (Page, error) {
	if p, ok := arg.(Page); ok {
		return p, nil
	}
	data, err := json.Marshal(arg)
	if err != nil {
		return Page{}, err
	}
	var p Page
	err = json.Unmarshal(data, &p)
	return p, err
}

// NormalizeURL is what the address bar opens for input
// (WebViewerService.normalizeUrl): the blank page for nothing, a URL as
// it is, a domain over https, anything else a search.
func NormalizeURL(input string) string {
	return normalizeURL(input, "duckduckgo")
}

func normalizeURL(input, engineName string) string {
	s := strings.TrimSpace(input)
	switch {
	case s == "":
		return "about:blank"
	case scheme.MatchString(s):
		return s
	case domain.MatchString(s):
		return "https://" + s
	}
	engine := "https://duckduckgo.com/?q="
	if engineName == "google" {
		engine = "https://www.google.com/search?q="
	}
	return engine + url.QueryEscape(s)
}

// titleFromURL is a page's title until its own comes: its host.
func titleFromURL(address string) string {
	if u, err := url.Parse(address); err == nil && u.Hostname() != "" {
		return u.Hostname()
	}
	return address
}

// announce hands loaded the article of the page pv shows, an http(s) one.
// Off the main thread.
func announce(pv *mygo.Page, loaded func(Page)) {
	address := pv.URL()
	if !strings.HasPrefix(address, "http://") && !strings.HasPrefix(address, "https://") {
		return
	}
	v, err := pv.Eval("document.documentElement.outerHTML")
	html, _ := v.(string)
	if err != nil || html == "" {
		return
	}
	r, err := htmlextract.Extract([]byte(html), address)
	if err != nil {
		debugf("web: no article for %s: %v", address, err)
		return
	}
	loaded(Page{URL: address, Title: r.Title, Markdown: r.Markdown})
}

func closeFind(pg *page) {
	pg.finding, pg.found, pg.res = false, "", mygo.FindResult{}
	if pg.view != nil {
		go pg.view.Page().StopFindInPage()
	}
}

// downloadBanner says where the last download went, or why it failed.
func downloadBanner(c *ui.Context, pg *page) {
	t := c.Theme()
	d := pg.downloaded
	ui.Row(c).Padding(4, 12).Gap(8).AlignItems(ui.Center).Background(t.Surface).BorderWidth(0, 0, 1, 0).BorderColor(t.Border).Children(func() {
		glyph, color, text := icon.Must("download"), t.TextMuted, "Downloaded "+d.Path
		if d.Err != nil {
			glyph, color, text = icon.Must("triangle-alert"), t.Danger, "Download failed: "+d.Err.Error()
		}
		ui.Icon(c, glyph).Size(14, 14).TextColor(color).Shrink(0)
		ui.Text(c, text).FontSize(12).SingleLine().Ellipsis("…").Shrink(1)
		ui.Box(c).Grow(1)
		if d.Err == nil {
			aui.Button(c, aui.ButtonProps{Label: "Show in folder", Variant: aui.ButtonGhost,
				OnClick: func() { go mygo.Shell.ShowItemInFolder(d.Path) }})
		}
		aui.Button(c, aui.ButtonProps{Label: "Dismiss", Icon: icon.Must("x"), Variant: aui.ButtonGhost, Size: aui.ButtonIconSmall,
			IconColor: t.Text, OnClick: func() { pg.downloaded = nil }})
	})
}

func errorBanner(c *ui.Context, text string) {
	t := c.Theme()
	ui.Row(c).Padding(6, 12).Gap(8).AlignItems(ui.Center).Background(t.Surface).BorderWidth(0, 0, 1, 0).BorderColor(t.Border).Children(func() {
		ui.Icon(c, icon.Must("triangle-alert")).Size(14, 14).TextColor(t.Danger)
		ui.Text(c, text).FontSize(12)
	})
}

// reload is the reload button's Reload.
func reload(pg *page) {
	if pg.view != nil {
		pg.err, pg.loading = "", true
		pg.view.Page().Reload()
	}
}

func debugf(format string, a ...any) {
	if os.Getenv("ATTENTION_DEBUG") != "" {
		fmt.Fprintf(os.Stderr, "[debug] "+format+"\n", a...)
	}
}
