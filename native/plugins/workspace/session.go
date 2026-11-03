package workspace

import (
	"encoding/json"
	"os"
	"path/filepath"
	"slices"

	"github.com/cunninghamcard-bit/attention/native/internal/paths"
	"github.com/cunninghamcard-bit/attention/native/plugins/tabtypes"
)

// session is what reopens the center as it was: the sidebar's list (the
// sidebar's and the panels' states are the layout plugin's).
type session struct {
	// Items are the list, each a layout tree whose tab groups hold one
	// tab (RFC 0003 §4); Current is the one shown.
	Items   []sessionNode `json:"items,omitempty"`
	Current int           `json:"current,omitempty"`
	// Main, Panes, Active and SplitPct are the layouts before the list:
	// attention's tree, and before it at most two groups side by side.
	// Read, never written.
	Main        *sessionNode  `json:"main,omitempty"`
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
	migrate(&s)
	var kept []sessionNode
	current := 0
	for i, it := range s.Items {
		if k := keptTree(it); k != nil {
			if i <= s.Current {
				current = len(kept)
			}
			kept = append(kept, *k)
		}
	}
	s.Items, s.Current = kept, current
	return s, true
}

// migrate turns a session from before the list into one: a tree of
// several groups becomes a split of their active tabs, shown, followed by
// their other tabs one item each; a single group, its tabs one item each.
func migrate(s *session) {
	if s.Items != nil {
		return
	}
	tree := s.Main
	if tree == nil {
		tree = legacyTree(*s)
	}
	s.Main, s.Panes = nil, nil
	if tree == nil {
		return
	}
	var leaves []sessionNode
	var walk func(sn sessionNode)
	walk = func(sn sessionNode) {
		if sn.Type != "split" {
			leaves = append(leaves, sn)
		}
		for _, ch := range sn.Children {
			walk(ch)
		}
	}
	walk(*tree)
	one := func(path string) sessionNode {
		return sessionNode{Type: "split", Direction: vertical, Children: []sessionNode{{Type: "tabs", Tabs: []string{path}}}}
	}
	if len(leaves) == 1 {
		for _, path := range leaves[0].Tabs {
			s.Items = append(s.Items, one(path))
		}
		s.Current = leaves[0].Active
		return
	}
	var actives func(sn sessionNode) sessionNode
	actives = func(sn sessionNode) sessionNode {
		if sn.Type != "split" {
			if len(sn.Tabs) > 0 {
				sn.Tabs = []string{sn.Tabs[min(max(sn.Active, 0), len(sn.Tabs)-1)]}
			}
			sn.Active = 0
			return sn
		}
		kids := make([]sessionNode, len(sn.Children))
		for i, ch := range sn.Children {
			kids[i] = actives(ch)
		}
		sn.Children = kids
		return sn
	}
	s.Items, s.Current = []sessionNode{actives(*tree)}, 0
	for _, g := range leaves {
		for i, path := range g.Tabs {
			if i != g.Active {
				s.Items = append(s.Items, one(path))
			}
		}
	}
}

// keepTab reports whether a saved tab's path reopens.
func keepTab(path string) bool {
	if _, ok := tabtypes.PageKind(path); ok || tabtypes.WebAddress(path) {
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
	ws.flush()
	s := session{RecentFiles: ws.recentFiles}
	if ws.restoring != nil {
		// The saved tabs are not reopened yet (the mounts are loading): keep
		// them rather than save an empty window over them.
		s.Items, s.Current = ws.restoring.Items, ws.restoring.Current
		return s
	}
	for _, it := range ws.items {
		sn := ws.serialize(it)
		if !hasTabs(sn) {
			continue
		}
		if it == ws.root {
			s.Current = len(s.Items)
		}
		s.Items = append(s.Items, sn)
	}
	return s
}

// serialize is n as the session keeps it; new tabs are not kept.
func (ws *Workspace) serialize(n *node) sessionNode {
	if n.group != nil {
		sn := sessionNode{Type: "tabs", Dimension: n.dim, Focused: n.group == ws.activeGroup}
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

// restoreLayout applies the saved list; the tabs reopen once the mounts
// are known (setMounts).
func (ws *Workspace) restoreLayout(s session) {
	migrate(&s)
	ws.recentFiles = s.RecentFiles
	ws.restoring = &s
	if ws.mountsLoaded {
		ws.reopen(ws.restoring)
		ws.restoring = nil
	}
}

// reopen builds the saved items and opens their tabs, each in its card.
// Tabs opened before it (by the CLI, while the mounts loaded) stay shown,
// the saved items listed after theirs.
func (ws *Workspace) reopen(s *session) {
	if s == nil || len(s.Items) == 0 {
		return
	}
	shown, focus := ws.root, ws.activeGroup
	fresh := len(ws.shownItems()) == 0
	if fresh {
		ws.items = nil
	}
	for k, sn := range s.Items {
		type leaf struct {
			p  *pane
			sn sessionNode
		}
		var leaves []leaf
		var build func(sn sessionNode) *node
		build = func(sn sessionNode) *node {
			if sn.Type != "split" {
				p := ws.newPane()
				leaves = append(leaves, leaf{p, sn})
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
		root := build(sn)
		if root.group != nil {
			wrap := &node{dir: vertical}
			wrap.insert(0, root)
			root = wrap
		}
		root.dim = 0
		ws.items = append(ws.items, root)
		ws.root = root
		var focused *pane
		for _, l := range leaves {
			ws.activeGroup = l.p
			if len(l.sn.Tabs) > 0 {
				ws.openEntry(l.sn.Tabs[min(max(l.sn.Active, 0), len(l.sn.Tabs)-1)])
			}
			if l.sn.Focused {
				focused = l.p
			}
		}
		for _, l := range leaves {
			if len(l.p.tabs) == 0 && indexOf(ws.items, rootOf(l.p.node)) >= 0 {
				ws.removeGroup(l.p)
			}
		}
		if fresh && k == s.Current && indexOf(ws.items, root) >= 0 {
			shown, focus = root, focused
		}
	}
	if len(ws.items) == 0 {
		ws.items = []*node{ws.newItem()}
	}
	if indexOf(ws.items, shown) < 0 {
		shown, focus = ws.items[0], nil
	}
	ws.root, ws.activeGroup = shown, focus
	ws.changed()
}

// hasTabs reports whether sn keeps a tab.
func hasTabs(sn sessionNode) bool {
	if len(sn.Tabs) > 0 {
		return true
	}
	return slices.ContainsFunc(sn.Children, hasTabs)
}
