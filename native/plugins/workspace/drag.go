package workspace

import (
	"github.com/egoist/mygo/ui"
)

// Moving a tab by dragging its chip: onto a tab header to put it among
// those tabs, onto a group's body to move it there, or near the body's
// edge to split the group with it (attention's Workspace.onDragLeaf,
// moveLeafToDropTarget, getDropDirection).

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

// groupOf is the group holding t, or nil.
func (ws *Workspace) groupOf(t *tab) *pane {
	for _, g := range ws.groups() {
		for _, o := range g.tabs {
			if o == t {
				return g
			}
		}
	}
	return nil
}

// moveTab puts t in to at index at, focused; a group it leaves empty
// closes. The tab keeps its type, its address and its history.
func (ws *Workspace) moveTab(t *tab, to *pane, at int) {
	from := ws.groupOf(t)
	if from == nil {
		return
	}
	i := from.indexOf(t)
	from.tabs = append(from.tabs[:i], from.tabs[i+1:]...)
	if from.active > i || from.active >= len(from.tabs) {
		from.active = max(0, from.active-1)
	}
	if from == to && at > i {
		at--
	}
	at = max(0, min(at, len(to.tabs)))
	to.tabs = append(to.tabs[:at], append([]*tab{t}, to.tabs[at:]...)...)
	to.active, ws.activeGroup = at, to
	if from != to && len(from.tabs) == 0 {
		ws.removeGroup(from)
	}
	ws.changed()
}

// dropOn moves t onto target's body at side: into it at the center, else
// into a new group split off target on that side.
func (ws *Workspace) dropOn(t *tab, target *pane, side string) {
	from := ws.groupOf(t)
	if side == "center" {
		if from != target {
			ws.moveTab(t, target, len(target.tabs))
		}
		return
	}
	if from == target && len(from.tabs) == 1 {
		return // splitting a group off itself with its only tab
	}
	dir, before := vertical, side == "left"
	if side == "top" || side == "bottom" {
		dir, before = horizontal, side == "top"
	}
	ws.moveTab(t, ws.splitGroup(target, dir, before), 0)
}

// insertIndex is where a tab dropped on p's header at the pointer goes:
// before the first tab whose middle is right of it (getTabInsertLocation).
func insertIndex(p *pane, header ui.Element) int {
	px, _, _ := header.PointerPosition()
	x := header.Bounds().X + px
	for i, b := range p.chips {
		if x < b.X+b.W/2 {
			return i
		}
	}
	return len(p.tabs)
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
