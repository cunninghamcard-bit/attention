package workspace

import (
	"path/filepath"
	"slices"

	projectplugin "github.com/cunninghamcard-bit/attention/native/plugins/project"
)

// Pin is an entry of the sidebar's pinned area as Pins reports it: a
// pinned tab, its entry (a file's path or a page's address) and title, or
// a folder of them.
type Pin struct {
	Entry  string
	Title  string
	Folder string // a folder's name; its tabs are Pins
	Pins   []Pin
}

// pin is an entry of the pinned area (RFC 0003 §9): an item, or a folder
// of items.
type pin struct {
	item   *node
	folder *folder
}

// folder is a named group of pinned items, which collapses.
type folder struct {
	title  string
	color  string // "#rrggbb", "" for none
	items  []*node
	closed bool
}

// parked is a pinned card whose tab was closed: what reopens on a click.
type parked struct {
	entry, title string
}

// spot is a place in the sidebar's list: the pinned area, in folder or at
// its top level when folder is nil, or the list below it; i is the index
// there.
type spot struct {
	pinned bool
	folder *folder
	i      int
}

// Pins are the pinned area's tabs and folders, each item by its first
// card.
func (ws *Workspace) Pins() []Pin {
	one := func(it *node) Pin {
		entry, title := ws.cardEntry(it.groups(nil)[0])
		return Pin{Entry: entry, Title: title}
	}
	var out []Pin
	for _, p := range ws.pins {
		if p.folder == nil {
			out = append(out, one(p.item))
			continue
		}
		f := Pin{Folder: p.folder.title}
		for _, it := range p.folder.items {
			f.Pins = append(f.Pins, one(it))
		}
		out = append(out, f)
	}
	return out
}

// PinEntry pins a closed tab of entry, titled title ("" for its name), in
// the folder named folder ("" for the top level), which it makes when
// there is none. An entry already pinned is left as it is; ok reports
// whether it was pinned now.
func (ws *Workspace) PinEntry(entry, title, folderName string) bool {
	if entry == "" || ws.pinnedEntry(entry) != nil {
		return false
	}
	it := ws.newItem()
	it.children[0].group.parked = &parked{entry: entry, title: title}
	to := spot{pinned: true, i: len(ws.pins)}
	if folderName != "" {
		f := ws.folderNamed(folderName)
		if f == nil {
			f = &folder{title: folderName}
			ws.pins = append(ws.pins, &pin{folder: f})
		}
		to = spot{pinned: true, folder: f, i: len(f.items)}
	}
	ws.insertAt(it, to)
	ws.changed()
	return true
}

// UnpinEntry takes the pinned tab of entry out of the pinned area, closing
// it; ok reports whether one was pinned.
func (ws *Workspace) UnpinEntry(entry string) bool {
	it := ws.pinnedEntry(entry)
	if it == nil {
		return false
	}
	ws.forget(it)
	return true
}

// SetPinned pins the shown item, or unpins it; an empty one stays.
func (ws *Workspace) SetPinned(on bool) {
	it := ws.root
	switch {
	case !slices.ContainsFunc(it.groups(nil), func(g *pane) bool { return len(g.tabs) > 0 }):
	case on && !ws.isPinned(it):
		ws.pinItem(it)
	case !on && ws.isPinned(it):
		ws.unpinItem(it)
	}
}

// TogglePin pins the shown item, or unpins it when pinned.
func (ws *Workspace) TogglePin() { ws.SetPinned(!ws.isPinned(ws.root)) }

// pinnedItems are the pinned area's items, folders' included, in order.
func (ws *Workspace) pinnedItems() []*node {
	var out []*node
	for _, p := range ws.pins {
		if p.folder != nil {
			out = append(out, p.folder.items...)
		} else {
			out = append(out, p.item)
		}
	}
	return out
}

// listedItems are the items the list shows, pinned first, for moving
// along it.
func (ws *Workspace) listedItems() []*node {
	return append(ws.pinnedItems(), ws.shownItems()...)
}

// pinnedEntry is the pinned item one of whose cards holds entry, or nil.
func (ws *Workspace) pinnedEntry(entry string) *node {
	for _, it := range ws.pinnedItems() {
		for _, g := range it.groups(nil) {
			if e, _ := ws.cardEntry(g); e == entry {
				return it
			}
		}
	}
	return nil
}

func (ws *Workspace) folderNamed(name string) *folder {
	for _, p := range ws.pins {
		if p.folder != nil && p.folder.title == name {
			return p.folder
		}
	}
	return nil
}

// cardEntry is what card g shows: its tab's entry and title, or what it
// reopens when parked.
func (ws *Workspace) cardEntry(g *pane) (entry, title string) {
	if g.parked != nil {
		return g.parked.entry, parkedTitle(*g.parked)
	}
	if t := g.current(); t != nil && !t.empty {
		return t.entry(), t.title
	}
	return "", ""
}

// locate is where it is in the list.
func (ws *Workspace) locate(it *node) (spot, bool) {
	for i, p := range ws.pins {
		if p.item == it {
			return spot{pinned: true, i: i}, true
		}
		if p.folder != nil {
			if j := indexOf(p.folder.items, it); j >= 0 {
				return spot{pinned: true, folder: p.folder, i: j}, true
			}
		}
	}
	if i := indexOf(ws.items, it); i >= 0 {
		return spot{i: i}, true
	}
	return spot{}, false
}

func (ws *Workspace) isPinned(it *node) bool {
	s, ok := ws.locate(it)
	return ok && s.pinned
}

// detach takes it out of the list, returning where it was.
func (ws *Workspace) detach(it *node) (spot, bool) {
	s, ok := ws.locate(it)
	switch {
	case !ok:
	case s.folder != nil:
		s.folder.items = slices.Delete(s.folder.items, s.i, s.i+1)
	case s.pinned:
		ws.pins = slices.Delete(ws.pins, s.i, s.i+1)
	default:
		ws.items = slices.Delete(ws.items, s.i, s.i+1)
	}
	return s, ok
}

// insertAt puts it at s, its index clamped.
func (ws *Workspace) insertAt(it *node, s spot) {
	switch {
	case s.folder != nil:
		s.folder.items = slices.Insert(s.folder.items, max(0, min(s.i, len(s.folder.items))), it)
	case s.pinned:
		ws.pins = slices.Insert(ws.pins, max(0, min(s.i, len(ws.pins))), &pin{item: it})
	default:
		ws.items = slices.Insert(ws.items, max(0, min(s.i, len(ws.items))), it)
	}
}

// moveCard puts card p at to and shows it: its item moves there, or, when
// p is one card of a split, it leaves the split for an item of its own.
func (ws *Workspace) moveCard(p *pane, to spot) {
	it := rootOf(p.node)
	if len(it.groups(nil)) == 1 {
		ws.moveItem(it, to)
		ws.focusGroup(p)
		return
	}
	p.node.parent.remove(p.node)
	own := &node{dir: vertical}
	own.insert(0, p.node)
	ws.insertAt(own, to)
	ws.showItem(own)
	ws.focusGroup(p)
}

func (ws *Workspace) moveItem(it *node, to spot) {
	if from, ok := ws.detach(it); ok {
		if from.pinned == to.pinned && from.folder == to.folder && from.i < to.i {
			to.i--
		}
		ws.insertAt(it, to)
	}
	if len(ws.items) == 0 {
		ws.items = []*node{ws.newItem()}
	}
	ws.showItem(it)
}

// showItem shows it, opening the cards parked in it.
func (ws *Workspace) showItem(it *node) {
	ws.selectItem(it)
	gs := it.groups(nil)
	for _, g := range gs {
		if g.parked != nil {
			pk := *g.parked
			g.parked = nil
			ws.activeGroup = g
			ws.openEntry(pk.entry)
			if t := g.current(); t != nil && t.page() && pk.title != "" {
				t.title = pk.title
			}
		}
	}
	if !slices.Contains(gs, ws.activeGroup) {
		ws.activeGroup = gs[0]
	}
	ws.changed()
}

// forget takes it out of the list for good, closing its tabs.
func (ws *Workspace) forget(it *node) {
	ws.detach(it)
	for _, g := range it.groups(nil) {
		g.parked = nil
		for len(g.tabs) > 0 {
			ws.closeTab(g, len(g.tabs)-1)
		}
	}
	if len(ws.items) == 0 {
		ws.items = []*node{ws.newItem()}
	}
	if ws.root == it {
		ws.selectItem(ws.fallback())
	}
	ws.changed()
}

// fallback is the item to show when the shown one goes: the list's last,
// else its first, which may be empty.
func (ws *Workspace) fallback() *node {
	if shown := ws.shownItems(); len(shown) > 0 {
		return shown[len(shown)-1]
	}
	return ws.items[0]
}

// pinItem moves it to the end of the pinned area; unpinItem moves it to
// the top of the list below.
func (ws *Workspace) pinItem(it *node) {
	if ws.firstEntry(it) != "" {
		ws.moveItem(it, spot{pinned: true, i: len(ws.pins)})
	}
}

func (ws *Workspace) unpinItem(it *node) {
	ws.moveItem(it, spot{i: 0})
}

// newFolder adds an empty folder at the end of the pinned area and starts
// renaming it.
func (ws *Workspace) newFolder() *folder {
	f := &folder{title: "New folder"}
	ws.pins = append(ws.pins, &pin{folder: f})
	ws.renaming, ws.renameDraft = f, f.title
	ws.changed()
	return f
}

// deleteFolder puts f's items where it was and removes it.
func (ws *Workspace) deleteFolder(f *folder) {
	i := slices.IndexFunc(ws.pins, func(p *pin) bool { return p.folder == f })
	if i < 0 {
		return
	}
	loose := make([]*pin, len(f.items))
	for k, it := range f.items {
		loose[k] = &pin{item: it}
	}
	ws.pins = slices.Concat(ws.pins[:i], loose, ws.pins[i+1:])
	ws.changed()
}

// organizeByProject pins every item of the list below that belongs to a
// project into that project's folder, named and colored as the project
// (RFC 0003 §9).
func (ws *Workspace) organizeByProject() {
	for _, it := range slices.Clone(ws.shownItems()) {
		g := it.groups(nil)[0]
		m, ok := ws.projectOf(g.current())
		if !ok {
			continue
		}
		f := ws.folderNamed(m.Name)
		if f == nil {
			f = &folder{title: m.Name, color: m.Color}
			ws.pins = append(ws.pins, &pin{folder: f})
		}
		ws.detach(it)
		ws.insertAt(it, spot{pinned: true, folder: f, i: len(f.items)})
	}
	if len(ws.items) == 0 {
		ws.items = []*node{ws.newItem()}
	}
	ws.changed()
}

// parkedProject is the project of a parked card's file.
func (ws *Workspace) parkedProject(pk parked) (projectplugin.Mount, bool) {
	m, _, ok := ws.mountOf(pk.entry)
	return m, ok
}

// parkedTitle is a parked card's name: its page's title, or its file's.
func parkedTitle(pk parked) string {
	if pk.title != "" {
		return pk.title
	}
	return filepath.Base(pk.entry)
}
