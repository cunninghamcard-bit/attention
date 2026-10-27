package workspace

import (
	"fmt"
	"math"
	"strconv"
	"strings"
	"sync"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/ui"
	"github.com/smallnest/uix/components/lucide"

	"github.com/cunninghamcard-bit/attention-ui/theme"
	omgui "github.com/cunninghamcard-bit/attention-ui/ui"

	"github.com/cunninghamcard-bit/attention/native/slotsapi"
	"github.com/cunninghamcard-bit/attention/native/tabtypesapi"
)

var (
	themesMu sync.Mutex
	themes   = map[bool]*ui.Theme{}
)

func themeFor(dark bool) *ui.Theme {
	themesMu.Lock()
	defer themesMu.Unlock()
	t, ok := themes[dark]
	if !ok {
		t = theme.For(dark, "default")
		themes[dark] = t
	}
	return t
}

// view is the window's root (RFC §5.8: it reads state, never the disk):
// attention's frame — the ribbon, the left dock, the panes, the right
// dock — over the status bar.
func (ws *Workspace) view(c *ui.Context) {
	c.SetTheme(themeFor(ws.isDark()))
	t := c.Theme()
	ws.reclaim()
	ws.shortcuts(c)
	ui.Column(c).Fill().Background(t.Background).Children(func() {
		ui.Row(c).Grow(1).FillWidth().AlignItems(ui.Stretch).Children(func() {
			ws.ribbon(c)
			center := func() {
				ui.Row(c).Grow(1).Fill().AlignItems(ui.Stretch).Children(func() {
					ws.paneGroup(c)
					if ws.rightOpen {
						ws.dock(c, slotsapi.Right)
					}
				})
			}
			if ws.panelOpen {
				ui.Split(c, &ws.leftWidth, func() { ws.dock(c, slotsapi.Left) }, center).Grow(1)
			} else {
				center()
			}
		})
		ws.statusBar(c)
	})
	if ws.palette != nil {
		ws.paletteView(c)
	}
	// Dragging a divider changes the width during the build: save it.
	if ws.leftWidth != ws.seenLeft {
		ws.seenLeft = ws.leftWidth
		if ws.saveSoon != nil {
			ws.saveSoon()
		}
	}
}

// shortcuts are attention's defaults (apps/web: AppCommands, the command
// palette, the quick switcher), Cmd on macOS and Ctrl elsewhere; the
// editing ones do not apply to a reader. Keys attention leaves unbound get
// ours: Ctrl Shift F, Ctrl B, Ctrl Alt B, Ctrl \, Ctrl Q, Alt Left and
// Right. A tab type's own keys are its body's (markdown's Ctrl E).
func (ws *Workspace) shortcuts(c *ui.Context) {
	digits := []ui.Key{ui.Key1, ui.Key2, ui.Key3, ui.Key4, ui.Key5, ui.Key6, ui.Key7, ui.Key8}
	for i, k := range digits {
		if c.Shortcut(ui.Cmd, k) {
			ws.gotoTab(i + 1)
		}
	}
	switch {
	case c.Shortcut(ui.Cmd, ui.KeyP):
		ws.openPalette(modeCommands)
	case c.Shortcut(ui.Cmd, ui.KeyO):
		ws.openPalette(modeFiles)
	case c.Shortcut(ui.Cmd|ui.Shift, ui.KeyF):
		ws.revealPanel("search")
	case c.Shortcut(ui.Cmd, ui.KeyW):
		ws.closeActiveTab()
	case c.Shortcut(ui.Cmd, ui.KeyT):
		ws.newTab()
	case c.Shortcut(ui.Cmd|ui.Shift, ui.KeyT):
		ws.undoClose()
	case c.Shortcut(ui.Cmd, ui.Key9):
		ws.gotoTab(0)
	case c.Shortcut(ui.Ctrl, ui.KeyTab), c.Shortcut(ui.Cmd|ui.Shift, ui.KeyBracketRight), c.Shortcut(ui.Ctrl, ui.KeyPageDown):
		ws.cycleTab(1)
	case c.Shortcut(ui.Ctrl|ui.Shift, ui.KeyTab), c.Shortcut(ui.Cmd|ui.Shift, ui.KeyBracketLeft), c.Shortcut(ui.Ctrl, ui.KeyPageUp):
		ws.cycleTab(-1)
	case c.Shortcut(ui.Alt, ui.KeyLeft):
		ws.goHistory(ws.activeTab(), -1)
	case c.Shortcut(ui.Alt, ui.KeyRight):
		ws.goHistory(ws.activeTab(), 1)
	case c.Shortcut(ui.Cmd|ui.Alt, ui.KeyB):
		ws.toggleRight()
	case c.Shortcut(ui.Cmd, ui.KeyB):
		ws.toggleLeft()
	case c.Shortcut(ui.Cmd, ui.KeyBackslash):
		ws.split(vertical)
	case c.Shortcut(ui.Cmd, ui.KeyQ):
		mygo.App.Quit()
	}
}

// ---- ribbon and docks ---------------------------------------------------------

// ribbon is attention's side ribbon: the registered actions, top down.
func (ws *Workspace) ribbon(c *ui.Context) {
	t := c.Theme()
	ui.Column(c).Width(40).FillHeight().PaddingY(8).Gap(4).AlignItems(ui.Center).
		Background(t.Surface).BorderWidth(0, 1, 0, 0).BorderColor(t.Border).Children(func() {
		// With the ribbon shown, the left sidebar's toggle tops it
		// (updateSidebarTogglePlacement).
		ws.sidebarToggle(c, slotsapi.Left)
		for _, r := range slotsapi.Ribbon() {
			run := r.Run
			// No Key on the element: it rekeys the button and loses OnClick.
			omgui.Button(c, omgui.ButtonProps{Label: r.Title, Icon: r.Icon, Variant: omgui.ButtonGhost, Size: omgui.ButtonIconSmall, OnClick: run}).
				Tooltip(r.Title)
		}
	})
}

// dock is a sidebar: a header with one icon per panel, then the shown
// panel (attention's sidebar tab headers).
func (ws *Workspace) dock(c *ui.Context, d slotsapi.Dock) {
	t := c.Theme()
	panels := slotsapi.Panels(d)
	col := ui.Column(c).Fill().Background(t.Surface)
	if d == slotsapi.Left {
		col.BorderWidth(0, 1, 0, 0)
	} else {
		col.Width(ws.rightWidth).Shrink(0).BorderWidth(0, 0, 0, 1)
	}
	col.BorderColor(t.Border).Children(func() {
		want := ws.leftPanel
		if d == slotsapi.Right {
			want = ws.rightPanel
		}
		shown := shownPanel(panels, want)
		ui.Row(c).Height(38).Shrink(0).PaddingX(6).Gap(2).AlignItems(ui.Center).
			BorderWidth(0, 0, 1, 0).BorderColor(t.Border).Children(func() {
			// The right sidebar's toggle sits at the start of its header,
			// nearest the center.
			if d == slotsapi.Right {
				ws.sidebarToggle(c, slotsapi.Right)
			}
			for i := range panels {
				p := panels[i]
				color := t.TextMuted
				if shown != nil && shown.ID == p.ID {
					color = t.Text
				}
				b := omgui.Button(c, omgui.ButtonProps{Label: p.Title, Icon: p.Icon, Variant: omgui.ButtonGhost, Size: omgui.ButtonIconSmall, IconColor: color}).
					Key("panel:" + p.ID).Checked(shown != nil && shown.ID == p.ID).Tooltip(p.Title)
				if b.Clicked() {
					ws.revealPanel(p.ID)
				}
			}
		})
		if shown == nil {
			centered(c, "No panels")
			return
		}
		ws.restorePanel(shown)
		ui.Column(c).Key("dock:" + shown.ID).Grow(1).FillWidth().MinHeight(0).Children(func() {
			shown.View(c, slotsapi.PanelProps{Reveal: ws.reveals[shown.ID]})
		})
	})
}

// shownPanel is a dock's shown panel: the chosen one while it is
// registered, else the first.
func shownPanel(panels []slotsapi.Panel, want string) *slotsapi.Panel {
	for i := range panels {
		if panels[i].ID == want {
			return &panels[i]
		}
	}
	if len(panels) > 0 {
		return &panels[0]
	}
	return nil
}

// ---- panes and tabs -----------------------------------------------------------

// paneGroup is the center: the layout tree's splits and tab groups.
func (ws *Workspace) paneGroup(c *ui.Context) {
	ui.Column(c).Grow(1).Fill().Children(func() { ws.splitView(c, ws.root) })
}

// splitView draws n. mygo's splits take two children, so a split of more
// is drawn nested: child k against the rest, pcts[k] being child k's
// percentage of what is left from it on. A divider dragged during the
// build moves pcts, which become the children's shares again. A click
// during the build may change the tree (closing a group's last tab), so
// the build walks a copy of the children and leaves the shares alone when
// they changed: the next frame draws the new tree.
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
		ws.tabBar(c, p, focused || alone)
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
			ws.dropOn(dragged, p, dropSide(x, y, p.bodyBounds.W, p.bodyBounds.H))
		}
	})
}

// tabBar is a group's tab header (WorkspaceTabs): the tabs, New tab, then
// the tab list; the top-right group carries the right sidebar's toggle
// while that sidebar is closed (updateSidebarTogglePlacement).
func (ws *Workspace) tabBar(c *ui.Context, p *pane, focused bool) {
	t := c.Theme()
	p.chips = p.chips[:0]
	header := ui.Row(c).Height(38).Shrink(0).FillWidth().Background(t.Surface).BorderWidth(0, 0, 1, 0).BorderColor(t.Border).
		AlignItems(ui.Center).PaddingX(4).Gap(2).Children(func() {
		ui.ScrollHorizontal(c).Grow(1).MinWidth(0).FillHeight().Children(func() {
			ui.Row(c).PaddingX(6).Gap(2).AlignItems(ui.Center).FillHeight().Children(func() {
				for j, tb := range p.tabs {
					ws.tabChip(c, p, j, tb)
				}
				omgui.Button(c, omgui.ButtonProps{Label: "New tab", Icon: lucide.Plus(), Variant: omgui.ButtonGhost, Size: omgui.ButtonIconSmall,
					OnClick: func() { ws.activeGroup = p; ws.newTab() }}).Tooltip("New tab")
			})
		})
		omgui.IconMenu(c, omgui.IconMenuProps{Label: "Tab list", Icon: lucide.ChevronDown(), End: true, Items: ws.tabListMenu(p)})
		if !ws.rightOpen && ws.isTopRight(p) {
			ws.sidebarToggle(c, slotsapi.Right)
		}
	})
	if dragged, ok := ui.Drop[*tab](header); ok {
		ws.moveTab(dragged, p, insertIndex(p, header))
	}
}

func (ws *Workspace) tabChip(c *ui.Context, p *pane, j int, tb *tab) {
	title := tb.title
	if tb.isMissing() {
		title += " (deleted)"
	}
	tip := tb.title
	icon := fileIcon(tb.title)
	if tb.empty {
		icon = lucide.Globe()
	} else {
		tip = ws.display(tb.path)
	}
	// Each group shows its active tab, as attention's is-active.
	chip := omgui.TabChip(c, omgui.TabChipProps{
		Key: fmt.Sprintf("tab-%d", tb.id), Title: title, Icon: icon, Tooltip: tip,
		Selected:   j == p.active,
		CloseLabel: "Close " + tb.title,
		OnClose:    func() { ws.closeTab(p, j) },
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
		{Label: "Close all", Icon: lucide.X(), OnClick: func() { ws.closeAll(p) }},
		{Separator: true},
	}
	for j, tb := range p.tabs {
		j := j
		items = append(items, omgui.MenuItem{Label: tb.title, Icon: fileIcon(tb.title), Checked: j == p.active,
			OnClick: func() { p.active, ws.activeGroup = j, p; ws.changed() }})
	}
	return items
}

// tabMenu is a tab's context menu: View.onTabMenu's close items, then More
// options' (WorkspaceLeaf.onOpenTabHeaderMenu).
func (ws *Workspace) tabMenu(p *pane, tb *tab) []omgui.MenuItem {
	at := func() int { return p.indexOf(tb) }
	items := []omgui.MenuItem{{Label: "Close", Icon: lucide.X(), OnClick: func() { ws.closeTab(p, at()) }}}
	if len(p.tabs) > 1 {
		items = append(items, omgui.MenuItem{Label: "Close others", Icon: lucide.X(), OnClick: func() {
			p.active, ws.activeGroup = at(), p
			ws.closeOthersInGroup()
		}})
	}
	if at() < len(p.tabs)-1 {
		items = append(items, omgui.MenuItem{Label: "Close tabs to the right", Icon: lucide.X(), OnClick: func() {
			for i := len(p.tabs) - 1; i > at(); i-- {
				ws.closeTab(p, i)
			}
		}})
	}
	if len(p.tabs) > 1 {
		items = append(items, omgui.MenuItem{Label: "Close all", Icon: lucide.X(), OnClick: func() { ws.closeAll(p) }})
	}
	if tb.empty {
		return items
	}
	tt, _ := tabtypesapi.Get(tb.typeID)
	return append(append(items, omgui.MenuItem{Separator: true}), ws.paneMenu(p, tb, tt)...)
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

// isTopRight reports whether p is the center's top-right group.
func (ws *Workspace) isTopRight(p *pane) bool {
	rs := map[*pane]rect{}
	ws.root.rects(rect{0, 0, 1, 1}, rs)
	r := rs[p]
	return r.top < 1e-6 && r.right > 1-1e-6
}

// sidebarToggle is a sidebar's toggle button, Collapse while it is open and
// Expand while closed (createSidebarToggleButton).
func (ws *Workspace) sidebarToggle(c *ui.Context, d slotsapi.Dock) {
	open, icon, toggle := ws.panelOpen, lucide.PanelLeft(), ws.toggleLeft
	if d == slotsapi.Right {
		open, icon, toggle = ws.rightOpen, lucide.PanelRight(), ws.toggleRight
	}
	tip := "Expand"
	if open {
		tip = "Collapse"
	}
	omgui.Button(c, omgui.ButtonProps{Label: tip, Icon: icon, Variant: omgui.ButtonGhost, Size: omgui.ButtonIconSmall, OnClick: toggle}).Tooltip(tip)
}

func (ws *Workspace) emptyPane(c *ui.Context) {
	t := c.Theme()
	hint := func(label, keys string) {
		ui.Row(c).Gap(24).Children(func() {
			ui.Text(c, label).TextColor(t.TextMuted).Width(160)
			ui.Text(c, keys).TextColor(t.TextMuted)
		})
	}
	ui.Column(c).Grow(1).Fill().Center().Gap(10).Children(func() {
		ui.Text(c, "attention").FontSize(22).Bold().TextColor(t.TextMuted)
		hint("Open quick switcher", "Ctrl O")
		hint("Open command palette", "Ctrl P")
		hint("Search in all files", "Ctrl Shift F")
		hint("Toggle left sidebar", "Ctrl B")
		hint("Toggle right sidebar", "Ctrl Alt B")
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
	tt, ok := tabtypesapi.Get(tb.typeID)
	props := ws.props(tb, focused)
	ws.viewHeader(c, p, tb, props, tt, focused)
	if tb.isMissing() {
		banner(c, "This file was deleted or moved. The last loaded content is shown.", t.Warning)
	}
	if !ok {
		centered(c, "No viewer for this file.")
		return
	}
	tt.Body(c, props)
}

// viewHeader is the tab's header, attention's ItemView header: Back and
// Forward, the file's folders and name, the tab type's actions and More
// options.
func (ws *Workspace) viewHeader(c *ui.Context, p *pane, tb *tab, props tabtypesapi.Props, tt tabtypesapi.TabType, focused bool) {
	t := c.Theme()
	ui.Row(c).Key(fmt.Sprintf("header-%d", p.id)).Height(38).Shrink(0).FillWidth().PaddingX(8).Gap(2).AlignItems(ui.Center).
		BorderWidth(0, 0, 1, 0).BorderColor(t.Border).Children(func() {
		navButton := func(label string, icon *ui.SVG, delta int, n int) {
			// Disabled draws the icon muted, as attention's aria-disabled
			// clickable-icon; enabled draws it in the text colour.
			color := t.Text
			if n == 0 {
				color = ui.Color{}
			}
			omgui.Button(c, omgui.ButtonProps{Label: label, Icon: icon, Variant: omgui.ButtonGhost, Size: omgui.ButtonIconSmall,
				Disabled: n == 0, IconColor: color, OnClick: func() { ws.activeGroup = p; ws.goHistory(tb, delta) }}).
				Tooltip(label)
		}
		navButton("Back", lucide.ArrowLeft(), -1, len(tb.back))
		navButton("Forward", lucide.ArrowRight(), 1, len(tb.forward))
		// The folders, then the name (FileView.renderBreadcrumbs), centered.
		ui.Row(c).Grow(1).MinWidth(0).Justify(ui.Center).AlignItems(ui.Center).Gap(4).Children(func() {
			parts := strings.Split(ws.display(tb.path), "/")
			for _, part := range parts[:len(parts)-1] {
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
			ui.Text(c, tb.title).FontSize(13).TextColor(name).MaxLines(1)
		})
		if tt.Actions != nil {
			tt.Actions(c, props)
		}
		omgui.IconMenu(c, omgui.IconMenuProps{Label: "More options", Icon: lucide.EllipsisVertical(), End: true, Items: ws.paneMenu(p, tb, tt)})
	})
}

// paneMenu is More options: the tab type's items, then attention's pane
// and file items (ItemView.onPaneMenu, the workspace's file-menu).
func (ws *Workspace) paneMenu(p *pane, tb *tab, tt tabtypesapi.TabType) []omgui.MenuItem {
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
		return func() { ws.activeGroup, p.active = p, p.indexOf(tb); ws.split(dir) }
	}
	path := tb.path
	return append(items,
		omgui.MenuItem{Label: "Split right", Icon: lucide.SeparatorVertical(), OnClick: split(vertical)},
		omgui.MenuItem{Label: "Split down", Icon: lucide.SeparatorHorizontal(), OnClick: split(horizontal)},
		omgui.MenuItem{Separator: true},
		omgui.MenuItem{Label: "Copy path", Icon: lucide.Copy(), OnClick: func() { mygo.Clipboard.WriteText(ws.display(path)) }},
		omgui.MenuItem{Label: "Copy absolute path", Icon: lucide.HardDrive(), OnClick: func() { mygo.Clipboard.WriteText(path) }},
		omgui.MenuItem{Separator: true},
		omgui.MenuItem{Label: "Open in default app", Icon: lucide.ArrowUpRight(), OnClick: func() { go func() { _ = mygo.Shell.OpenPath(path) }() }},
		omgui.MenuItem{Label: "Show in system explorer", Icon: lucide.Files(), OnClick: func() { go mygo.Shell.ShowItemInFolder(path) }},
	)
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

// ---- status bar ---------------------------------------------------------------

func (ws *Workspace) statusBar(c *ui.Context) {
	t := c.Theme()
	ui.Row(c).Height(26).FillWidth().PaddingX(10).Gap(14).AlignItems(ui.Center).
		Background(t.Surface).BorderWidth(1, 0, 0, 0).BorderColor(t.Border).Children(func() {
		mounts := strconv.Itoa(len(ws.mounts)) + " folders"
		if len(ws.mounts) == 1 {
			mounts = ws.mounts[0].Name
		}
		ui.Text(c, mounts).FontSize(12).TextColor(t.TextMuted)
		if ws.notice != "" {
			ui.Icon(c, lucide.TriangleAlert()).Size(12, 12).TextColor(t.Warning).Tooltip(ws.notice)
		}
		ui.Box(c).Grow(1)
		tb := ws.activeTab()
		if tb == nil || tb.empty {
			return
		}
		if tt, ok := tabtypesapi.Get(tb.typeID); ok && tt.Status != nil {
			tt.Status(c, ws.props(tb, true))
		}
		ui.Text(c, "Read-only").FontSize(12).TextColor(t.TextMuted)
	})
}
