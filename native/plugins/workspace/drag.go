package workspace

import (
	"slices"

	"github.com/egoist/mygo/ui"
)

// Moving a tab by dragging its row: onto the sidebar's list to put it
// there, or near a card's edge to split the shown item with it
// (attention's Workspace.onDragLeaf, moveLeafToDropTarget,
// getDropDirection).

// dropSide is where a tab dropped at (x, y) in a w×h body lands: the
// nearest edge within a third of the body, else its center
// (Workspace.getDropDirection).
func dropSide(x, y, w, h float32) string {
	if w <= 0 || h <= 0 {
		return "center"
	}
	abs := func(v float32) float32 {
		if v < 0 {
			return -v
		}
		return v
	}
	left, top := abs(x)/w, abs(y)/h
	right, bottom := abs(w-x)/w, abs(h-y)/h
	side, d := "center", float32(1)
	if top < 0.33 && top < d {
		d, side = top, "top"
	}
	if left < 0.33 && left < d {
		d, side = left, "left"
	}
	if right < 0.33 && right < d {
		d, side = right, "right"
	}
	if bottom < 0.33 && bottom < d {
		side = "bottom"
	}
	return side
}

// groupOf is the card holding t, in any item, or nil.
func (ws *Workspace) groupOf(t *tab) *pane {
	for _, g := range ws.allGroups() {
		if slices.Contains(g.tabs, t) {
			return g
		}
	}
	return nil
}

// dropOn moves card from onto target's card at side: near an edge it
// joins the shown item as a new card on that side; at the center it only
// shows. A parked card, which has no tab to move, is refused.
func (ws *Workspace) dropOn(from, target *pane, side string) {
	if from == target || len(from.tabs) == 0 {
		return
	}
	t := from.tabs[0]
	if side == "center" {
		ws.selectGroup(from)
		return
	}
	if rootOf(from.node) != ws.root && len(ws.groups()) >= maxCards {
		return
	}
	dir, before := vertical, side == "left"
	if side == "top" || side == "bottom" {
		dir, before = horizontal, side == "top"
	}
	g := ws.splitGroup(target, dir, before)
	from.tabs = nil
	ws.removeGroup(from)
	g.tabs, g.active = []*tab{t}, 0
	ws.focusGroup(g)
	ws.changed()
}

// dropOverlay shows where a tab dragged over a w×h body would land.
func dropOverlay(c *ui.Context, side string, w, h float32) {
	t := c.Theme()
	o := ui.Box(c).Absolute().Background(t.Accent.Alpha(0.12)).BorderWidth(2, 2, 2, 2).BorderColor(t.Accent.Alpha(0.6))
	third := func(v float32) float32 { return max(v/3, 40) }
	switch side {
	case "left":
		o.Left(0).Top(0).Width(third(w)).Height(h)
	case "right":
		o.Left(w - third(w)).Top(0).Width(third(w)).Height(h)
	case "top":
		o.Left(0).Top(0).Width(w).Height(third(h))
	case "bottom":
		o.Left(0).Top(h - third(h)).Width(w).Height(third(h))
	default:
		o.Left(0).Top(0).Width(w).Height(h)
	}
}
