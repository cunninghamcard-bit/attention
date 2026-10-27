package workspace

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"github.com/egoist/mygo"

	fscontract "github.com/cunninghamcard-bit/attention/native/contract/fs"
	projectcontract "github.com/cunninghamcard-bit/attention/native/contract/project"
	"github.com/cunninghamcard-bit/attention/native/resourcesapi"
	"github.com/cunninghamcard-bit/attention/native/shellapi"
	"github.com/cunninghamcard-bit/attention/native/slotsapi"
	"github.com/cunninghamcard-bit/attention/native/tabtypesapi"
	"github.com/cunninghamcard-bit/attention/native/workspaceapi"
)

// maxClosed is how many closed tabs Undo close tab can bring back.
const maxClosed = 20

// Workspace is the window's whole state. Every field is read and written on
// the main thread only: work done on goroutines comes back through
// shellapi.Update (RFC §5.8).
type Workspace struct {
	ctx     context.Context
	fs      fscontract.FS
	project projectcontract.Project

	mounts       []projectcontract.Mount
	mountsLoaded bool

	panelOpen bool
	leftWidth float32
	leftPanel string // the left dock's shown panel (slotsapi.Panel.ID)
	reveals   map[string]int
	// savedPanels are panel states from the session not handed over yet;
	// restoredPanels the panels that got theirs (or had none).
	savedPanels    map[string]json.RawMessage
	restoredPanels map[string]bool
	rightOpen      bool
	rightWidth     float32
	panes          []*pane
	active         int
	splitPct       float32
	seenLeft       float32 // the widths last saved, to notice a divider drag
	seenSplit      float32

	palette *palette
	notice  string // a workspace-wide message, as a watch error

	files     *projectcontract.Listing // last quick-open listing
	filesBusy bool

	nextTab int
	closed  []string // recently closed files, newest last
	// The quick switcher's recent files and the command palette's recent
	// commands, newest first.
	recentFiles    []string
	recentCommands []string
	restoring      []sessionPane // tabs to reopen once the mounts are known
	restoreActive  int
	saveSoon       func()
	isDark         func() bool // mygo.Theme.IsDark; tests replace it
	title          string
	typesGen       int // the tab type registry's generation last claimed against
}

type pane struct {
	tabs   []*tab
	active int
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
}

func newWorkspace(ctx context.Context, fs fscontract.FS, project projectcontract.Project) *Workspace {
	ws := &Workspace{
		ctx: ctx, fs: fs, project: project,
		panelOpen:      true,
		leftWidth:      260,
		rightWidth:     260,
		reveals:        map[string]int{},
		restoredPanels: map[string]bool{},
		panes:          []*pane{{}},
		splitPct:       50,
		isDark:         mygo.Theme.IsDark,
	}
	return ws
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
	for _, p := range ws.panes {
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
	return tabtypesapi.Props{Info: tabtypesapi.Info{ID: t.id, Kind: t.kind, Address: t.address, Path: t.path,
		Nav: t.nav, NavRevision: t.navRev, Version: snap.Version, Pending: snap.Status == resourcesapi.Loading,
		Missing: missing(snap), Focused: focused}}
}

// missing reports whether a snapshot says the file is gone.
func missing(s resourcesapi.Snapshot) bool {
	return s.Status == resourcesapi.Failed && errors.Is(s.Err, os.ErrNotExist)
}

// isMissing reports whether t's file is gone.
func (t *tab) isMissing() bool { return !t.empty && missing(resourcesapi.Get(t.address)) }

func (ws *Workspace) activePane() *pane {
	if ws.active >= len(ws.panes) {
		ws.active = len(ws.panes) - 1
	}
	return ws.panes[ws.active]
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
	for _, p := range ws.panes {
		for _, t := range p.tabs {
			if a := ws.addressOf(t.path); !t.empty && a != t.address {
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

// open shows path in the active pane, reusing a tab that already shows it,
// and applies nav when given.
func (ws *Workspace) open(path string, nav *workspaceapi.Nav) *tab {
	return ws.openIn(path, nav, false)
}

// openIn is open; newTab opens another tab even when one shows path.
func (ws *Workspace) openIn(path string, nav *workspaceapi.Nav, newTab bool) *tab {
	t, _ := ws.openAddress(ws.addressOf(path), path, workspaceapi.OpenOptions{Nav: nav, NewTab: newTab})
	return t
}

// openResource opens a file address (workspaceapi.API.OpenResource).
func (ws *Workspace) openResource(address string, o workspaceapi.OpenOptions) (*tab, error) {
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

// openAddress opens path, whose canonical address is address.
func (ws *Workspace) openAddress(address, path string, opts workspaceapi.OpenOptions) (*tab, error) {
	if opts.Kind != "" {
		if _, ok := tabtypesapi.Claim(address, opts.Kind); !ok {
			return nil, fmt.Errorf("no tab type of kind %q opens %q", opts.Kind, address)
		}
	}
	nav, newTab := opts.Nav, opts.NewTab
	p := ws.activePane()
	// A file opens in the active new tab, as a browser's address does.
	if cur := p.current(); cur != nil && cur.empty && !newTab {
		p.tabs = append(p.tabs[:p.active], p.tabs[p.active+1:]...)
		p.active = max(0, p.active-1)
		if len(p.tabs) > 0 {
			p.active = min(p.active, len(p.tabs)-1)
		}
	}
	t := &tab{address: address, path: path, title: filepath.Base(path), wantKind: opts.Kind}
	ws.claim(t)
	for i, o := range p.tabs {
		if !newTab && !o.empty && o.kind == t.kind && o.address == t.address {
			p.active = i
			if nav != nil {
				o.nav = nav
				o.navRev++
			}
			ws.changed()
			return o, nil
		}
	}
	ws.nextTab++
	t.id = ws.nextTab
	if nav != nil {
		t.nav, t.navRev = nav, 1
	}
	at := p.active + 1
	if len(p.tabs) == 0 {
		at = 0
	}
	p.tabs = append(p.tabs[:at], append([]*tab{t}, p.tabs[at:]...)...)
	p.active = at
	t.hold = resourcesapi.Hold(address)
	ws.noteRecentFile(path)
	ws.changed()
	return t, nil
}

func (ws *Workspace) closeTab(p *pane, i int) {
	if i < 0 || i >= len(p.tabs) {
		return
	}
	t := p.tabs[i]
	if !t.empty {
		ws.release(t)
		t.hold()
		ws.closed = append(ws.closed, t.path)
		if len(ws.closed) > maxClosed {
			ws.closed = ws.closed[len(ws.closed)-maxClosed:]
		}
	}
	p.tabs = append(p.tabs[:i], p.tabs[i+1:]...)
	if p.active > i || p.active >= len(p.tabs) {
		p.active = max(0, p.active-1)
	}
	// An empty second pane closes.
	if len(p.tabs) == 0 && len(ws.panes) > 1 {
		for j, q := range ws.panes {
			if q == p {
				ws.panes = append(ws.panes[:j], ws.panes[j+1:]...)
				break
			}
		}
		ws.active = 0
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

// splitRight opens a second pane showing the active tab's file, or moves the
// focus between the two panes when there are two.
func (ws *Workspace) splitRight() {
	if len(ws.panes) > 1 {
		ws.active = 1 - ws.active
		ws.changed()
		return
	}
	t := ws.activeTab()
	ws.panes = append(ws.panes, &pane{})
	ws.active = 1
	if t != nil && !t.empty {
		ws.open(t.path, nil)
	}
	ws.changed()
}

// ---- changes ----------------------------------------------------------------

// changed notes a layout change: the window title and the saved session.
func (ws *Workspace) changed() {
	if ws.saveSoon != nil {
		ws.saveSoon()
	}
	title := "attention"
	if t := ws.activeTab(); t != nil {
		if t.empty {
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
		path := ws.closed[n-1]
		ws.closed = ws.closed[:n-1]
		ws.open(path, nil)
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

func (ws *Workspace) toggleLeft() {
	ws.panelOpen = !ws.panelOpen
	ws.changed()
}

func (ws *Workspace) toggleRight() {
	ws.rightOpen = !ws.rightOpen
	ws.changed()
}

// revealPanel opens the dock holding the panel and shows it; its view
// sees the reveal (PanelProps.Reveal) and focuses its input.
func (ws *Workspace) revealPanel(id string) {
	for _, d := range []slotsapi.Dock{slotsapi.Left, slotsapi.Right} {
		for _, p := range slotsapi.Panels(d) {
			if p.ID != id {
				continue
			}
			if d == slotsapi.Left {
				ws.panelOpen, ws.leftPanel = true, id
			} else {
				ws.rightOpen = true
			}
			ws.reveals[id]++
			ws.changed()
			return
		}
	}
}
