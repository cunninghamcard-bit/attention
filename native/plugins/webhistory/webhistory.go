// Package webhistory is the web viewer's history (RFC 0001 roadmap P3):
// the store of attention's WebViewerService (recordHistory, listHistory,
// removeHistoryEntry, clearHistory), kept in web-history.json in the config
// folder rather than local storage, the Web viewer history page
// (WebViewerHistoryView), and the CLI's web:history.
package webhistory

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/arcships/rutis/go/rutis"
	"github.com/egoist/mygo"
	"github.com/egoist/mygo/ui"
	"github.com/smallnest/uix/components/lucide"

	omgui "github.com/cunninghamcard-bit/attention-ui/ui"
	"github.com/cunninghamcard-bit/attention/native/actionsapi"
	webcontract "github.com/cunninghamcard-bit/attention/native/contract/web"
	"github.com/cunninghamcard-bit/attention/native/internal/paths"
	"github.com/cunninghamcard-bit/attention/native/internal/persist"
	"github.com/cunninghamcard-bit/attention/native/shellapi"
	"github.com/cunninghamcard-bit/attention/native/tabtypesapi"
	"github.com/cunninghamcard-bit/attention/native/webhistoryapi"
	"github.com/cunninghamcard-bit/attention/native/workspaceapi"
)

// ID is the plugin's name; Kind the history page's
// (WEBVIEWER_HISTORY_VIEW_TYPE).
const (
	ID   = "web-history"
	Kind = "webviewer-history"
)

// maxEntries is how many visits are kept.
const maxEntries = 1000

// History is the store, on the main thread only.
type History struct {
	entries []webhistoryapi.Entry
	save    func()
	cleared func() // emits webcontract.HistoryClearedEvent
}

type file struct {
	Entries []webhistoryapi.Entry `json:"entries"`
}

func newID() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	return hex.EncodeToString(b[:])
}

// Record is recordHistory. Unlike it, a title given for the newest entry
// renames it: the page's own title comes after the visit.
func (h *History) Record(url, title string) {
	if url == "" || url == "about:blank" {
		return
	}
	if title == "" {
		title = url
	}
	if len(h.entries) > 0 && h.entries[0].URL == url {
		if h.entries[0].Title != title {
			h.entries[0].Title = title
			h.save()
		}
		return
	}
	e := webhistoryapi.Entry{ID: newID(), URL: url, Title: title, VisitedAt: time.Now().UTC().Format(time.RFC3339)}
	h.entries = append([]webhistoryapi.Entry{e}, h.entries...)
	if len(h.entries) > maxEntries {
		h.entries = h.entries[:maxEntries]
	}
	h.save()
}

func (h *History) List() []webhistoryapi.Entry {
	return append([]webhistoryapi.Entry(nil), h.entries...)
}

func (h *History) Remove(id string) {
	for i, e := range h.entries {
		if e.ID == id {
			h.entries = append(h.entries[:i:i], h.entries[i+1:]...)
			h.save()
			return
		}
	}
}

// Clear is clearHistory; the pages leave the index with it (web-index).
func (h *History) Clear() {
	h.entries = nil
	h.save()
	if h.cleared != nil {
		h.cleared()
	}
}

// view is the history page (WebViewerHistoryView.render): each visit's
// title and address; a click opens it in a new tab, a right click copies
// or removes it.
func (h *History) view(c *ui.Context, _ tabtypesapi.Props) {
	t := c.Theme()
	if len(h.entries) == 0 {
		ui.Column(c).Grow(1).Fill().Padding(12).Children(func() {
			ui.Text(c, "No web viewer history").TextColor(t.TextMuted)
		})
		return
	}
	entries := h.entries
	ui.List(c, nil, len(entries), func(i int) {
		e := entries[i]
		row := omgui.SideRow(c, omgui.SideRowProps{Key: "h:" + e.ID})
		if row.Clicked() {
			open(e.URL)
		}
		row.ContextMenu(func(m *ui.Menu) {
			if m.Item("Copy URL").Chosen() {
				mygo.Clipboard.WriteText(e.URL)
			}
			if m.Item("Remove from history").Chosen() {
				h.Remove(e.ID)
			}
		})
		row.Tooltip(e.URL)
		row.Children(func() {
			ui.Icon(c, lucide.Globe()).Size(14, 14).TextColor(t.TextMuted).Shrink(0)
			ui.RichText(c, ui.Span{Text: e.Title}, ui.Span{Text: " — " + e.URL, Color: t.TextMuted}).
				FontSize(13).SingleLine().Ellipsis("…").Shrink(1)
		})
	}).Grow(1).Fill().PaddingY(4)
}

// open is the controller's open: the page in a new tab.
func open(url string) {
	if ws := workspaceapi.Get(); ws != nil {
		_ = ws.OpenResource(url, workspaceapi.OpenOptions{Kind: "webviewer", NewTab: true})
	}
}

// cliHistory is `web:history [limit=<n>] [format=json]`, newest first:
// each visit's address and title, tab-separated.
func (h *History) cliHistory(ctx context.Context, a actionsapi.Args) (string, error) {
	limit, _, err := a.Int("limit")
	if err != nil {
		return "", err
	}
	entries, err := shellapi.OnMain(ctx, func() ([]webhistoryapi.Entry, error) { return h.List(), nil })
	if err != nil {
		return "", err
	}
	if limit > 0 && len(entries) > limit {
		entries = entries[:limit]
	}
	if a.Params["format"] == "json" {
		data, err := json.MarshalIndent(entries, "", "  ")
		return string(data), err
	}
	if len(entries) == 0 {
		return "No web history.", nil
	}
	var b strings.Builder
	for i, e := range entries {
		if i > 0 {
			b.WriteByte('\n')
		}
		b.WriteString(e.URL + "\t" + e.Title)
	}
	return b.String(), nil
}

// Plugin installs the history, its page and commands while loaded.
var Plugin = rutis.Define(rutis.Plugin[struct{}]{
	Name:   ID,
	Inject: []string{"shell", "workspace"},
	Apply: func(rctx *rutis.Ctx, _ struct{}) error {
		path := filepath.Join(paths.ConfigDir(), "web-history.json")
		h := &History{}
		var f file
		if persist.Load(path, &f) {
			h.entries = f.Entries
		}
		saver := persist.New(path, func() any { return file{Entries: h.List()} })
		h.save = saver.Soon
		// A service of no methods: who injects it hears its events
		// (web-index, webcontract.HistoryClearedEvent).
		rctx.Provide("web-history", struct{}{})
		emitCtx, cancel := context.WithCancel(context.Background())
		h.cleared = func() { go func() { _ = rctx.Emit(emitCtx, webcontract.HistoryClearedEvent) }() }
		openPage := func() {
			if ws := workspaceapi.Get(); ws != nil {
				_ = ws.OpenTab(Kind, workspaceapi.OpenOptions{})
			}
		}
		offs := []func(){
			webhistoryapi.Set(h),
			tabtypesapi.Register(tabtypesapi.TabType{ID: ID, Kind: Kind, Priority: tabtypesapi.Builtin,
				Title: func(string) string { return "Web viewer history" }, Icon: lucide.Clock(), Body: h.view}),
			actionsapi.Register(actionsapi.Command{ID: "webviewer:open-history", Title: "Open Web viewer history", Main: openPage, CLI: true,
				Run: func(ctx context.Context, _ actionsapi.Args) (string, error) {
					return shellapi.OnMain(ctx, func() (string, error) { openPage(); return "", nil })
				}}),
			actionsapi.Register(actionsapi.Command{ID: "web:history", CLI: true, Run: h.cliHistory}),
			actionsapi.Register(actionsapi.Command{ID: "web:history:clear", CLI: true,
				Run: func(ctx context.Context, _ actionsapi.Args) (string, error) {
					return shellapi.OnMain(ctx, func() (string, error) {
						n := len(h.entries)
						h.Clear()
						return "Cleared " + strconv.Itoa(n) + " history entries.", nil
					})
				}}),
		}
		rctx.Effect(func(ctx context.Context) error {
			for _, off := range offs {
				off()
			}
			cancel()
			saver.Final(ctx)
			return nil
		})
		return nil
	},
})
