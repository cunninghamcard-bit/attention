// Package bookmarks is the Bookmarks core plugin: the left dock's
// Bookmarks panel, a port of attention's Bookmarks
// (apps/web/builtin/Bookmarks.ts).
//
// Left out: graph bookmarks (kept if already in the file), starring
// migration, drag-and-drop, multi-select, bookmark-current-search /
// heading / all-tabs, and the tab header's mod-bookmarked class.
package bookmarks

import (
	"context"
	"encoding/json"
	"path/filepath"
	"sort"
	"strconv"
	"time"

	"github.com/arcships/rutis/go/rutis"
	"github.com/egoist/mygo/ui"
	"github.com/smallnest/uix/components/lucide"

	omgui "github.com/cunninghamcard-bit/attention-ui/ui"
	"github.com/cunninghamcard-bit/attention/native/actionsapi"
	projectcontract "github.com/cunninghamcard-bit/attention/native/contract/project"
	"github.com/cunninghamcard-bit/attention/native/internal/paths"
	"github.com/cunninghamcard-bit/attention/native/internal/persist"
	"github.com/cunninghamcard-bit/attention/native/layoutapi"
	"github.com/cunninghamcard-bit/attention/native/shellapi"
	"github.com/cunninghamcard-bit/attention/native/slotsapi"
	"github.com/cunninghamcard-bit/attention/native/workspaceapi"
)

// ID is the plugin's name; PanelID the slot id (BookmarksView.getViewType).
const (
	ID      = "bookmarks"
	PanelID = "bookmarks"
)

func storePath() string { return filepath.Join(paths.ConfigDir(), "bookmarks.json") }

// Data is BookmarksData: the on-disk file.
type Data struct {
	Items []*Item `json:"items"`
}

// Item is BookmarkItem (apps/web/builtin/Bookmarks.ts). Unknown types
// (graph, and anything else) keep their original JSON so a save does not
// drop them. File and folder paths are absolute (the reader has mounts).
type Item struct {
	Type    string          `json:"type"`
	Ctime   int64           `json:"ctime"`
	Path    string          `json:"path,omitempty"`
	Subpath string          `json:"subpath,omitempty"`
	Title   string          `json:"title,omitempty"`
	URL     string          `json:"url,omitempty"`
	Query   string          `json:"query,omitempty"`
	Items   []*Item         `json:"items,omitempty"`
	Options json.RawMessage `json:"options,omitempty"`
	raw     json.RawMessage
}

func (it *Item) UnmarshalJSON(data []byte) error {
	type wire Item
	var w wire
	if err := json.Unmarshal(data, &w); err != nil {
		return err
	}
	*it = Item(w)
	switch it.Type {
	case "file", "folder", "group", "url", "search":
		return nil
	}
	it.raw = append(json.RawMessage(nil), data...)
	return nil
}

func (it *Item) MarshalJSON() ([]byte, error) {
	if it == nil {
		return []byte("null"), nil
	}
	if len(it.raw) > 0 {
		return it.raw, nil
	}
	type wire struct {
		Type    string          `json:"type"`
		Ctime   int64           `json:"ctime"`
		Path    string          `json:"path,omitempty"`
		Subpath string          `json:"subpath,omitempty"`
		Title   string          `json:"title,omitempty"`
		URL     string          `json:"url,omitempty"`
		Query   string          `json:"query,omitempty"`
		Items   []*Item         `json:"items,omitempty"`
		Options json.RawMessage `json:"options,omitempty"`
	}
	return json.Marshal(wire{
		Type: it.Type, Ctime: it.Ctime, Path: it.Path, Subpath: it.Subpath,
		Title: it.Title, URL: it.URL, Query: it.Query, Items: it.Items, Options: it.Options,
	})
}

// Bookmarks is the panel's state, on the main thread only.
type Bookmarks struct {
	project  projectcontract.Project
	items    []*Item
	saveSoon func()

	collapsed map[string]bool
	rows      []row
}

type row struct {
	item  *Item
	depth int
	key   string
}

// Plugin registers the Bookmarks panel while loaded.
var Plugin = rutis.Define(rutis.Plugin[struct{}]{
	Name:   ID,
	Inject: []string{"shell", "project", "workspace"},
	Apply: func(rctx *rutis.Ctx, _ struct{}) error {
		var project projectcontract.Project
		if err := rctx.Use("project", &project); err != nil {
			return err
		}
		b := &Bookmarks{project: project, items: []*Item{}, collapsed: map[string]bool{}}
		saver := persist.New(storePath(), func() any { return Data{Items: cloneItems(b.items)} })
		b.saveSoon = saver.Soon
		var data Data
		if persist.Load(storePath(), &data) && data.Items != nil {
			b.items = data.Items
		}
		off := slotsapi.RegisterPanel(slotsapi.Panel{
			ID: PanelID, Title: "Bookmarks", Icon: lucide.Bookmark(), Dock: slotsapi.Left, Order: 2,
			View: b.view, State: b.state, Restore: b.restore,
		})
		offs := []func(){off}
		for _, cmd := range b.commands() {
			offs = append(offs, actionsapi.Register(cmd))
		}
		rctx.Effect(func(ctx context.Context) error {
			for i := len(offs) - 1; i >= 0; i-- {
				offs[i]()
			}
			saver.Final(ctx)
			return nil
		})
		return nil
	},
})

func cloneItems(items []*Item) []*Item {
	if items == nil {
		return []*Item{}
	}
	out := make([]*Item, len(items))
	for i, it := range items {
		c := *it
		if len(it.raw) > 0 {
			c.raw = append(json.RawMessage(nil), it.raw...)
		}
		if len(it.Options) > 0 {
			c.Options = append(json.RawMessage(nil), it.Options...)
		}
		c.Items = cloneItems(it.Items)
		out[i] = &c
	}
	return out
}

// savedState is which groups the user collapsed.
type savedState struct {
	Collapsed []string `json:"collapsed"`
}

func (b *Bookmarks) state() json.RawMessage {
	var collapsed []string
	for key, on := range b.collapsed {
		if on {
			collapsed = append(collapsed, key)
		}
	}
	sort.Strings(collapsed)
	data, _ := json.Marshal(savedState{Collapsed: collapsed})
	return data
}

func (b *Bookmarks) restore(data json.RawMessage) {
	var st savedState
	if json.Unmarshal(data, &st) != nil {
		return
	}
	b.collapsed = map[string]bool{}
	for _, key := range st.Collapsed {
		if key != "" {
			b.collapsed[key] = true
		}
	}
}

func (b *Bookmarks) commands() []actionsapi.Command {
	reveal := func() {
		if l := layoutapi.Get(); l != nil {
			l.RevealPanel(PanelID)
		}
	}
	ui := func(id, title string, fn func()) actionsapi.Command {
		return actionsapi.Command{ID: id, Title: title, CLI: true, Main: fn, Run: func(ctx context.Context, _ actionsapi.Args) (string, error) {
			return shellapi.OnMain(ctx, func() (string, error) { fn(); return "", nil })
		}}
	}
	return []actionsapi.Command{
		ui("bookmarks:open", "Show bookmarks", reveal),
		{ID: "bookmarks:bookmark-current-view", Title: "Bookmark current view", CLI: true,
			Main: b.bookmarkCurrentView,
			Run: func(ctx context.Context, _ actionsapi.Args) (string, error) {
				return shellapi.OnMain(ctx, func() (string, error) { return b.bookmarkCurrentViewMsg() })
			}},
		ui("bookmarks:unbookmark-current-view", "Unbookmark current view", b.unbookmarkCurrentView),
		{ID: "bookmarks", CLI: true, Flags: []string{"total", "verbose"}, Run: b.cliList},
		{ID: "bookmark", CLI: true, Run: b.cliAdd},
	}
}

func (b *Bookmarks) add(item *Item) {
	if item.Type == "file" && containsPath(b.items, item.Path) {
		return
	}
	b.items = append(b.items, item)
	if b.saveSoon != nil {
		b.saveSoon()
	}
}

func (b *Bookmarks) remove(target *Item) {
	b.items = removeItem(b.items, target)
	if b.saveSoon != nil {
		b.saveSoon()
	}
}

func removeItem(items []*Item, target *Item) []*Item {
	var out []*Item
	for _, it := range items {
		if it == target {
			continue
		}
		if it.Type == "group" {
			it.Items = removeItem(it.Items, target)
		}
		out = append(out, it)
	}
	return out
}

func containsPath(items []*Item, path string) bool {
	for _, it := range items {
		if (it.Type == "file" || it.Type == "folder") && it.Path == path {
			return true
		}
		if it.Type == "group" && containsPath(it.Items, path) {
			return true
		}
	}
	return false
}

func nowCtime() int64 { return time.Now().UnixMilli() }

func (b *Bookmarks) bookmarkCurrentView() { _, _ = b.bookmarkCurrentViewMsg() }

func (b *Bookmarks) bookmarkCurrentViewMsg() (string, error) {
	ws := workspaceapi.Get()
	if ws == nil {
		return "", nil
	}
	info, ok := ws.ActiveTab()
	if !ok {
		return "", nil
	}
	if info.Path != "" {
		item := &Item{Type: "file", Ctime: nowCtime(), Path: info.Path}
		b.add(item)
		return "Bookmarked: " + item.displayTitle(), nil
	}
	if info.Kind == "webviewer" && info.Address != "" {
		item := &Item{Type: "url", Ctime: nowCtime(), URL: info.Address, Title: info.Address}
		b.add(item)
		return "Bookmarked: " + item.displayTitle(), nil
	}
	return "", nil
}

func (b *Bookmarks) unbookmarkCurrentView() {
	ws := workspaceapi.Get()
	if ws == nil {
		return
	}
	info, ok := ws.ActiveTab()
	if !ok {
		return
	}
	if info.Path != "" {
		var out []*Item
		for _, it := range b.items {
			if it.Type == "file" && it.Path == info.Path {
				continue
			}
			out = append(out, it)
		}
		b.items = out
		if b.saveSoon != nil {
			b.saveSoon()
		}
		return
	}
	if info.Kind == "webviewer" && info.Address != "" {
		var out []*Item
		for _, it := range b.items {
			if it.Type == "url" && it.URL == info.Address {
				continue
			}
			out = append(out, it)
		}
		b.items = out
		if b.saveSoon != nil {
			b.saveSoon()
		}
	}
}

func (b *Bookmarks) open(item *Item) {
	switch item.Type {
	case "file":
		if ws := workspaceapi.Get(); ws != nil {
			// A heading subpath (#…) has no Nav equivalent without the index.
			ws.Open(item.Path, nil, false)
		}
	case "folder":
		if l := layoutapi.Get(); l != nil {
			l.RevealPanel("file-explorer")
		}
	case "search":
		revealSearch(item.Query)
	case "url":
		if ws := workspaceapi.Get(); ws != nil {
			_ = ws.OpenResource(item.URL, workspaceapi.OpenOptions{Kind: "webviewer"})
		}
	}
}

func revealSearch(query string) {
	if cmd, ok := actionsapi.Lookup("search:open"); ok && cmd.Run != nil {
		go func() {
			_, _ = cmd.Run(context.Background(), actionsapi.Args{Params: map[string]string{"query": query}})
		}()
		return
	}
	if l := layoutapi.Get(); l != nil {
		l.RevealPanel("search")
	}
}

func (b *Bookmarks) flatten() []row {
	b.rows = b.rows[:0]
	var walk func([]*Item, int, string)
	walk = func(items []*Item, depth int, prefix string) {
		for i, it := range items {
			key := prefix + strconv.Itoa(i)
			b.rows = append(b.rows, row{item: it, depth: depth, key: key})
			if it.Type == "group" && !b.collapsed[key] {
				walk(it.Items, depth+1, key+".")
			}
		}
	}
	walk(b.items, 0, "")
	return b.rows
}

func (b *Bookmarks) view(c *ui.Context, _ slotsapi.PanelProps) {
	t := c.Theme()
	ui.Column(c).Fill().Children(func() {
		if len(b.items) == 0 {
			ui.Text(c, "No bookmarks").TextColor(t.TextMuted).Padding(12)
			return
		}
		rows := b.flatten()
		ui.List(c, nil, len(rows), func(i int) {
			b.itemRow(c, rows[i])
		}).Grow(1).FillWidth().PaddingY(4)
	})
}

func (b *Bookmarks) itemRow(c *ui.Context, r row) {
	t := c.Theme()
	it := r.item
	item := omgui.SideRow(c, omgui.SideRowProps{Key: r.key, Depth: r.depth})
	chevronClicked := false
	moreClicked := false
	item.Children(func() {
		if it.Type == "group" {
			chevron := lucide.ChevronDown()
			if b.collapsed[r.key] {
				chevron = lucide.ChevronRight()
			}
			if ui.Icon(c, chevron).Size(14, 14).TextColor(t.TextMuted).Shrink(0).Cursor(ui.CursorPointer).Clicked() {
				chevronClicked = true
				b.collapsed[r.key] = !b.collapsed[r.key]
			}
		} else {
			ui.Icon(c, itemIcon(it)).Size(14, 14).TextColor(t.TextMuted).Shrink(0)
		}
		ui.Text(c, it.displayTitle()).FontSize(13).SingleLine().Ellipsis("…").Shrink(1)
		more := omgui.IconMenu(c, omgui.IconMenuProps{
			Label: "More", Icon: lucide.EllipsisVertical(), End: true,
			Items: []omgui.MenuItem{{
				Label: "Remove bookmark", Danger: true,
				OnClick: func() { b.remove(it) },
			}},
		})
		moreClicked = more.Clicked() || (item.Clicked() && more.Hovered())
	})
	if item.Clicked() && !chevronClicked && !moreClicked {
		b.open(it)
	}
}

// displayTitle is getBookmarkTitle (apps/web/builtin/Bookmarks.ts). File
// and folder paths without a title use the mount-prefixed display path.
func (it *Item) displayTitle() string {
	switch it.Type {
	case "file":
		if it.Title != "" {
			return it.Title
		}
		return displayPath(it.Path) + it.Subpath
	case "folder":
		if it.Title != "" {
			return it.Title
		}
		return displayPath(it.Path)
	case "search":
		if it.Title != "" {
			return it.Title
		}
		return "Search: " + it.Query
	case "url":
		if it.Title != "" {
			return it.Title
		}
		return it.URL
	}
	return it.Title
}

func displayPath(path string) string {
	if ws := workspaceapi.Get(); ws != nil {
		return ws.Display(path)
	}
	return path
}

// itemIcon is getBookmarkIcon (apps/web/builtin/Bookmarks.ts).
func itemIcon(it *Item) *ui.SVG {
	switch it.Type {
	case "file":
		if it.Subpath != "" {
			return lucide.Heading()
		}
		return lucide.File()
	case "folder":
		return lucide.Folder()
	case "search":
		return lucide.Search()
	case "graph":
		return lucide.GitFork()
	case "url":
		return lucide.Globe()
	}
	return lucide.Bookmark()
}
