package workspace

import (
	"encoding/json"
	"os"
	"path/filepath"

	"github.com/cunninghamcard-bit/attention/native/internal/paths"
	"github.com/cunninghamcard-bit/attention/native/tabtypesapi"
)

// session is what reopens the center as it was: tab groups and tabs (the
// docks and the panels' states are the layout plugin's).
type session struct {
	// Main is the center's layout tree (attention's layout "main").
	Main *sessionNode `json:"main,omitempty"`
	// Panes, Active and SplitPct are the layout before the tree: at most
	// two groups side by side. Read, never written.
	Panes       []sessionPane `json:"panes,omitempty"`
	Active      int           `json:"active,omitempty"`
	SplitPct    float32       `json:"splitPct,omitempty"`
	RecentFiles []string      `json:"recentFiles,omitempty"`
}

type sessionPane struct {
	Tabs   []string `json:"tabs"` // file paths; new tabs are not kept
	Active int      `json:"active"`
}

// sessionNode is a split or a tab group, as attention serializes its
// layout (WorkspaceSplit.serialize, WorkspaceItem.serialize).
type sessionNode struct {
	Type      string        `json:"type"` // "split" or "tabs"
	Direction direction     `json:"direction,omitempty"`
	Dimension float32       `json:"dimension,omitempty"`
	Children  []sessionNode `json:"children,omitempty"`
	// A tab group's files, its active tab, and whether it had the focus.
	Tabs    []string `json:"tabs,omitempty"`
	Active  int      `json:"active,omitempty"`
	Focused bool     `json:"focused,omitempty"`
}

// keptTree is sn without the tabs that do not reopen (keepTab) and the
// groups and splits left empty; nil when nothing is left.
func keptTree(sn sessionNode) *sessionNode {
	if sn.Type != "split" {
		kept := sn
		kept.Tabs, kept.Active = nil, 0
		for i, path := range sn.Tabs {
			if keepTab(path) {
				if i == sn.Active {
					kept.Active = len(kept.Tabs)
				}
				kept.Tabs = append(kept.Tabs, path)
			}
		}
		if len(kept.Tabs) == 0 {
			return nil
		}
		return &kept
	}
	kept := sn
	kept.Children = nil
	for _, ch := range sn.Children {
		if k := keptTree(ch); k != nil {
			kept.Children = append(kept.Children, *k)
		}
	}
	if len(kept.Children) == 0 {
		return nil
	}
	return &kept
}

// legacyTree is the layout before the tree as one: the panes side by side.
func legacyTree(s session) *sessionNode {
	if len(s.Panes) == 0 {
		return nil
	}
	root := sessionNode{Type: "split", Direction: vertical}
	for i, p := range s.Panes {
		if i > 1 {
			break
		}
		g := sessionNode{Type: "tabs", Tabs: p.Tabs, Active: p.Active, Focused: i == s.Active}
		if len(s.Panes) > 1 && s.SplitPct > 10 && s.SplitPct < 90 {
			g.Dimension = s.SplitPct
			if i == 1 {
				g.Dimension = 100 - s.SplitPct
			}
		}
		root.Children = append(root.Children, g)
	}
	return &root
}

// loadSession reads the saved session. A deleted file whose directory is
// still there comes back as a missing tab, which shows the file if it
// returns (as a browser keeps a tab whose page is gone); directories and
// files whose directory is gone are dropped. It reads the disk and runs off
// the main thread.
func loadSession() (session, bool) {
	data, err := os.ReadFile(paths.SessionPath())
	if err != nil {
		return session{}, false
	}
	var s session
	if json.Unmarshal(data, &s) != nil {
		return session{}, false
	}
	if s.Main == nil {
		s.Main = legacyTree(s)
	}
	s.Panes = nil
	if s.Main != nil {
		s.Main = keptTree(*s.Main)
	}
	return s, true
}

// keepTab reports whether a saved tab's path reopens.
func keepTab(path string) bool {
	if _, ok := tabtypesapi.PageKind(path); ok || tabtypesapi.WebAddress(path) {
		return true // a page, whose type may load later
	}
	st, err := os.Stat(path)
	if err == nil {
		return !st.IsDir()
	}
	dir, err := os.Stat(filepath.Dir(path))
	return err == nil && dir.IsDir()
}

func (ws *Workspace) snapshot() session {
	s := session{RecentFiles: ws.recentFiles}
	if ws.restoring != nil {
		// The saved tabs are not reopened yet (the mounts are loading): keep
		// them rather than save an empty window over them.
		s.Main = ws.restoring
		return s
	}
	main := ws.serialize(ws.root)
	s.Main = &main
	return s
}

// serialize is n as the session keeps it; new tabs are not kept.
func (ws *Workspace) serialize(n *node) sessionNode {
	if n.group != nil {
		sn := sessionNode{Type: "tabs", Dimension: n.dim, Focused: n.group == ws.activePane()}
		for i, t := range n.group.tabs {
			if t.empty {
				continue
			}
			if i == n.group.active {
				sn.Active = len(sn.Tabs)
			}
			sn.Tabs = append(sn.Tabs, t.entry())
		}
		return sn
	}
	sn := sessionNode{Type: "split", Direction: n.dir, Dimension: n.dim}
	for _, ch := range n.children {
		sn.Children = append(sn.Children, ws.serialize(ch))
	}
	return sn
}

// restoreLayout applies the saved layout; the tabs reopen once the mounts
// are known (setMounts).
func (ws *Workspace) restoreLayout(s session) {
	if s.Main == nil {
		s.Main = legacyTree(s)
	}
	ws.recentFiles = s.RecentFiles
	ws.restoring = s.Main
	if ws.mountsLoaded {
		ws.reopen(ws.restoring)
		ws.restoring = nil
	}
}

// reopen builds the saved layout tree and opens its tabs. Tabs opened
// before it (by the CLI, while the mounts loaded) stay: the saved tabs
// then open beside them, in the focused group.
func (ws *Workspace) reopen(main *sessionNode) {
	if main == nil {
		return
	}
	type saved struct {
		p  *pane
		sn sessionNode
	}
	var groups []saved
	var build func(sn sessionNode) *node
	build = func(sn sessionNode) *node {
		if sn.Type != "split" {
			p := ws.newPane()
			groups = append(groups, saved{p, sn})
			n := newGroupNode(p)
			n.dim = sn.Dimension
			return n
		}
		n := &node{dir: sn.Direction, dim: sn.Dimension}
		if n.dir != horizontal {
			n.dir = vertical
		}
		for _, ch := range sn.Children {
			n.insert(-1, build(ch))
		}
		return n
	}
	hasTabs := false
	for _, g := range ws.groups() {
		hasTabs = hasTabs || len(g.tabs) > 0
	}
	if !hasTabs {
		root := build(*main)
		if root.group != nil {
			root = &node{dir: vertical}
			root.insert(0, groups[0].p.node)
			groups[0].p.node.dim = 0
		}
		root.dim = 0
		ws.root = root
	} else {
		var flat func(sn sessionNode)
		flat = func(sn sessionNode) {
			if sn.Type != "split" {
				groups = append(groups, saved{ws.activePane(), sn})
			}
			for _, ch := range sn.Children {
				flat(ch)
			}
		}
		flat(*main)
	}
	var focus *pane
	for _, g := range groups {
		ws.activeGroup = g.p
		for _, path := range g.sn.Tabs {
			ws.openEntry(path)
		}
		if !hasTabs {
			g.p.active = min(g.sn.Active, max(0, len(g.p.tabs)-1))
		}
		if g.sn.Focused {
			focus = g.p
		}
	}
	if focus != nil {
		ws.activeGroup = focus
	}
	ws.changed()
}
