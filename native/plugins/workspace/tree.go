package workspace

import (
	"math"
	"slices"
)

const (
	vertical   direction = "vertical"
	horizontal direction = "horizontal"
)

// direction is a split's, named as attention's: vertical puts its children
// side by side (a vertical divider), horizontal stacks them.
type direction string

// node is an item's layout tree: a split of nodes, or a card (a leaf of
// the tree); an item's root is a split. Port of attention's
// WorkspaceSplit, WorkspaceTabs and WorkspaceParent
// (apps/web/views/workspace).
type node struct {
	parent *node
	// A split's direction and children.
	dir      direction
	children []*node
	// group is set on a tab group.
	group *pane
	// dim is the share of the parent split, in percent; 0 is unset, and a
	// split with an unset child shares equally (WorkspaceItem.setDimension).
	dim float32
}

func newGroupNode(p *pane) *node {
	n := &node{group: p}
	p.node = n
	return n
}

// insert puts child at i, or last when i is out of range.
func (n *node) insert(i int, child *node) {
	child.parent = n
	if i < 0 || i > len(n.children) {
		i = len(n.children)
	}
	n.children = append(n.children[:i], append([]*node{child}, n.children[i:]...)...)
}

func (n *node) indexOf(child *node) int {
	for i, c := range n.children {
		if c == child {
			return i
		}
	}
	return -1
}

func (n *node) replace(old, child *node) {
	if i := n.indexOf(old); i >= 0 {
		old.parent = nil
		child.parent = n
		n.children[i] = child
	}
}

// remove takes child out. A split left empty goes too, and one left with a
// single child gives its place, and its share, to that child; the root
// (parent nil) keeps a single child (WorkspaceParent.removeChild,
// WorkspaceRoot.allowSingleChild).
func (n *node) remove(child *node) {
	i := n.indexOf(child)
	if i < 0 {
		return
	}
	n.children = append(n.children[:i], n.children[i+1:]...)
	child.parent = nil
	if n.parent == nil {
		return
	}
	switch len(n.children) {
	case 0:
		n.parent.remove(n)
	case 1:
		only := n.children[0]
		n.children = nil
		n.parent.replace(n, only)
		only.dim = n.dim
	}
}

// shares are n's children's shares, summing to 100: their dims, or equal
// when one is unset (WorkspaceSplit.recomputeChildrenDimensions).
func (n *node) shares() []float32 {
	out := make([]float32, len(n.children))
	var total float32
	for i, c := range n.children {
		if c.dim <= 0 || math.IsNaN(float64(c.dim)) {
			total = 0
			break
		}
		out[i] = c.dim
		total += c.dim
	}
	for i := range out {
		if total <= 0 {
			out[i] = 100 / float32(len(out))
		} else {
			out[i] = out[i] / total * 100
		}
	}
	return out
}

// groups are the tree's tab groups, in order.
func (n *node) groups(out []*pane) []*pane {
	if n.group != nil {
		return append(out, n.group)
	}
	for _, c := range n.children {
		out = c.groups(out)
	}
	return out
}

// rects lay the tree out in the unit square, by its shares.
func (n *node) rects(r rect, out map[*pane]rect) {
	if n.group != nil {
		out[n.group] = r
		return
	}
	at := 0.0
	for i, s := range n.shares() {
		f := float64(s) / 100
		cr := r
		if n.dir == horizontal {
			h := r.bottom - r.top
			cr.top, cr.bottom = r.top+at*h, r.top+(at+f)*h
		} else {
			w := r.right - r.left
			cr.left, cr.right = r.left+at*w, r.left+(at+f)*w
		}
		n.children[i].rects(cr, out)
		at += f
	}
}

// groups are the shown item's cards, in order.
func (ws *Workspace) groups() []*pane { return ws.root.groups(nil) }

// allGroups are every item's cards, in the list's order.
func (ws *Workspace) allGroups() []*pane {
	var out []*pane
	for _, it := range ws.pinnedItems() {
		out = it.groups(out)
	}
	for _, it := range ws.items {
		out = it.groups(out)
	}
	return out
}

// shownItems are the items the sidebar lists: those holding a tab.
func (ws *Workspace) shownItems() []*node {
	var out []*node
	for _, it := range ws.items {
		if slices.ContainsFunc(it.groups(nil), func(p *pane) bool { return len(p.tabs) > 0 }) {
			out = append(out, it)
		}
	}
	return out
}

// newItem is an item holding one empty card, not in the list yet.
func (ws *Workspace) newItem() *node {
	root := &node{dir: vertical}
	root.insert(0, newGroupNode(ws.newPane()))
	return root
}

// addItem puts a new item at i in the list and shows it; its card is
// returned.
func (ws *Workspace) addItem(i int) *pane {
	it := ws.newItem()
	i = max(0, min(i, len(ws.items)))
	ws.items = slices.Insert(ws.items, i, it)
	ws.selectItem(it)
	return it.children[0].group
}

// selectItem shows it, focusing its first card unless the focus is in it.
func (ws *Workspace) selectItem(it *node) {
	if ws.root == it {
		return
	}
	ws.root = it
	ws.activeGroup = nil
	ws.changed()
}

// selectGroup shows g's item and focuses g.
func (ws *Workspace) selectGroup(g *pane) {
	ws.selectItem(rootOf(g.node))
	ws.focusGroup(g)
}

// removeItem takes it out of the list; the item before it shows when it
// was shown, and an empty list keeps one empty item.
func (ws *Workspace) removeItem(it *node) {
	from, ok := ws.detach(it)
	if !ok {
		return
	}
	if len(ws.items) == 0 {
		ws.items = []*node{ws.newItem()}
	}
	if ws.root == it {
		ws.root = ws.fallback()
		if !from.pinned {
			ws.root = ws.items[max(0, min(from.i-1, len(ws.items)-1))]
		}
		ws.activeGroup = nil
	}
}

// splitGroup puts a new tab group beside g in dir, after it or before:
// beside it in its split when that runs in dir, halving g's share, else in
// a new split in g's place (Workspace.splitItemWithLeaf). The new split
// takes g's share, where attention leaves it on g inside the new split.
func (ws *Workspace) splitGroup(g *pane, dir direction, before bool) *pane {
	next := ws.newPane()
	nn := newGroupNode(next)
	src := g.node
	parent := src.parent
	at := parent.indexOf(src)
	if !before {
		at++
	}
	if parent.dir == dir || len(parent.children) == 1 && parent.parent == nil {
		parent.dir = dir
		if src.dim > 0 {
			src.dim /= 2
			nn.dim = src.dim
		}
		parent.insert(at, nn)
		return next
	}
	wrap := &node{dir: dir, dim: src.dim}
	src.dim = 0
	parent.replace(src, wrap)
	wrap.insert(0, src)
	if before {
		wrap.insert(0, nn)
	} else {
		wrap.insert(1, nn)
	}
	return next
}

// removeGroup takes g out of its item, and the item out of the list with
// its last card.
func (ws *Workspace) removeGroup(g *pane) {
	root := rootOf(g.node)
	if len(root.groups(nil)) <= 1 {
		ws.removeItem(root)
	} else {
		g.node.parent.remove(g.node)
	}
	if ws.activeGroup == g {
		ws.activeGroup = nil
	}
}

// adjacent is the group nearest g in a direction ("top", "bottom", "left",
// "right"), or nil (Workspace.getAdjacentLeafInDirection, over the tree's
// layout rather than the DOM's rects).
func (ws *Workspace) adjacent(g *pane, dir string) *pane {
	rs := map[*pane]rect{}
	ws.root.rects(rect{0, 0, 1, 1}, rs)
	src := rs[g]
	var best *pane
	var bestScore [3]float64
	for _, cand := range ws.groups() {
		if cand == g {
			continue
		}
		score, ok := directionalScore(src, rs[cand], dir)
		if ok && (best == nil || less(score, bestScore)) {
			best, bestScore = cand, score
		}
	}
	return best
}

// rect is a group's place in the center, in units of the center's size.
type rect struct{ left, top, right, bottom float64 }

// directionalScore is attention's getDirectionalLeafScore: the gap along
// the direction, the gap across it, the distance between centers across it.
func directionalScore(s, c rect, dir string) ([3]float64, bool) {
	sx, sy := (s.left+s.right)/2, (s.top+s.bottom)/2
	cx, cy := (c.left+c.right)/2, (c.top+c.bottom)/2
	switch dir {
	case "left":
		if cx >= sx {
			return [3]float64{}, false
		}
		return [3]float64{math.Max(0, s.left-c.right), axisGap(s.top, s.bottom, c.top, c.bottom), math.Abs(sy - cy)}, true
	case "right":
		if cx <= sx {
			return [3]float64{}, false
		}
		return [3]float64{math.Max(0, c.left-s.right), axisGap(s.top, s.bottom, c.top, c.bottom), math.Abs(sy - cy)}, true
	case "top":
		if cy >= sy {
			return [3]float64{}, false
		}
		return [3]float64{math.Max(0, s.top-c.bottom), axisGap(s.left, s.right, c.left, c.right), math.Abs(sx - cx)}, true
	}
	if cy <= sy {
		return [3]float64{}, false
	}
	return [3]float64{math.Max(0, c.top-s.bottom), axisGap(s.left, s.right, c.left, c.right), math.Abs(sx - cx)}, true
}

func axisGap(start, end, cstart, cend float64) float64 {
	switch {
	case cend < start:
		return start - cend
	case cstart > end:
		return cstart - end
	}
	return 0
}

func less(a, b [3]float64) bool {
	for i := range a {
		if a[i] != b[i] {
			return a[i] < b[i]
		}
	}
	return false
}

// rootOf is the root of n's tree: its item.
func rootOf(n *node) *node {
	for n.parent != nil {
		n = n.parent
	}
	return n
}

// indexOf is it's place in items, or -1.
func indexOf(items []*node, it *node) int { return slices.Index(items, it) }
