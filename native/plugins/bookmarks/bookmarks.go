// Package bookmarks is the bookmarks plugin: since RFC 0003 §9 a bookmark
// is a pinned tab and a bookmark group a pinned folder, so it keeps only
// the bookmark commands, over the workspace's pinned area.
package bookmarks

import (
	"context"

	"github.com/arcships/rutis/go/rutis"

	"github.com/cunninghamcard-bit/attention/native/plugins/actions"
	"github.com/cunninghamcard-bit/attention/native/plugins/layout"
	projectplugin "github.com/cunninghamcard-bit/attention/native/plugins/project"
	"github.com/cunninghamcard-bit/attention/native/plugins/shell"
	"github.com/cunninghamcard-bit/attention/native/plugins/tabtypes"
	"github.com/cunninghamcard-bit/attention/native/plugins/workspace"
)

// ID is the plugin's name.
const ID = "bookmarks"

// Plugin provides "bookmarks" while loaded.
var Plugin = rutis.Define(rutis.Plugin[struct{}]{
	Name:   ID,
	Inject: []string{"shell", "layout", "workspace", "project", "actions"},
	Apply: func(rctx *rutis.Ctx, _ struct{}) error {
		var (
			sh      *shell.Shell
			lyt     *layout.Layout
			ws      *workspace.Workspace
			project projectplugin.Project
			act     *actions.Service
		)
		if err := rctx.Use("shell", &sh); err != nil {
			return err
		}
		if err := rctx.Use("layout", &lyt); err != nil {
			return err
		}
		if err := rctx.Use("workspace", &ws); err != nil {
			return err
		}
		if err := rctx.Use("project", &project); err != nil {
			return err
		}
		if err := rctx.Use("actions", &act); err != nil {
			return err
		}
		b := &Bookmarks{sh: sh, lyt: lyt, ws: ws, project: project}
		rctx.Provide("bookmarks", b)
		var offs []func()
		for _, cmd := range b.commands() {
			offs = append(offs, act.Add(cmd))
		}
		rctx.Effect(func(context.Context) error {
			for i := len(offs) - 1; i >= 0; i-- {
				offs[i]()
			}
			return nil
		})
		return nil
	},
})

// URL is a pinned web page.
type URL struct {
	Title, URL string
}

// Item is a bookmark as the bookmarks CLI prints the pinned area
// (BookmarkItem): a "file", a "url", or a "group" of them.
type Item struct {
	Type  string  `json:"type"`
	Path  string  `json:"path,omitempty"`
	Title string  `json:"title,omitempty"`
	URL   string  `json:"url,omitempty"`
	Items []*Item `json:"items,omitempty"`
}

// Bookmarks is the "bookmarks" service, on the main thread only.
type Bookmarks struct {
	sh      *shell.Shell
	lyt     *layout.Layout
	ws      *workspace.Workspace
	project projectplugin.Project
}

// URLs are the pinned web pages, folders' included.
func (b *Bookmarks) URLs() []URL {
	var out []URL
	var walk func([]workspace.Pin)
	walk = func(pins []workspace.Pin) {
		for _, p := range pins {
			if p.Folder != "" {
				walk(p.Pins)
			} else if tabtypes.WebAddress(p.Entry) {
				out = append(out, URL{Title: p.Title, URL: p.Entry})
			}
		}
	}
	walk(b.ws.Pins())
	return out
}

// items is the pinned area in bookmarks' terms.
func (b *Bookmarks) items() []*Item {
	var conv func([]workspace.Pin) []*Item
	conv = func(pins []workspace.Pin) []*Item {
		out := []*Item{}
		for _, p := range pins {
			switch {
			case p.Folder != "":
				out = append(out, &Item{Type: "group", Title: p.Folder, Items: conv(p.Pins)})
			case tabtypes.WebAddress(p.Entry):
				out = append(out, &Item{Type: "url", URL: p.Entry, Title: p.Title})
			default:
				out = append(out, &Item{Type: "file", Path: p.Entry})
			}
		}
		return out
	}
	return conv(b.ws.Pins())
}

func (b *Bookmarks) commands() []actions.Command {
	onMain := func(fn func() (string, error)) func(context.Context, actions.Args) (string, error) {
		return func(ctx context.Context, _ actions.Args) (string, error) { return shell.OnMain(ctx, b.sh, fn) }
	}
	reveal := func() (string, error) {
		b.lyt.RevealPanel(workspace.TabsPanelID)
		return "", nil
	}
	pin := func() (string, error) { b.ws.SetPinned(true); return "", nil }
	unpin := func() (string, error) { b.ws.SetPinned(false); return "", nil }
	main := func(fn func() (string, error)) func() { return func() { _, _ = fn() } }
	return []actions.Command{
		{ID: "bookmarks:open", Title: "Show bookmarks", CLI: true, Main: main(reveal), Run: onMain(reveal)},
		{ID: "bookmarks:bookmark-current-view", Title: "Bookmark current view", CLI: true, Main: main(pin), Run: onMain(pin)},
		{ID: "bookmarks:unbookmark-current-view", Title: "Unbookmark current view", CLI: true, Main: main(unpin), Run: onMain(unpin)},
		{ID: "bookmarks", CLI: true, Flags: []string{"total", "verbose"}, Run: b.cliList},
		{ID: "bookmark", CLI: true, Run: b.cliAdd},
	}
}
