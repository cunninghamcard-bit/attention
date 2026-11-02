package workspace

import (
	"fmt"
	"math"
	"strconv"
	"strings"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/ui"
	"github.com/smallnest/uix/components/lucide"

	omgui "github.com/cunninghamcard-bit/attention-ui/ui"

	"github.com/cunninghamcard-bit/attention/native/plugins/slots"
	"github.com/cunninghamcard-bit/attention/native/plugins/tabtypes"
)

// view is the center (RFC §5.8: it reads state, never the disk): the
// layout tree's splits and tab groups.
func (ws *Workspace) view(c *ui.Context) {
	ws.flush()
	ws.reclaim()
	ws.paneGroup(c)
}

// ---- panes and tabs -----------------------------------------------------------

// paneGroup is the center: the layout tree's splits and tab groups.
func (ws *Workspace) paneGroup(c *ui.Context) {
	ui.Column(c).Grow(1).Fill().Children(func() { ws.splitView(c, ws.root) })
}

// splitView draws n. mygo's splits take two children, so a split of more
// is drawn nested: child k against the rest, pcts[k] being child k's
// percentage of what is left from it on. A divider dragged during the
// build moves pcts, which become the children's shares again.
func (ws *Workspace) splitView(c *ui.Context, n *node) {
	if n.group != nil {
		ws.paneView(c, n.group)
		return
	}
	kids := append([]*node(nil), n.children...)
	if len(kids) == 1 {
		ws.splitView(c, kids[0])
		return
	}
	shares := n.shares()
	pcts := make([]float32, len(kids)-1)
	rest := float32(100)
	for k := range pcts {
		pcts[k] = shares[k] / rest * 100
		rest -= shares[k]
	}
	set := append([]float32(nil), pcts...)
	ws.splitFrom(c, n, kids, pcts, 0)
	moved := false
	for k := range set {
		moved = moved || math.Abs(float64(set[k]-pcts[k])) > 0.01
	}
	if !moved || len(n.children) != len(kids) {
		return
	}
	rest = 100
	for k, ch := range kids {
		if k == len(pcts) {
			ch.dim = rest
			break
		}
		ch.dim = pcts[k] / 100 * rest
		rest -= ch.dim
	}
	if ws.saveSoon != nil {
		ws.saveSoon()
	}
}

func (ws *Workspace) splitFrom(c *ui.Context, n *node, kids []*node, pcts []float32, k int) {
	if k == len(kids)-1 {
		ws.splitView(c, kids[k])
		return
	}
	first := func() { ws.splitView(c, kids[k]) }
	rest := func() { ws.splitFrom(c, n, kids, pcts, k+1) }
	if n.dir == horizontal {
		ui.SplitVerticalPercent(c, &pcts[k], first, rest).Grow(1).Fill()
	} else {
		ui.SplitPercent(c, &pcts[k], first, rest).Grow(1).Fill()
	}
}

func (ws *Workspace) paneView(c *ui.Context, p *pane) {
	focused := p == ws.activePane()
	alone := len(ws.groups()) == 1
	col := ui.Column(c).Key(fmt.Sprintf("group-%d", p.id)).Grow(1).Fill()
	if col.Clicked() {
		ws.focusGroup(p)
	}
	col.Children(func() {
		if ws.app.Settings().ShowTabBar {
			ws.tabBar(c, p, focused || alone)
		}
		side := p.dropSide
		body := ui.Column(c).Grow(1).Fill().MinHeight(0).Children(func() {
			if tb := p.current(); tb == nil {
				ws.emptyPane(c)
			} else {
				ws.tabBody(c, p, tb, focused || alone)
			}
			if side != "" {
				b := p.bodyBounds
				dropOverlay(c, side, b.W, b.H)
			}
		})
		// The overlay follows the drag a frame behind: where it lands is
		// known once the body has its box.
		p.dropSide, p.bodyBounds = "", body.Bounds()
		if _, over := ui.DragOver[*tab](body); over {
			x, y, _ := body.PointerPosition()
			p.dropSide = dropSide(x, y, p.bodyBounds.W, p.bodyBounds.H)
		}
		if dragged, ok := ui.Drop[*tab](body); ok {
			x, y, _ := body.PointerPosition()
			side := dropSide(x, y, p.bodyBounds.W, p.bodyBounds.H)
			ws.later(func() { ws.dropOn(dragged, p, side) })
		}
	})
}

// tabBar is a group's tab header (WorkspaceTabs): the tabs, New tab, then
// the tab list; the top-right group carries the right sidebar's toggle
// while that sidebar is closed (updateSidebarTogglePlacement).
func (ws *Workspace) tabBar(c *ui.Context, p *pane, focused bool) {
	t := c.Theme()
	p.chips = p.chips[:0]
	padLeft, padRight := float32(4), float32(4)
	if l := ws.lyt; l != nil {
		if !l.Open(slots.Left) && ws.isTopLeft(p) {
			padLeft += l.LeftHeaderSpace(c)
		}
		if !l.Open(slots.Right) && ws.isTopRight(p) {
			padRight += c.TitleBar().Right
		}
	}
	header := ui.Row(c).Height(38).Shrink(0).FillWidth().Background(t.Surface).
		AlignItems(ui.Center).Padding(0, padRight, 0, padLeft).Gap(2)
	borderColor := t.Border
	bgColor := t.Background
	header.DrawOver(func(painter *ui.Painter, rc ui.Rect) {
		y := rc.Y + rc.H - 1
		painter.Fill(ui.Rect{X: rc.X, Y: y, W: rc.W, H: 1}, borderColor, 0)
		if p.active >= 0 && p.active < len(p.chips) {
			ab := p.chips[p.active]
			if ab.W > 2 {
				painter.Fill(ui.Rect{X: ab.X + 1, Y: y, W: ab.W - 2, H: 1}, bgColor, 0)
			}
		}
	})
	if ws.isTop(p) {
		header.DragWindow()
	}
	header.Children(func() {
		// When the left dock is closed and the toggle belongs in the header
		// (ribbon hidden or macOS traffic lights in the corner), it leads the
		// top-left group's tabs (updateSidebarTogglePlacement).
		if l := ws.lyt; l != nil && !l.Open(slots.Left) && l.LeftToggleInHeader(c) && ws.isTopLeft(p) {
			l.ToggleButton(c, slots.Left)
		}
		ui.ScrollHorizontal(c).Grow(1).MinWidth(0).FillHeight().Children(func() {
			ui.Row(c).Padding(4, 6, 0, 6).Gap(2).AlignItems(ui.End).FillHeight().Children(func() {
				for j, tb := range p.tabs {
					ws.tabChip(c, p, j, tb)
				}
				ui.Row(c).Height(32).AlignItems(ui.Center).Children(func() {
					omgui.Button(c, omgui.ButtonProps{Label: "New tab", Icon: lucide.Plus(), Variant: omgui.ButtonGhost, Size: omgui.ButtonIconSmall,
						OnClick: func() { ws.later(func() { ws.activeGroup = p; ws.newTab() }) }}).Tooltip("New tab")
				})
			})
		})
		omgui.IconMenu(c, omgui.IconMenuProps{Label: "Tab list", Icon: lucide.ChevronDown(), End: true, Items: ws.tabListMenu(p)})
		if l := ws.lyt; l != nil && !l.Open(slots.Right) && ws.isTopRight(p) {
			l.ToggleButton(c, slots.Right)
		}
	})
	if dragged, ok := ui.Drop[*tab](header); ok {
		at := insertIndex(p, header)
		ws.later(func() { ws.moveTab(dragged, p, at) })
	}
}

func (ws *Workspace) tabChip(c *ui.Context, p *pane, j int, tb *tab) {
	t := c.Theme()
	title := tb.title
	if tb.isMissing() {
		title += " (deleted)"
	}
	tip := tb.title
	icon := ws.tabIcon(tb)
	var iconColor ui.Color
	if tb.empty {
		icon = nil
	} else if !tb.page() {
		tip = ws.display(tb.path)
		if icons := ws.app.Icons(); !icons.Show {
			icon = nil
		} else {
			iconColor = icons.Color(tb.title, t.Dark)
		}
	}
	selected := j == p.active
	chip := ui.Row(c).Key(fmt.Sprintf("tab-%d", tb.id)).Shrink(0).
		AlignItems(ui.Center).Cursor(ui.CursorPointer).
		Focusable().Role(ui.RoleTab).Checked(selected).Label(title).Tooltip(tip)
	hovered := chip.Hovered()
	fg := t.TextMuted
	weight := 400
	if selected {
		fg = t.Text
		weight = 500
		chip.Height(34).Radius(6, 6, 0, 0).Background(t.Background).
			BorderWidth(1, 1, 0, 1).BorderColor(t.Border)
	} else {
		chip.Height(30).Margin(0, 0, 2, 0).Radius(4)
		if hovered {
			fg = t.Text
			chip.Background(t.SurfaceHover)
		} else if j+1 < len(p.tabs) && j+1 != p.active {
			divColor := t.Border
			chip.DrawOver(func(painter *ui.Painter, rc ui.Rect) {
				painter.Fill(ui.Rect{X: rc.X + rc.W, Y: rc.Y + (rc.H-14)/2, W: 1, H: 14}, divColor, 0)
			})
		}
	}
	chip.TextColor(fg)
	chip.Children(func() {
		ui.Row(c).MaxWidth(160).MinWidth(0).Shrink(0).Padding(0, 6, 0, 10).Gap(6).AlignItems(ui.Center).Children(func() {
			if icon != nil {
				ic := ui.Icon(c, icon).Size(14, 14).Shrink(0)
				if iconColor.A > 0 {
					ic.TextColor(iconColor)
				} else {
					ic.TextColor(fg)
				}
			}
			ui.Text(c, title).FontSize(12.5).LineHeight(1.3).FontWeight(weight).SingleLine().Ellipsis("…").Grow(1).MinWidth(0)
		})
		xbtn := ui.ButtonBase(c).Label("Close "+tb.title).Size(20, 20).
			Radius(4).Margin(0, 4, 0, 0).Shrink(0).AlignItems(ui.Center).
			Justify(ui.Center).Cursor(ui.CursorPointer)
		if xbtn.Hovered() {
			xbtn.Background(t.SurfaceHover)
		}
		xbtn.OnClick(func() { ws.later(func() { ws.closeTabs([]*tab{tb}) }) })
		xbtn.Children(func() {
			if selected || hovered || xbtn.Hovered() {
				ui.Icon(c, lucide.X()).Size(12, 12).TextColor(t.TextMuted)
			}
		})
	})
	chip.ContextMenu(func(m *ui.Menu) { nativeMenu(m, ws.tabMenu(p, tb)) })
	chip.Drag(tb)
	p.chips = append(p.chips, chip.Bounds())
	if chip.Clicked() {
		p.active = j
		ws.activeGroup = p
		ws.changed()
	}
}

// tabListMenu is the tab list (WorkspaceTabs.showTabListMenu): Close all,
// then the group's tabs, the active one checked.
func (ws *Workspace) tabListMenu(p *pane) []omgui.MenuItem {
	items := []omgui.MenuItem{
		{Label: "Close all", Icon: lucide.X(), OnClick: ws.closeAllLater(p)},
		{Separator: true},
	}
	for j, tb := range p.tabs {
		j := j
		items = append(items, omgui.MenuItem{Label: tb.title, Icon: ws.tabIcon(tb), Checked: j == p.active,
			OnClick: func() { p.active, ws.activeGroup = j, p; ws.changed() }})
	}
	return items
}

// tabMenu is a tab's context menu: View.onTabMenu's close items, then More
// options' (WorkspaceLeaf.onOpenTabHeaderMenu).
func (ws *Workspace) tabMenu(p *pane, tb *tab) []omgui.MenuItem {
	at := p.indexOf(tb)
	closing := func(ts func() []*tab) func() {
		return func() {
			ts := append([]*tab(nil), ts()...)
			ws.later(func() { ws.closeTabs(ts) })
		}
	}
	items := []omgui.MenuItem{{Label: "Close", Icon: lucide.X(), OnClick: closing(func() []*tab { return []*tab{tb} })}}
	if len(p.tabs) > 1 {
		items = append(items, omgui.MenuItem{Label: "Close others", Icon: lucide.X(), OnClick: closing(func() []*tab {
			var others []*tab
			for _, o := range p.tabs {
				if o != tb {
					others = append(others, o)
				}
			}
			return others
		})})
	}
	if at < len(p.tabs)-1 {
		items = append(items, omgui.MenuItem{Label: "Close tabs to the right", Icon: lucide.X(), OnClick: closing(func() []*tab {
			return p.tabs[p.indexOf(tb)+1:]
		})})
	}
	if len(p.tabs) > 1 {
		items = append(items, omgui.MenuItem{Label: "Close all", Icon: lucide.X(), OnClick: ws.closeAllLater(p)})
	}
	if tb.empty {
		return items
	}
	tt, _ := ws.tabTypes.Get(tb.typeID)
	return append(append(items, omgui.MenuItem{Separator: true}), ws.paneMenu(p, tb, tt)...)
}

func (ws *Workspace) closeAllLater(p *pane) func() {
	return func() {
		ts := append([]*tab(nil), p.tabs...)
		ws.later(func() { ws.closeTabs(ts) })
	}
}

// isTop reports whether p is along the center's top edge.
func (ws *Workspace) isTop(p *pane) bool {
	rs := map[*pane]rect{}
	ws.root.rects(rect{0, 0, 1, 1}, rs)
	return rs[p].top < 1e-6
}

// isTopLeft reports whether p is the center's top-left group.
func (ws *Workspace) isTopLeft(p *pane) bool {
	rs := map[*pane]rect{}
	ws.root.rects(rect{0, 0, 1, 1}, rs)
	r := rs[p]
	return r.top < 1e-6 && r.left < 1e-6
}

// isTopRight reports whether p is the center's top-right group.
func (ws *Workspace) isTopRight(p *pane) bool {
	rs := map[*pane]rect{}
	ws.root.rects(rect{0, 0, 1, 1}, rs)
	r := rs[p]
	return r.top < 1e-6 && r.right > 1-1e-6
}

func (ws *Workspace) emptyPane(c *ui.Context) {
	t := c.Theme()
	// A command's name and its first hotkey, as the user set them (EmptyView.ts).
	hint := func(id string) {
		cmd := ws.act.Lookup(id)
		if cmd == nil {
			return
		}
		var label string
		if ws.sc != nil {
			label = ws.sc.EffectiveLabel(*cmd)
		}
		text := cmd.Title
		if label != "" {
			text += " (" + label + ")"
		}
		btn := ui.ButtonBase(c).Key("empty-" + id).Label(cmd.Title).Height(32).PaddingX(12).Radius(6).
			AlignItems(ui.Center).Justify(ui.Center).Cursor(ui.CursorPointer)
		fg := t.Accent
		if btn.Hovered() {
			fg = t.AccentHover
			btn.Background(t.SurfaceHover)
		}
		if btn.Clicked() && cmd.Main != nil {
			cmd.Main()
		}
		btn.Children(func() {
			ui.Text(c, text).FontSize(14).TextColor(fg)
		})
	}
	ui.Column(c).Grow(1).Fill().Background(t.Background).Center().Gap(6).Children(func() {
		ui.Text(c, "No file is open").FontSize(18).FontWeight(600).TextColor(t.Text).Margin(0, 0, 8, 0)
		for _, id := range []string{"switcher:open", "command-palette:open", "global-search:open", "app:toggle-left-sidebar", "app:toggle-right-sidebar"} {
			hint(id)
		}
	})
}

// tabBody draws the tab's type's body (the tab.body slot, keyed by the
// type's ID), under a banner while the file is missing.
func (ws *Workspace) tabBody(c *ui.Context, p *pane, tb *tab, focused bool) {
	t := c.Theme()
	if tb.empty {
		ws.emptyPane(c)
		return
	}
	tt, ok := ws.tabTypes.Get(tb.typeID)
	props := ws.props(tb, focused)
	app := ws.app.Settings()
	if app.ShowViewHeader {
		ws.viewHeader(c, p, tb, props, tt, focused)
	}
	if tb.isMissing() {
		banner(c, "This file was deleted or moved. The last loaded content is shown.", t.Warning)
	}
	if !ok {
		centered(c, "No viewer for this file.")
		return
	}
	if app.ShowInline && !tb.page() {
		ui.Text(c, tb.title).FontSize(22).Bold().TextColor(t.Text).Padding(16, 24, 4, 24)
	}
	tt.Body(c, props)
}

// viewHeader is the tab's header, attention's ItemView header: Back and
// Forward, the file's folders and name, the tab type's actions and More
// options.
func (ws *Workspace) viewHeader(c *ui.Context, p *pane, tb *tab, props tabtypes.Props, tt tabtypes.TabType, focused bool) {
	t := c.Theme()
	ui.Row(c).Key(fmt.Sprintf("header-%d", p.id)).Height(36).Shrink(0).FillWidth().PaddingX(8).Gap(2).AlignItems(ui.Center).
		Background(t.Background).BorderWidth(0, 0, 1, 0).BorderColor(t.Border).Children(func() {
		navButton := func(label string, icon *ui.SVG, delta int, n int) {
			// Disabled draws the icon muted, as attention's aria-disabled
			// clickable-icon; enabled draws it in the text colour.
			color := t.Text
			if n == 0 {
				color = ui.Color{}
			}
			omgui.Button(c, omgui.ButtonProps{Label: label, Icon: icon, Variant: omgui.ButtonGhost, Size: omgui.ButtonIconSmall,
				Disabled: n == 0, IconColor: color, OnClick: func() { ws.later(func() { ws.activeGroup = p; ws.goHistory(tb, delta) }) }}).
				Tooltip(label)
		}
		navButton("Back", lucide.ArrowLeft(), -1, len(tb.back))
		navButton("Forward", lucide.ArrowRight(), 1, len(tb.forward))
		if tt.Header != nil {
			tt.Header(c, props)
		} else {
			ws.breadcrumbs(c, tb, focused)
		}
		if tt.Actions != nil {
			tt.Actions(c, props)
		}
		omgui.IconMenu(c, omgui.IconMenuProps{Label: "More options", Icon: lucide.EllipsisVertical(), End: true, Items: ws.paneMenu(p, tb, tt)})
	})
}

// breadcrumbs are the file's folders, then its name
// (FileView.renderBreadcrumbs), centered.
func (ws *Workspace) breadcrumbs(c *ui.Context, tb *tab, focused bool) {
	t := c.Theme()
	ui.Row(c).Grow(1).MinWidth(0).Justify(ui.Center).AlignItems(ui.Center).Gap(4).Children(func() {
		var parts []string
		if !tb.page() {
			parts = strings.Split(ws.display(tb.path), "/")
			parts = parts[:len(parts)-1]
		}
		for _, part := range parts {
			if part == "" {
				continue
			}
			ui.Text(c, part).FontSize(13).TextColor(t.TextMuted)
			ui.Text(c, "/").FontSize(13).TextColor(t.TextMuted)
		}
		// The focused group's name is in the text colour, the others'
		// muted, as attention's inactive view headers.
		name := t.Text
		if !focused {
			name = t.TextMuted
		}
		if !tb.empty && !tb.page() {
			ws.app.Icons().Render(c, tb.title, false, false, t.Dark, 14)
		}
		ui.Text(c, tb.title).FontSize(13).TextColor(name).MaxLines(1)
	})
}

// paneMenu is More options: the tab type's items, then attention's pane
// and file items (ItemView.onPaneMenu, the workspace's file-menu).
func (ws *Workspace) paneMenu(p *pane, tb *tab, tt tabtypes.TabType) []omgui.MenuItem {
	var items []omgui.MenuItem
	if tt.Menu != nil {
		for _, it := range tt.Menu(tb.id) {
			items = append(items, omgui.MenuItem{Label: it.Title, Icon: it.Icon, Checked: it.Checked, OnClick: it.Run})
		}
		if len(items) > 0 {
			items = append(items, omgui.MenuItem{Separator: true})
		}
	}
	split := func(dir direction) func() {
		return func() {
			ws.later(func() {
				if g := ws.groupOf(tb); g != nil {
					ws.activeGroup, g.active = g, g.indexOf(tb)
					ws.split(dir)
				}
			})
		}
	}
	path := tb.path
	items = append(items,
		omgui.MenuItem{Label: "Split right", Icon: lucide.SeparatorVertical(), OnClick: split(vertical)},
		omgui.MenuItem{Label: "Split down", Icon: lucide.SeparatorHorizontal(), OnClick: split(horizontal)},
	)
	if tb.page() {
		return items
	}
	return append(items,
		omgui.MenuItem{Separator: true},
		omgui.MenuItem{Label: "Copy path", Icon: lucide.Copy(), OnClick: func() { mygo.Clipboard.WriteText(ws.display(path)) }},
		omgui.MenuItem{Label: "Copy absolute path", Icon: lucide.HardDrive(), OnClick: func() { mygo.Clipboard.WriteText(path) }},
		omgui.MenuItem{Separator: true},
		omgui.MenuItem{Label: "Open in default app", Icon: lucide.ArrowUpRight(), OnClick: func() { go func() { _ = mygo.Shell.OpenPath(path) }() }},
		omgui.MenuItem{Label: "Show in system explorer", Icon: lucide.Files(), OnClick: func() { go mygo.Shell.ShowItemInFolder(path) }},
	)
}

// ---- status bar ---------------------------------------------------------------

// mountsStatus is the status bar's mounts: the one folder's name, or how
// many.
func (ws *Workspace) mountsStatus(c *ui.Context) {
	mounts := strconv.Itoa(len(ws.mounts)) + " folders"
	if len(ws.mounts) == 1 {
		mounts = ws.mounts[0].Name
	}
	ui.Text(c, mounts).FontSize(12).TextColor(c.Theme().TextMuted)
}

// tabStatus is the active tab's status bar items: its type's, then
// Read-only.
func (ws *Workspace) tabStatus(c *ui.Context) {
	tb := ws.activeTab()
	if tb == nil || tb.empty || tb.page() {
		return
	}
	if tt, ok := ws.tabTypes.Get(tb.typeID); ok && tt.Status != nil {
		tt.Status(c, ws.props(tb, true))
	}
	ui.Text(c, "Read-only").FontSize(12).TextColor(c.Theme().TextMuted)
}

// tabIcon is a tab's icon: its type's, a file's by its name, a new tab's
// globe.
func (ws *Workspace) tabIcon(tb *tab) *ui.SVG {
	if tb.empty {
		return lucide.Globe()
	}
	if tt, ok := ws.tabTypes.Get(tb.typeID); ok && tt.Icon != nil {
		return tt.Icon
	}
	return ws.app.Icons().For(tb.title)
}

// nativeMenu fills a context menu with items.
func nativeMenu(m *ui.Menu, items []omgui.MenuItem) {
	for _, it := range items {
		if it.Separator {
			m.Separator()
			continue
		}
		if m.Item(it.Label).Checked(it.Checked).Disabled(it.Disabled).Chosen() && it.OnClick != nil {
			it.OnClick()
		}
	}
}

func banner(c *ui.Context, text string, color ui.Color) {
	t := c.Theme()
	ui.Row(c).Padding(6, 12).Gap(8).AlignItems(ui.Center).Background(t.Surface).BorderWidth(0, 0, 1, 0).BorderColor(t.Border).Children(func() {
		ui.Icon(c, lucide.TriangleAlert()).Size(14, 14).TextColor(color)
		ui.Text(c, text).FontSize(12)
	})
}

func centered(c *ui.Context, text string) {
	ui.Column(c).Grow(1).Fill().Center().Children(func() {
		ui.Text(c, text).TextColor(c.Theme().TextMuted)
	})
}
