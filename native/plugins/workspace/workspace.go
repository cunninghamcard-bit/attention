package workspace

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"github.com/egoist/mygo/ui"

	fscontract "github.com/cunninghamcard-bit/attention/native/contract/fs"
	projectcontract "github.com/cunninghamcard-bit/attention/native/contract/project"
	"github.com/cunninghamcard-bit/attention/native/resourcesapi"
	"github.com/cunninghamcard-bit/attention/native/shellapi"
	"github.com/cunninghamcard-bit/attention/native/tabtypesapi"
	"github.com/cunninghamcard-bit/attention/native/workspaceapi"
)

// maxClosed is how many closed tabs Undo close tab can bring back.
const maxClosed = 20

// Workspace is the center's state: the tab groups, their tabs, the files
// they show. Every field is read and written on the main thread only: work
// done on goroutines comes back through shellapi.Update (RFC §5.8).
type Workspace struct {
	ctx     context.Context
	fs      fscontract.FS
	project projectcontract.Project

	mounts       []projectcontract.Mount
	mountsLoaded bool

	// root is the center's layout: tab groups in splits (tree.go).
	root        *node
	activeGroup *pane
	nextGroup   int

	nextTab int
	closed  []string // recently closed files, newest last
	// recentFiles are the files opened last, newest first: the quick
	// switcher's recent list (workspaceapi.RecentFiles).
	recentFiles []string
	restoring   *sessionNode // the layout to reopen once the mounts are known
	saveSoon    func()
	title       string
	typesGen    int // the tab type registry's generation last claimed against
}

// pane is a tab group (attention's WorkspaceTabs).
type pane struct {
	id     int // unique for the run; keys its view
	node   *node
	tabs   []*tab
	active int
	// The view's last frame: the tab chips' boxes, the body's, and where
	// a tab dragged over the body would land ("" for none; drag.go).
	chips      []ui.Rect
	bodyBounds ui.Rect
	dropSide   string
}

// tab is a tab's identity and what the workspace knows of its file; the
// content is its tab type's (tabtypesapi).
type tab struct {
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

	hold   func() // releases the address's resource (resourcesapi.Hold)
	nav    *workspaceapi.Nav
	navRev int
	// back and forward are where the tab was and went back from, the
	// nearest last (WorkspaceLeaf.backHistory, forwardHistory).
	back, forward []histState
}

func newWorkspace(ctx context.Context, fs fscontract.FS, project projectcontract.Project) *Workspace {
	ws := &Workspace{
		ctx: ctx, fs: fs, project: project,
		root: &node{dir: vertical},
	}
	ws.root.insert(0, newGroupNode(ws.newPane()))
	return ws
}

// newPane is an empty tab group, not in the tree yet.
func (ws *Workspace) newPane() *pane {
	ws.nextGroup++
	return &pane{id: ws.nextGroup}
}

// addressOf is path's resource address: under its mount, else absolute.
func (ws *Workspace) addressOf(path string) string { return projectcontract.AddressOf(ws.mounts, path) }

// claim gives t the tab type that shows its address now.
func (ws *Workspace) claim(t *tab) {
	tt, ok := tabtypesapi.Claim(t.address, t.wantKind)
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
	gen := tabtypesapi.Generation()
	if gen == ws.typesGen {
		return
	}
	ws.typesGen = gen
	for _, p := range ws.groups() {
		for _, t := range p.tabs {
			if !t.empty {
				ws.claim(t)
			}
		}
	}
}

// props are what t's body is given: its address's resource state, which
// the tab holds for its life.
func (ws *Workspace) props(t *tab, focused bool) tabtypesapi.Props {
	snap := resourcesapi.Get(t.address)
	id := t.id
	return tabtypesapi.Props{Info: tabtypesapi.Info{ID: t.id, Kind: t.kind, Address: t.address, Path: t.path,
		Nav: t.nav, NavRevision: t.navRev, Version: snap.Version, Pending: snap.Status == resourcesapi.Loading,
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

// missing reports whether a snapshot says the file is gone.
func missing(s resourcesapi.Snapshot) bool {
	return s.Status == resourcesapi.Failed && errors.Is(s.Err, os.ErrNotExist)
}

// isMissing reports whether t's file is gone.
func (t *tab) isMissing() bool { return !t.empty && missing(resourcesapi.Get(t.address)) }

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

// activeTab is the active pane's active tab, or nil.
func (ws *Workspace) activeTab() *tab { return ws.activePane().current() }

// mountOf returns the mount holding path and path relative to it.
func (ws *Workspace) mountOf(path string) (projectcontract.Mount, string, bool) {
	return projectcontract.MountOf(ws.mounts, path)
}

// display is a path as the CLI and the tabs' tooltips show it.
func (ws *Workspace) display(path string) string {
	if m, rel, ok := ws.mountOf(path); ok {
		if rel == "." {
			return m.Name
		}
		return projectcontract.Display(m, rel)
	}
	return path
}

// ---- mounts -----------------------------------------------------------------

func (ws *Workspace) setMounts(ms []projectcontract.Mount) {
	ws.mounts = ms
	ws.mountsLoaded = true
	// A file opened before the mounts were known gets its mount address.
	for _, p := range ws.groups() {
		for _, t := range p.tabs {
			if t.empty || t.page() {
				continue
			}
			if a := ws.addressOf(t.path); a != t.address {
				t.hold()
				t.address, t.hold = a, resourcesapi.Hold(a)
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
func (ws *Workspace) open(path string, nav *workspaceapi.Nav) *tab {
	return ws.openIn(path, nav, false)
}

// openIn is open; newTab opens it in a new tab even when one shows path.
func (ws *Workspace) openIn(path string, nav *workspaceapi.Nav, newTab bool) *tab {
	t, _ := ws.openAddress(ws.addressOf(path), path, workspaceapi.OpenOptions{Nav: nav, NewTab: newTab})
	return t
}

// openResource opens a file address, or a web page's
// (workspaceapi.API.OpenResource).
func (ws *Workspace) openResource(address string, o workspaceapi.OpenOptions) (*tab, error) {
	if tabtypesapi.WebAddress(address) {
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
	return projectcontract.PathOf(ws.mounts, address)
}

// openAddress opens path, whose canonical address is address, as
// attention's Workspace.openFile: a tab anywhere that shows it already is
// revealed; else the active tab navigates to it, keeping where it was in
// its history (WorkspaceLeaf.recordHistory); newTab opens it in a new tab
// after the active one instead (getLeaf("tab")).
func (ws *Workspace) openAddress(address, path string, opts workspaceapi.OpenOptions) (*tab, error) {
	if opts.Kind != "" {
		if _, ok := tabtypesapi.Claim(address, opts.Kind); !ok {
			return nil, fmt.Errorf("no tab type of kind %q opens %q", opts.Kind, address)
		}
	}
	nav, newTab := opts.Nav, opts.NewTab
	st := histState{address: address, path: path, kind: opts.Kind, nav: nav}
	if !newTab {
		kind := ""
		if tt, ok := tabtypesapi.Claim(address, opts.Kind); ok {
			kind = tt.Kind
		}
		// The focused group first, so its tab wins over another group's.
		gs := ws.groups()
		focus := ws.activePane()
		for i, g := range gs {
			if g == focus {
				gs[0], gs[i] = gs[i], gs[0]
			}
		}
		for _, g := range gs {
			for i, o := range g.tabs {
				if !o.empty && o.kind == kind && o.address == address {
					g.active, ws.activeGroup = i, g
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
	t := &tab{}
	at := p.active + 1
	if len(p.tabs) == 0 {
		at = 0
	}
	p.tabs = append(p.tabs[:at], append([]*tab{t}, p.tabs[at:]...)...)
	p.active = at
	ws.show(t, st)
	return t, nil
}

// histState is where a tab was: what WorkspaceLeaf's history keeps of a
// view state.
type histState struct {
	address, path, kind string
	title               string // a page's, as it was
	nav                 *workspaceapi.Nav
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
		t.hold = resourcesapi.Hold(st.address)
		ws.noteRecentFile(st.path)
	}
	ws.changed()
}

// page reports whether t shows a page (tabtypesapi.PageAddress) or a web
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

// openEntry reopens an entry in a new tab.
func (ws *Workspace) openEntry(entry string) {
	if kind, ok := tabtypesapi.PageKind(entry); ok {
		_, _ = ws.openTab(kind, workspaceapi.OpenOptions{NewTab: true})
		return
	}
	if tabtypesapi.WebAddress(entry) {
		_, _ = ws.openAddress(entry, "", workspaceapi.OpenOptions{NewTab: true})
		return
	}
	ws.openIn(entry, nil, true)
}

// openTab shows the page of kind (workspaceapi.API.OpenTab): its tab, or
// a new one — a page never takes the place of the file the active tab
// shows (dsh's openTab).
func (ws *Workspace) openTab(kind string, o workspaceapi.OpenOptions) (*tab, error) {
	o.Kind = kind
	address := tabtypesapi.PageAddress(kind)
	if !o.NewTab {
		for _, g := range ws.groups() {
			for i, t := range g.tabs {
				if t.address == address && t.kind == kind {
					g.active, ws.activeGroup = i, g
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
	// A tab group closes with its last tab, unless it is the last one
	// (WorkspaceTabs.removeChild).
	if len(p.tabs) == 0 {
		ws.removeGroup(p)
	}
	ws.changed()
}

func (ws *Workspace) closeActiveTab() {
	p := ws.activePane()
	ws.closeTab(p, p.active)
}

func (ws *Workspace) cycleTab(delta int) {
	p := ws.activePane()
	if n := len(p.tabs); n > 1 {
		p.active = ((p.active+delta)%n + n) % n
		ws.changed()
	}
}

// split puts a new tab group beside the focused one in dir and shows the
// active tab's file in it, as attention's Split right and Split down
// (Workspace.duplicateLeaf); an empty tab is duplicated as an empty tab.
func (ws *Workspace) split(dir direction) {
	t := ws.activeTab()
	g := ws.splitGroup(ws.activePane(), dir, false)
	ws.activeGroup = g
	switch {
	case t == nil || t.empty:
		ws.newTab()
	default:
		// A tab of its own, though the file is open beside it
		// (duplicateLeaf), with the tab's history.
		if d, err := ws.openAddress(t.address, t.path, workspaceapi.OpenOptions{Nav: t.nav, Kind: t.wantKind, NewTab: true}); err == nil {
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

// closeTabGroup closes every tab of the focused group (Close tab group).
func (ws *Workspace) closeTabGroup() {
	p := ws.activePane()
	n := len(p.tabs)
	for i := n - 1; i >= 0; i-- {
		ws.closeTab(p, i)
	}
}

// closeOthersInGroup closes the focused group's other tabs (Close others
// in tab group).
func (ws *Workspace) closeOthersInGroup() {
	p := ws.activePane()
	keep := p.current()
	for i := len(p.tabs) - 1; i >= 0; i-- {
		if p.tabs[i] != keep {
			ws.closeTab(p, i)
		}
	}
}

// closeAll closes p's tabs (the tab list's Close all).
func (ws *Workspace) closeAll(p *pane) {
	for i := len(p.tabs) - 1; i >= 0; i-- {
		ws.closeTab(p, i)
	}
}

// closeOthers closes every other tab in every group (Close other tabs).
func (ws *Workspace) closeOthers() {
	keep := ws.activeTab()
	if keep == nil {
		return
	}
	for _, g := range ws.groups() {
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
		if w := shellapi.Window(); w != nil {
			w.SetTitle(title)
		}
	}
}

func debugf(format string, a ...any) {
	if os.Getenv("ATTENTION_DEBUG") != "" {
		fmt.Fprintf(os.Stderr, "[debug] "+format+"\n", a...)
	}
}

// newTab opens an empty tab after the active one.
func (ws *Workspace) newTab() {
	p := ws.activePane()
	ws.nextTab++
	t := &tab{id: ws.nextTab, empty: true, title: "New tab"}
	at := min(p.active+1, len(p.tabs))
	p.tabs = append(p.tabs[:at], append([]*tab{t}, p.tabs[at:]...)...)
	p.active = at
	ws.changed()
}

// undoClose reopens the most recently closed file.
func (ws *Workspace) undoClose() {
	if n := len(ws.closed); n > 0 {
		entry := ws.closed[n-1]
		ws.closed = ws.closed[:n-1]
		ws.openEntry(entry)
	}
}

// gotoTab activates the n-th tab (1-based) of the active pane; n < 1 is
// the last tab.
func (ws *Workspace) gotoTab(n int) {
	p := ws.activePane()
	if len(p.tabs) == 0 {
		return
	}
	if n < 1 || n > len(p.tabs) {
		n = len(p.tabs)
	}
	p.active = n - 1
	ws.changed()
}
