// Package web is the web viewer (RFC 0001 roadmap P3): a tab type for
// http(s) pages over mygo's WebView, a port of attention's WebViewerView
// (apps/web/builtin/webviewer/WebViewerPlugin.ts), and the CLI's web
// (apps/web/app/cli/commands/wordcountWebCli.ts).
//
// The address bar takes the place of the title in the view header, with a
// reload button before it; Back and Forward are the tab's own history,
// which the page's navigations join (handleCommittedNavigation).
//
// Left out for now: reader mode, the address suggestions, the context menu,
// sessions.
package web

import (
	"context"
	"fmt"
	"net/url"
	"regexp"
	"strings"

	"github.com/arcships/rutis/go/rutis"
	"github.com/egoist/mygo"
	"github.com/egoist/mygo/ui"
	"github.com/smallnest/uix/components/lucide"

	omgui "github.com/cunninghamcard-bit/attention-ui/ui"
	"github.com/cunninghamcard-bit/attention/native/actionsapi"
	"github.com/cunninghamcard-bit/attention/native/shellapi"
	"github.com/cunninghamcard-bit/attention/native/tabtypesapi"
	"github.com/cunninghamcard-bit/attention/native/workspaceapi"
)

// ID is the type's id; Kind its kind (WEBVIEWER_VIEW_TYPE).
const (
	ID   = "web"
	Kind = "webviewer"
)

// page is a tab's web view and what its header shows.
type page struct {
	view    *mygo.WebView
	err     string // the last failed load's, until the next navigation
	typed   string // the address bar's text
	shown   string // the address the bar last showed
	offs    []func()
	loading bool
}

var (
	scheme = regexp.MustCompile(`(?i)^(https?|file|about):`)
	domain = regexp.MustCompile(`(?i)^[\w.-]+\.[a-z]{2,}(?:/.*)?$`)
)

// NormalizeURL is what the address bar opens for input
// (WebViewerService.normalizeUrl): the blank page for nothing, a URL as
// it is, a domain over https, anything else a search.
func NormalizeURL(input string) string {
	s := strings.TrimSpace(input)
	switch {
	case s == "":
		return "about:blank"
	case scheme.MatchString(s):
		return s
	case domain.MatchString(s):
		return "https://" + s
	}
	return "https://duckduckgo.com/?q=" + url.QueryEscape(s)
}

// titleFromURL is a page's title until its own comes: its host.
func titleFromURL(address string) string {
	if u, err := url.Parse(address); err == nil && u.Hostname() != "" {
		return u.Hostname()
	}
	return address
}

// Register adds the web tab type until off is called.
func Register() (off func()) {
	pages := map[int]*page{}
	get := func(p tabtypesapi.Props) *page {
		pg, ok := pages[p.Info.ID]
		if ok {
			return pg
		}
		pg = &page{typed: p.Info.Address, shown: p.Info.Address}
		pages[p.Info.ID] = pg
		w := shellapi.Window()
		if w == nil {
			pg.err = "No window to show the page in."
			return pg
		}
		v, err := w.NewWebView(mygo.WebViewOptions{URL: p.Info.Address})
		if err != nil {
			pg.err = err.Error()
			return pg
		}
		pg.view = v
		pg.loading = true
		id, retarget, setTitle := p.Info.ID, p.Retarget, p.SetTitle
		live := func() bool { return pages[id] == pg }
		// commit is handleCommittedNavigation: the tab moves to where the
		// page went, the address it showed kept in its history.
		commit := func(address string) {
			if !live() || address == "" {
				return
			}
			pg.err = ""
			// The same page, the server's slash added, is no step to keep.
			if strings.TrimSuffix(address, "/") == strings.TrimSuffix(pg.shown, "/") {
				return
			}
			if address != pg.shown {
				retarget(address, titleFromURL(address))
			}
		}
		pv := v.Page()
		pg.offs = append(pg.offs,
			pv.OnDidNavigate(func(address string) {
				shellapi.Update(func() { pg.loading = true; commit(address) })
			}),
			pv.OnPageTitleUpdated(func(e *mygo.TitleEvent) {
				e.PreventDefault() // the window's title is the workspace's
				title := e.Title
				address := pv.URL()
				shellapi.Update(func() {
					// A page that moved itself (history.pushState) says so
					// only by its URL.
					commit(address)
					if live() && title != "" {
						setTitle(title)
					}
				})
			}),
			pv.OnDidFinishLoad(func() { shellapi.Update(func() { pg.loading = false }) }),
			pv.OnDidFailLoad(func(e *mygo.LoadError) {
				shellapi.Update(func() {
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
			shellapi.Update(func() {
				if ws := workspaceapi.Get(); ws != nil && tabtypesapi.WebAddress(req.URL) {
					_ = ws.OpenResource(req.URL, workspaceapi.OpenOptions{NewTab: true})
				}
			})
			return nil
		})
		return pg
	}
	return tabtypesapi.Register(tabtypesapi.TabType{
		ID: ID, Kind: Kind, Priority: tabtypesapi.Builtin,
		Patterns: []string{"https://**", "http://**", "about:**"},
		Title:    titleFromURL,
		Icon:     lucide.Globe(),
		Body: func(c *ui.Context, p tabtypesapi.Props) {
			pg := get(p)
			ui.Column(c).Grow(1).Fill().Children(func() {
				if pg.err != "" {
					errorBanner(c, pg.err)
				}
				if pg.view != nil {
					ui.WebView(c, pg.view).Grow(1).FillWidth()
				}
			})
		},
		Header: func(c *ui.Context, p tabtypesapi.Props) {
			pg := get(p)
			t := c.Theme()
			ui.Row(c).Grow(1).MinWidth(0).Gap(4).AlignItems(ui.Center).Children(func() {
				label, icon := "Reload", lucide.RotateCw()
				if pg.loading {
					label, icon = "Stop", lucide.X()
				}
				omgui.Button(c, omgui.ButtonProps{Label: label, Icon: icon, Variant: omgui.ButtonGhost, Size: omgui.ButtonIconSmall,
					IconColor: t.Text, OnClick: func() {
						if pg.view == nil {
							return
						}
						if pg.loading {
							pg.view.Page().Stop()
							pg.loading = false
						} else {
							pg.err, pg.loading = "", true
							pg.view.Page().Reload()
						}
					}})
				field := omgui.Field(c, &pg.typed, "Search or enter address", false).Label("Address").Grow(1).MinWidth(0)
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
				if field.Submitted() {
					navigate(pg, p, pg.typed)
				}
			})
		},
		Closed: func(id int) {
			pg := pages[id]
			if pg == nil {
				return
			}
			delete(pages, id)
			for _, off := range pg.offs {
				off()
			}
			if pg.view != nil {
				pg.view.Destroy()
			}
		},
	})
}

// navigate is WebViewerView.navigate: the page loads what the bar names,
// the address it showed kept in the tab's history.
func navigate(pg *page, p tabtypesapi.Props, input string) {
	address := NormalizeURL(input)
	pg.typed = address
	if pg.view == nil || address == p.Info.Address {
		return
	}
	pg.err, pg.loading, pg.shown = "", true, address
	p.Retarget(address, titleFromURL(address))
	if err := pg.view.Page().LoadURL(address); err != nil {
		pg.err, pg.loading = err.Error(), false
	}
}

func errorBanner(c *ui.Context, text string) {
	t := c.Theme()
	ui.Row(c).Padding(6, 12).Gap(8).AlignItems(ui.Center).Background(t.Surface).BorderWidth(0, 0, 1, 0).BorderColor(t.Border).Children(func() {
		ui.Icon(c, lucide.TriangleAlert()).Size(14, 14).TextColor(t.Danger)
		ui.Text(c, text).FontSize(12)
	})
}

// cliWeb is `web url=<url> [newtab]` (registerWebCliHandlers): a URL with
// no scheme goes over https.
func cliWeb(ctx context.Context, a actionsapi.Args) (string, error) {
	address := a.Params["url"]
	if address == "" {
		return "", fmt.Errorf("Missing required parameter: url\nUsage: web url=<url>")
	}
	if !strings.Contains(address, "://") {
		address = "https://" + address
	}
	newTab := a.Has("newtab")
	return shellapi.OnMain(ctx, func() (string, error) {
		ws := workspaceapi.Get()
		if ws == nil {
			return "", fmt.Errorf("No workspace to open %s in.", address)
		}
		if err := ws.OpenResource(address, workspaceapi.OpenOptions{Kind: Kind, NewTab: newTab}); err != nil {
			return "", err
		}
		return "Opened: " + address, nil
	})
}

// Plugin registers the web tab type and the web command while loaded.
var Plugin = rutis.Define(rutis.Plugin[struct{}]{
	Name:   ID,
	Inject: []string{"shell", "workspace"},
	Apply: func(rctx *rutis.Ctx, _ struct{}) error {
		off := Register()
		offCmd := actionsapi.Register(actionsapi.Command{ID: "web", CLI: true, Flags: []string{"newtab"}, Run: cliWeb})
		rctx.Effect(func(context.Context) error {
			offCmd()
			shellapi.Update(off)
			return nil
		})
		return nil
	},
})
