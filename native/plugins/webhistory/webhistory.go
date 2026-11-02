// Package webhistory is the web viewer's history (RFC 0001 roadmap P3):
// the store of attention's WebViewerService (recordHistory, listHistory,
// removeHistoryEntry, clearHistory), kept in web-history.json in the config
// folder rather than local storage, the Web viewer history page
// (WebViewerHistoryView), and the CLI's web:history.
package webhistory

import (
	"cmp"
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
	"github.com/cunninghamcard-bit/attention/native/internal/paths"
	"github.com/cunninghamcard-bit/attention/native/internal/persist"
	"github.com/cunninghamcard-bit/attention/native/plugins/actions"
	"github.com/cunninghamcard-bit/attention/native/plugins/shell"
	"github.com/cunninghamcard-bit/attention/native/plugins/tabtypes"
	"github.com/cunninghamcard-bit/attention/native/plugins/workspace"
)

const (
	// ID is the plugin's name; Kind the history page's
	// (WEBVIEWER_HISTORY_VIEW_TYPE).
	ID   = "web-history"
	Kind = "webviewer-history"

	// ClearedEvent is emitted by the web-history plugin when its history
	// was cleared, with no arguments.
	ClearedEvent = "web-history/cleared"

	// maxEntries is how many visits are kept.
	maxEntries = 1000
)

// Plugin installs the history, its page and commands while loaded.
var Plugin = rutis.Define(rutis.Plugin[struct{}]{
	Name:   ID,
	Inject: []string{"shell", "tabTypes", "workspace", "actions"},
	Apply: func(rctx *rutis.Ctx, _ struct{}) error {
		var (
			sh  *shell.Shell
			tt  *tabtypes.Registry
			ws  *workspace.Workspace
			act *actions.Service
		)
		if err := rctx.Use("shell", &sh); err != nil {
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
		path := filepath.Join(paths.ConfigDir(), "web-history.json")
		h := &History{sh: sh, ws: ws}
		var f file
		if persist.Load(path, &f) {
			h.entries = f.Entries
		}
		saver := persist.New(sh, path, func() any { return file{Entries: h.List()} })
		h.save = saver.Soon
		rctx.Provide("web-history", h)
		emitCtx, cancel := context.WithCancel(context.Background())
		h.cleared = func() { go func() { _ = rctx.Emit(emitCtx, ClearedEvent) }() }
		openPage := func() {
			if ws != nil {
				_ = ws.OpenTab(Kind, workspace.OpenOptions{})
			}
		}
		offs := []func(){
			tt.Register(tabtypes.TabType{ID: ID, Kind: Kind, Priority: tabtypes.Builtin,
				Title: func(string) string { return "Web viewer history" }, Icon: lucide.Clock(), Body: h.view}),
			act.Add(actions.Command{ID: "webviewer:open-history", Title: "Open Web viewer history", Main: openPage, CLI: true,
				Run: func(ctx context.Context, _ actions.Args) (string, error) {
					return shell.OnMain(ctx, sh, func() (string, error) { openPage(); return "", nil })
				}}),
			act.Add(actions.Command{ID: "web:history", CLI: true, Run: h.cliHistory}),
			act.Add(actions.Command{ID: "web:history:clear", CLI: true,
				Run: func(ctx context.Context, _ actions.Args) (string, error) {
					return shell.OnMain(ctx, sh, func() (string, error) {
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

// Entry is one visit in web-history.json (WebViewerHistoryEntry).
type Entry struct {
	ID        string `json:"id"`
	URL       string `json:"url"`
	Title     string `json:"title"`
	VisitedAt string `json:"visitedAt"`
}

type file struct {
	Entries []Entry `json:"entries"`
}

// History is the store, on the main thread only.
type History struct {
	sh      *shell.Shell
	ws      *workspace.Workspace
	entries []Entry
	save    func()
	cleared func() // emits ClearedEvent
}

// Record is recordHistory. Unlike it, a title given for the newest entry
// renames it: the page's own title comes after the visit.
func (h *History) Record(url, title string) {
	if url == "" || url == "about:blank" {
		return
	}
	title = cmp.Or(title, url)
	if len(h.entries) > 0 && h.entries[0].URL == url {
		if h.entries[0].Title != title {
			h.entries[0].Title = title
			h.save()
		}
		return
	}
	e := Entry{ID: newID(), URL: url, Title: title, VisitedAt: time.Now().UTC().Format(time.RFC3339)}
	h.entries = append([]Entry{e}, h.entries...)
	if len(h.entries) > maxEntries {
		h.entries = h.entries[:maxEntries]
	}
	h.save()
}

func (h *History) List() []Entry {
	return append([]Entry(nil), h.entries...)
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
func (h *History) view(c *ui.Context, _ tabtypes.Props) {
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
			h.open(e.URL)
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

// cliHistory is `web:history [limit=<n>] [format=json]`, newest first:
// each visit's address and title, tab-separated.
func (h *History) cliHistory(ctx context.Context, a actions.Args) (string, error) {
	limit, _, err := a.Int("limit")
	if err != nil {
		return "", err
	}
	entries, err := shell.OnMain(ctx, h.sh, func() ([]Entry, error) { return h.List(), nil })
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

// open is the controller's open: the page in a new tab.
func (h *History) open(url string) {
	if h.ws != nil {
		_ = h.ws.OpenResource(url, workspace.OpenOptions{Kind: "webviewer", NewTab: true})
	}
}

func newID() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	return hex.EncodeToString(b[:])
}
