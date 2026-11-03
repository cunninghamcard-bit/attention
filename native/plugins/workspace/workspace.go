package workspace

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"github.com/egoist/mygo/ui"

	"github.com/cunninghamcard-bit/attention/native/plugins/actions"
	"github.com/cunninghamcard-bit/attention/native/plugins/appearance"
	fsplugin "github.com/cunninghamcard-bit/attention/native/plugins/fs"
	"github.com/cunninghamcard-bit/attention/native/plugins/layout"
	projectplugin "github.com/cunninghamcard-bit/attention/native/plugins/project"
	"github.com/cunninghamcard-bit/attention/native/plugins/resources"
	"github.com/cunninghamcard-bit/attention/native/plugins/shell"
	"github.com/cunninghamcard-bit/attention/native/plugins/shortcuts"
	"github.com/cunninghamcard-bit/attention/native/plugins/slots"
	"github.com/cunninghamcard-bit/attention/native/plugins/tabtypes"
	aui "github.com/cunninghamcard-bit/attention/native/ui"
)

const (
	// maxClosed is how many closed tabs Undo close tab can bring back.
	maxClosed = 20
	// maxCards is how many cards a split shows side by side, as Arc's.
	maxCards = 4
)

// Workspace is the center's state: the sidebar's list of items, each a
// tab or a split of tabs side by side (RFC 0003 §4), the files they show. Every field is read and written on the main thread only: work
// done on goroutines comes back through shell.Shell.Update (RFC §5.8).
type Workspace struct {
	ctx      context.Context
	sh       *shell.Shell
	sl       *slots.Registry
	res      *resources.Registry
	lyt      *layout.Layout
	sc       *shortcuts.Shortcuts
	act      *actions.Service
	app      *appearance.Appearance
	tabTypes *tabtypes.Registry
	fs       fsplugin.FS
	project  projectplugin.Project

	mounts       []projectplugin.Mount
	mountsLoaded bool

	// items are the sidebar's list, each a layout tree whose cards
	// (panes) hold one tab each (tree.go); root is the one shown.
	items       []*node
	root        *node
	activeGroup *pane
	nextGroup   int

	nextTab int
	closed  []string // recently closed files, newest last
	// recentFiles are the files opened last, newest first: the quick
	// switcher's recent list (Workspace.RecentFiles).
	recentFiles []string
	restoring   *session // the list to reopen once the mounts are known
	saveSoon    func()
	queue       []func()
	title       string
	typesGen    int // the tab type registry's generation last claimed against
}

func newWorkspace(
	ctx context.Context,
	sh *shell.Shell,
	sl *slots.Registry,
	res *resources.Registry,
	lyt *layout.Layout,
	sc *shortcuts.Shortcuts,
	act *actions.Service,
	app *appearance.Appearance,
	fs fsplugin.FS,
	project projectplugin.Project,
) *Workspace {
	if sh == nil {
		sh = shell.New()
	}
	if sl == nil {
		sl = slots.New(sh.Invalidate)
	}
	if res == nil {
		res = resources.New(sh.Update, sh.Invalidate)
	}
	if act == nil {
		act = actions.New()
	}
	if app == nil {
		app = appearance.New(nil, "", sh.Update)
	}
	ws := &Workspace{
		ctx: ctx, sh: sh, sl: sl, res: res, lyt: lyt, sc: sc, act: act, app: app,
		tabTypes: tabtypes.New(sh.Invalidate),
		fs:       fs, project: project,
	}
	ws.root = ws.newItem()
	ws.items = []*node{ws.root}
	return ws
}

// newPane is an empty tab group, not in the tree yet.
func (ws *Workspace) newPane() *pane {
	ws.nextGroup++
	return &pane{id: ws.nextGroup}
}

// addressOf is path's resource address: under its mount, else absolute.
func (ws *Workspace) addressOf(path string) string { return projectplugin.AddressOf(ws.mounts, path) }

// claim gives t the tab type that shows its address now.
func (ws *Workspace) claim(t *tab) {
	tt, ok := ws.tabTypes.Claim(t.address, t.wantKind)
	if ok && tt.ID == t.typeID {
		t.closed = tt.Closed // the same type, perhaps registered again
		return
	}
	ws.release(t)
	if !ok {
		t.kind, t.typeID = "", ""
		return
	}
	t.kind, t.typeID, t.closed = tt.Kind, tt.ID, tt.Closed
	if tt.Title != nil {
		t.title = tt.Title(t.address)
	}
}

// release tells t's tab type that t is gone from it.
func (ws *Workspace) release(t *tab) {
	if t.closed != nil {
		t.closed(t.id)
		t.closed = nil
	}
}

// reclaim claims every tab again when tab types came or went: a tab
// opened before its viewer loaded, or whose viewer unloaded, finds its
// type (RFC §5.5: contributions come back with their plugin).
func (ws *Workspace) reclaim() {
	gen := ws.tabTypes.Generation()
	if gen == ws.typesGen {
		return
	}
	ws.typesGen = gen
	for _, p := range ws.allGroups() {
		for _, t := range p.tabs {
			if !t.empty {
				ws.claim(t)
			}
		}
	}
}

// props are what t's body is given: its address's resource state, which
// the tab holds for its life.
func (ws *Workspace) props(t *tab, focused bool) tabtypes.Props {
	snap := ws.res.Get(t.address)
	id := t.id
	return tabtypes.Props{Info: tabtypes.Info{ID: t.id, Kind: t.kind, Address: t.address, Path: t.path, Title: t.title,
		Nav: t.nav, NavRevision: t.navRev, Version: snap.Version, Pending: snap.Status == resources.Loading,
		Missing: missing(snap), Focused: focused},
		Retarget: func(address, title string) {
			if t.id == id && t.page() && address != t.address {
				ws.retarget(t, address, title)
			}
		},
		SetTitle: func(title string) {
			if t.id == id && t.page() && title != "" && title != t.title {
				t.title = title
				ws.changed()
			}
		},
	}
}

// retarget makes t, a page, show address in place: the body keeps its
// state and the tab its id; where it was goes to its back history, unless
// it was the blank page (WebViewerView.handleCommittedNavigation,
// pushCurrentToHistory).
func (ws *Workspace) retarget(t *tab, address, title string) {
	if t.address != "about:blank" {
		t.record()
	}
	t.address, t.title, t.nav = address, title, nil
	ws.changed()
}

// later runs fn, a change to the tree, when the next frame starts.
func (ws *Workspace) later(fn func()) {
	ws.queue = append(ws.queue, fn)
	if w := ws.sh.Window(); w != nil {
		w.Invalidate()
	}
}

// flush runs the queued changes in order.
func (ws *Workspace) flush() {
	for len(ws.queue) > 0 {
		fns := ws.queue
		ws.queue = nil
		for _, fn := range fns {
			fn()
		}
	}
}

// closeTabs closes ts, those still open, last first.
func (ws *Workspace) closeTabs(ts []*tab) {
	for k := len(ts) - 1; k >= 0; k-- {
		if g := ws.groupOf(ts[k]); g != nil {
			ws.closeTab(g, g.indexOf(ts[k]))
		}
	}
}

// activePane is the focused tab group: the last one focused while it is in
// the tree, else the first.
func (ws *Workspace) activePane() *pane {
	gs := ws.groups()
	for _, g := range gs {
		if g == ws.activeGroup {
			return g
		}
	}
	ws.activeGroup = gs[0]
	return gs[0]
}

// focusGroup makes g the focused tab group.
func (ws *Workspace) focusGroup(g *pane) {
	if g != nil && g != ws.activeGroup {
		ws.activeGroup = g
		ws.changed()
	}
}

// activeTab is the active pane's active tab, or nil.
func (ws *Workspace) activeTab() *tab { return ws.activePane().current() }

// mountOf returns the mount holding path and path relative to it.
func (ws *Workspace) mountOf(path string) (projectplugin.Mount, string, bool) {
	return projectplugin.MountOf(ws.mounts, path)
}

// projectOf is the project t belongs to: the mount its file is under. A
// page, such as a web tab, belongs to none.
func (ws *Workspace) projectOf(t *tab) (projectplugin.Mount, bool) {
	if t == nil || t.empty || t.path == "" {
		return projectplugin.Mount{}, false
	}
	m, _, ok := ws.mountOf(t.path)
	return m, ok
}

// projectColor is the color of t's project, the zero color for none.
func (ws *Workspace) projectColor(t *tab) ui.Color {
	m, ok := ws.projectOf(t)
	if !ok {
		return ui.Color{}
	}
	col, _ := aui.ParseColor(m.Color)
	return col
}

// display is a path as the CLI and the tabs' tooltips show it.
func (ws *Workspace) display(path string) string {
	if m, rel, ok := ws.mountOf(path); ok {
		if rel == "." {
			return m.Name
		}
		return projectplugin.Display(m, rel)
	}
	return path
}

// ---- mounts -----------------------------------------------------------------

func (ws *Workspace) setMounts(ms []projectplugin.Mount) {
	ws.mounts = ms
	ws.mountsLoaded = true
	// A file opened before the mounts were known gets its mount address.
	for _, p := range ws.allGroups() {
		for _, t := range p.tabs {
			if t.empty || t.page() {
				continue
			}
			if a := ws.addressOf(t.path); a != t.address {
				t.hold()
				t.address, t.hold = a, ws.res.Hold(a)
				ws.claim(t)
			}
		}
	}
	if ws.restoring != nil {
		ws.reopen(ws.restoring)
		ws.restoring = nil
	}
}

// ---- tabs -------------------------------------------------------------------

// open shows path (see openAddress) and applies nav when given.
func (ws *Workspace) open(path string, nav *Nav) *tab {
	return ws.openIn(path, nav, false)
}

// openIn is open; newTab opens it in a new tab even when one shows path.
func (ws *Workspace) openIn(path string, nav *Nav, newTab bool) *tab {
	t, _ := ws.openAddress(ws.addressOf(path), path, OpenOptions{Nav: nav, NewTab: newTab})
	return t
}

// openResource opens a file address, or a web page's
// (Workspace.OpenResource).
func (ws *Workspace) openResource(address string, o OpenOptions) (*tab, error) {
	if tabtypes.Resourceless(address) {
		return ws.openAddress(address, "", o)
	}
	path, err := ws.pathOf(address)
	if err != nil {
		return nil, err
	}
	return ws.openAddress(ws.addressOf(path), path, o)
}

// pathOf is the file a file address names.
func (ws *Workspace) pathOf(address string) (string, error) {
	return projectplugin.PathOf(ws.mounts, address)
}

// openAddress opens path, whose canonical address is address, as
// attention's Workspace.openFile: a tab anywhere that shows it already is
// revealed; else the active tab navigates to it, keeping where it was in
// its history (WorkspaceLeaf.recordHistory); newTab opens it in a new item
// after the shown one instead (getLeaf("tab")).
func (ws *Workspace) openAddress(address, path string, opts OpenOptions) (*tab, error) {
	if opts.Kind != "" {
		if _, ok := ws.tabTypes.Claim(address, opts.Kind); !ok {
			return nil, fmt.Errorf("no tab type of kind %q opens %q", opts.Kind, address)
		}
	}
	nav, newTab := opts.Nav, opts.NewTab
	st := histState{address: address, path: path, kind: opts.Kind, nav: nav}
	if !newTab {
		kind := ""
		if tt, ok := ws.tabTypes.Claim(address, opts.Kind); ok {
			kind = tt.Kind
		}
		// The focused card first, then the shown item's, so their tab
		// wins over another item's.
		gs := append(ws.groups(), ws.allGroups()...)
		focus := ws.activePane()
		for i, g := range gs {
			if g == focus {
				gs[0], gs[i] = gs[i], gs[0]
			}
		}
		for _, g := range gs {
			for i, o := range g.tabs {
				if !o.empty && o.kind == kind && o.address == address {
					g.active = i
					ws.selectGroup(g)
					if nav != nil {
						o.nav = nav
						o.navRev++
					}
					ws.changed()
					return o, nil
				}
			}
		}
	}
	p := ws.activePane()
	if cur := p.current(); cur != nil && !newTab {
		if !cur.empty {
			cur.record()
		}
		ws.show(cur, st)
		return cur, nil
	}
	t := &tab{ws: ws}
	ws.place(t)
	ws.show(t, st)
	return t, nil
}

// show makes t show st: its old type lets go of it and its old address is
// released, and it takes a new id, so the type that claims it starts
// afresh.
func (ws *Workspace) show(t *tab, st histState) {
	ws.release(t)
	if t.hold != nil {
		t.hold()
	}
	ws.nextTab++
	t.id = ws.nextTab
	t.empty = false
	t.address, t.path, t.wantKind = st.address, st.path, st.kind
	t.title = filepath.Base(st.path)
	t.kind, t.typeID, t.hold = "", "", nil
	t.nav, t.navRev = st.nav, 0
	if st.nav != nil {
		t.navRev = 1
	}
	if t.page() {
		// Until its type's Title names it.
		t.title = st.kind
		if st.title != "" {
			t.title = st.title
		} else if t.title == "" {
			t.title = st.address
		}
	}
	title := t.title
	ws.claim(t)
	if st.title != "" {
		t.title = title // the title it had there, not its type's guess
	}
	if !t.page() {
		t.hold = ws.res.Hold(st.address)
		ws.noteRecentFile(st.path)
	}
	ws.changed()
}

// openEntry reopens an entry in a new tab.
func (ws *Workspace) openEntry(entry string) {
	if kind, ok := tabtypes.PageKind(entry); ok {
		_, _ = ws.openTab(kind, OpenOptions{NewTab: true})
		return
	}
	if tabtypes.Resourceless(entry) {
		_, _ = ws.openAddress(entry, "", OpenOptions{NewTab: true})
		return
	}
	ws.openIn(entry, nil, true)
}

// openTab shows the page of kind (Workspace.OpenTab): its tab, or
// a new one — a page never takes the place of the file the active tab
// shows (dsh's openTab).
func (ws *Workspace) openTab(kind string, o OpenOptions) (*tab, error) {
	o.Kind = kind
	address := tabtypes.PageAddress(kind)
	if !o.NewTab {
		for _, g := range ws.allGroups() {
			for i, t := range g.tabs {
				if t.address == address && t.kind == kind {
					g.active = i
					ws.selectGroup(g)
					ws.changed()
					return t, nil
				}
			}
		}
	}
	if cur := ws.activePane().current(); cur == nil || !cur.empty {
		o.NewTab = true // a new tab, unless the active one is new
	}
	return ws.openAddress(address, "", o)
}

// goHistory moves t delta steps through its history
// (WorkspaceLeaf.goHistory).
func (ws *Workspace) goHistory(t *tab, delta int) {
	if t == nil || t.empty {
		return
	}
	next, moved := t.state(), false
	for ; delta > 0 && len(t.forward) > 0; delta-- {
		st := t.forward[len(t.forward)-1]
		t.forward = t.forward[:len(t.forward)-1]
		t.back = append(t.back, next)
		next, moved = st, true
	}
	for ; delta < 0 && len(t.back) > 0; delta++ {
		st := t.back[len(t.back)-1]
		t.back = t.back[:len(t.back)-1]
		t.forward = append(t.forward, next)
		next, moved = st, true
	}
	if moved {
		ws.show(t, next)
	}
}

func (ws *Workspace) closeTab(p *pane, i int) {
	if i < 0 || i >= len(p.tabs) {
		return
	}
	t := p.tabs[i]
	if !t.empty {
		ws.release(t)
		if t.hold != nil {
			t.hold()
		}
		ws.closed = append(ws.closed, t.entry())
		if len(ws.closed) > maxClosed {
			ws.closed = ws.closed[len(ws.closed)-maxClosed:]
		}
	}
	p.tabs = append(p.tabs[:i], p.tabs[i+1:]...)
	if p.active > i || p.active >= len(p.tabs) {
		p.active = max(0, p.active-1)
	}
	// A card closes with its tab, and an item with its last card.
	if len(p.tabs) == 0 {
		ws.removeGroup(p)
	}
	ws.changed()
}

func (ws *Workspace) closeActiveTab() {
	p := ws.activePane()
	ws.closeTab(p, p.active)
}

// cycleTab shows the item delta places along the list, wrapping.
func (ws *Workspace) cycleTab(delta int) {
	items := ws.shownItems()
	if n := len(items); n > 1 {
		i := max(0, indexOf(items, ws.root))
		ws.selectItem(items[((i+delta)%n+n)%n])
	}
}

// split puts a new card beside the focused one in dir and shows the
// active tab's file in it, as attention's Split right and Split down
// (Workspace.duplicateLeaf); an empty tab is duplicated as an empty tab.
// An item holds at most maxCards.
func (ws *Workspace) split(dir direction) {
	if len(ws.groups()) >= maxCards {
		return
	}
	t := ws.activeTab()
	g := ws.splitGroup(ws.activePane(), dir, false)
	ws.activeGroup = g
	switch {
	case t == nil || t.empty:
		ws.newTab()
	default:
		// A tab of its own, though the file is open beside it
		// (duplicateLeaf), with the tab's history.
		if d, err := ws.openAddress(t.address, t.path, OpenOptions{Nav: t.nav, Kind: t.wantKind, NewTab: true}); err == nil {
			d.back, d.forward = append([]histState(nil), t.back...), append([]histState(nil), t.forward...)
		}
	}
	ws.changed()
}

// focusDirection focuses the tab group beside the focused one, as
// attention's Navigate tab left/right/above/below.
func (ws *Workspace) focusDirection(dir string) {
	ws.focusGroup(ws.adjacent(ws.activePane(), dir))
}

// closeTabGroup closes the shown item: every card of a split (Close tab
// group).
func (ws *Workspace) closeTabGroup() {
	var ts []*tab
	for _, g := range ws.groups() {
		ts = append(ts, g.tabs...)
	}
	ws.closeTabs(ts)
}

// closeOthersInGroup closes the shown split's other cards (Close others in
// tab group).
func (ws *Workspace) closeOthersInGroup() {
	keep := ws.activeTab()
	var ts []*tab
	for _, g := range ws.groups() {
		for _, t := range g.tabs {
			if t != keep {
				ts = append(ts, t)
			}
		}
	}
	ws.closeTabs(ts)
}

// closeOthers closes every other tab of every item (Close other tabs).
func (ws *Workspace) closeOthers() {
	keep := ws.activeTab()
	if keep == nil {
		return
	}
	for _, g := range ws.allGroups() {
		for i := len(g.tabs) - 1; i >= 0; i-- {
			if g.tabs[i] != keep {
				ws.closeTab(g, i)
			}
		}
	}
}

// ---- changes ----------------------------------------------------------------

// changed notes a layout change: the window title and the saved session.
func (ws *Workspace) changed() {
	if ws.saveSoon != nil {
		ws.saveSoon()
	}
	title := "attention"
	if t := ws.activeTab(); t != nil {
		if t.empty || t.page() {
			title = t.title + " — attention"
		} else {
			title = ws.display(t.path) + " — attention"
		}
	}
	if title != ws.title {
		ws.title = title
		if w := ws.sh.Window(); w != nil {
			w.SetTitle(title)
		}
	}
}

// newTab opens an empty tab: a new item after the shown one.
func (ws *Workspace) newTab() {
	ws.nextTab++
	ws.place(&tab{ws: ws, id: ws.nextTab, empty: true, title: "New tab"})
	ws.changed()
}

// place puts t, a new tab, in the focused card when it has none (a split
// just made, or the empty window), else in a new item after the shown one.
func (ws *Workspace) place(t *tab) {
	p := ws.activePane()
	if len(p.tabs) > 0 {
		p = ws.addItem(indexOf(ws.items, ws.root) + 1)
	}
	p.tabs, p.active = []*tab{t}, 0
}

// undoClose reopens the most recently closed file.
func (ws *Workspace) undoClose() {
	if n := len(ws.closed); n > 0 {
		entry := ws.closed[n-1]
		ws.closed = ws.closed[:n-1]
		ws.openEntry(entry)
	}
}

// gotoTab shows the n-th item (1-based) of the list; n < 1 is the last.
func (ws *Workspace) gotoTab(n int) {
	items := ws.shownItems()
	if len(items) == 0 {
		return
	}
	if n < 1 || n > len(items) {
		n = len(items)
	}
	ws.selectItem(items[n-1])
}

// pane is a card: one tab shown in the content area (attention's
// WorkspaceTabs, held to a single tab).
type pane struct {
	id     int // unique for the run; keys its view
	node   *node
	tabs   []*tab
	active int
	// The view's last frame: the body's box, and where a tab dragged over
	// it would land ("" for none; drag.go).
	bodyBounds ui.Rect
	dropSide   string
}

func (p *pane) indexOf(t *tab) int {
	for i, o := range p.tabs {
		if o == t {
			return i
		}
	}
	return p.active
}

func (p *pane) current() *tab {
	if len(p.tabs) == 0 {
		return nil
	}
	if p.active >= len(p.tabs) {
		p.active = len(p.tabs) - 1
	}
	return p.tabs[p.active]
}

// tab is a tab's identity and what the workspace knows of its file; the
// content is its tab type's (tabtypes).
type tab struct {
	ws    *Workspace
	id    int
	empty bool // a new tab, until a file opens in it
	// kind and typeID are the claiming tab type's, "" while none claims the
	// address; the tab's identity is (kind, address).
	kind   string
	typeID string
	// wantKind is the kind the tab was opened as, "" for the best claim.
	wantKind string
	// closed is the claiming type's Closed, kept from the claim: by the
	// time a type is gone from the registry it can no longer be looked up.
	closed  func(tabID int)
	address string
	path    string
	title   string

	hold   func() // releases the address's resource (resources.Hold)
	nav    *Nav
	navRev int
	// back and forward are where the tab was and went back from, the
	// nearest last (WorkspaceLeaf.backHistory, forwardHistory).
	back, forward []histState
}

// isMissing reports whether t's file is gone.
func (t *tab) isMissing() bool {
	return !t.empty && t.ws != nil && missing(t.ws.res.Get(t.address))
}

func (t *tab) state() histState {
	return histState{address: t.address, path: t.path, kind: t.wantKind, title: t.title, nav: t.nav}
}

// record keeps where t is in its back history before it navigates away,
// unless it is there already (WorkspaceLeaf.recordHistory).
func (t *tab) record() {
	st := t.state()
	if n := len(t.back); n > 0 && t.back[n-1].address == st.address && t.back[n-1].kind == st.kind {
		return
	}
	t.back = append(t.back, st)
	t.forward = nil
}

// page reports whether t shows a page (tabtypes.PageAddress) or a web
// page, not a file.
func (t *tab) page() bool {
	return !t.empty && t.path == ""
}

// entry is what the session and Undo close tab keep of t: its file, or a
// page's address.
func (t *tab) entry() string {
	if t.page() {
		return t.address
	}
	return t.path
}

// histState is where a tab was: what WorkspaceLeaf's history keeps of a
// view state.
type histState struct {
	address, path, kind string
	title               string // a page's, as it was
	nav                 *Nav
}

// missing reports whether a snapshot says the file is gone.
func missing(s resources.Snapshot) bool {
	return s.Status == resources.Failed && errors.Is(s.Err, os.ErrNotExist)
}

func debugf(format string, a ...any) {
	if os.Getenv("ATTENTION_DEBUG") != "" {
		fmt.Fprintf(os.Stderr, "[debug] "+format+"\n", a...)
	}
}
