package workspace

import (
	"fmt"
	"strings"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/ui"

	"github.com/cunninghamcard-bit/attention/native/plugins/slots"
	"github.com/cunninghamcard-bit/attention/native/plugins/tabtypes"
	aui "github.com/cunninghamcard-bit/attention/native/ui"
	"github.com/cunninghamcard-bit/attention/native/ui/icon"
)

// view is the center (RFC §5.8: it reads state, never the disk): the
// shown item's cards, side by side as its tree splits them.
func (ws *Workspace) view(c *ui.Context) {
	ws.flush()
	ws.reclaim()
	ui.Column(c).Grow(1).Fill().MinWidth(0).MinHeight(0).Children(func() { ws.splitView(c, ws.root) })
}

// splitView draws n: a card, or its children as cards with a gap between
// them, sized by their shares; dragging a gap moves the share across it.
// mygo's splits draw a line in the gap, which cards do not want.
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
	across := n.dir != horizontal
	box := ui.Column(c)
	if across {
		box = ui.Row(c)
	}
	box.Key(fmt.Sprintf("split-%p", n)).Grow(1).Fill().MinWidth(0).MinHeight(0)
	gap := c.Theme().Spacing
	b := box.Bounds()
	total := b.H
	if across {
		total = b.W
	}
	total -= gap * float32(len(kids)-1)
	shares := n.shares()
	box.Children(func() {
		for i, ch := range kids {
			if i > 0 {
				ws.gapHandle(c, n, kids, shares, i, total, across)
			}
			cell := ui.Column(c).Key(fmt.Sprintf("cell-%p", ch)).Grow(shares[i]).MinWidth(0).MinHeight(0)
			if across {
				cell.Width(0).FillHeight()
			} else {
				cell.Height(0).FillWidth()
			}
			cell.Children(func() { ws.splitView(c, ch) })
		}
	})
}

// gapHandle is the gap before kids[i]: dragged, it moves share between
// kids[i-1] and kids[i], each keeping at least a tenth.
func (ws *Workspace) gapHandle(c *ui.Context, n *node, kids []*node, shares []float32, i int, total float32, across bool) {
	gap := c.Theme().Spacing
	h := ui.Box(c).Key(fmt.Sprintf("gap-%p-%d", n, i)).Shrink(0)
	if across {
		h.Width(gap).FillHeight().Cursor(ui.CursorResizeEW)
	} else {
		h.Height(gap).FillWidth().Cursor(ui.CursorResizeNS)
	}
	dx, dy, held := h.Dragged()
	d := dy
	if across {
		d = dx
	}
	if !held || d == 0 || total <= 0 {
		return
	}
	moved := d / total * 100
	a, z := shares[i-1]+moved, shares[i]-moved
	if a < 10 || z < 10 {
		return
	}
	shares[i-1], shares[i] = a, z
	for k, ch := range kids {
		ch.dim = shares[k]
	}
	if ws.saveSoon != nil {
		ws.saveSoon()
	}
}

// paneView is a card: its tab's body, or the empty page, and where a tab
// dragged over it would land. In a split the focused card is ringed.
func (ws *Workspace) paneView(c *ui.Context, p *pane) {
	t := c.Theme()
	focused := p == ws.activePane()
	alone := len(ws.groups()) == 1
	card := aui.Card(c, ui.Column(c).Key(fmt.Sprintf("group-%d", p.id)).Grow(1).Fill().MinWidth(0).MinHeight(0))
	if focused && !alone {
		card.Border(2, t.Accent.Alpha(0.5))
	}
	if card.Clicked() {
		ws.focusGroup(p)
	}
	card.Children(func() {
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

// tabsPanel is the sidebar's list (RFC 0003 §4): New tab, then every item,
// a tab or a split; a row dropped on another goes before it, one dropped
// below the list goes last.
func (ws *Workspace) tabsPanel(c *ui.Context, _ slots.PanelProps) {
	t := c.Theme()
	ui.Column(c).Fill().MinHeight(0).Gap(2).Children(func() {
		if aui.SidebarItem(c, aui.SidebarItemProps{Key: "new-tab", Label: "New tab", Icon: icon.Must("plus")}).Clicked() {
			ws.later(ws.newTab)
		}
		ui.Box(c).Height(1).Shrink(0).FillWidth().Margin(4, 8).Background(aui.Wash(t, 0.08))
		ui.Scroll(c).Grow(1).FillWidth().MinHeight(0).Children(func() {
			ui.Column(c).FillWidth().Gap(2).Children(func() {
				for _, it := range ws.shownItems() {
					ws.itemRow(c, it)
				}
				end := ui.Box(c).Key("tabs-end").FillWidth().Height(48)
				if dragged, ok := ui.Drop[*tab](end); ok {
					ws.later(func() { ws.moveToList(dragged, len(ws.items)) })
				}
			})
		})
	})
}

// itemRow is one item of the list: a tab's row, or a split's.
func (ws *Workspace) itemRow(c *ui.Context, it *node) {
	var cards []*pane
	for _, g := range it.groups(nil) {
		if len(g.tabs) > 0 {
			cards = append(cards, g)
		}
	}
	selected := it == ws.root
	hook := func(el ui.Element, g *pane) {
		tb := g.tabs[0]
		el.Drag(tb)
		el.ContextMenu(func(m *ui.Menu) { nativeMenu(m, ws.tabMenu(g, tb)) })
		if el.Clicked() {
			ws.selectGroup(g)
		}
	}
	var row ui.Element
	if len(cards) == 1 {
		g := cards[0]
		tb := g.tabs[0]
		title, tip, glyph, color := ws.face(c, tb)
		row = aui.TabRow(c, aui.TabRowProps{Key: fmt.Sprintf("tab-%d", tb.id), Title: title, Tooltip: tip,
			Icon: glyph, IconColor: color, Selected: selected, Muted: tb.isMissing(),
			CloseLabel: "Close " + tb.title, OnClose: func() { ws.later(func() { ws.closeTabs([]*tab{tb}) }) }})
		hook(row, g)
	} else {
		parts := make([]aui.SplitPart, len(cards))
		focus := ws.activePane()
		for k, g := range cards {
			title, _, glyph, color := ws.face(c, g.tabs[0])
			parts[k] = aui.SplitPart{Key: fmt.Sprintf("tab-%d", g.tabs[0].id), Title: title, Icon: glyph, IconColor: color,
				Focused: g == focus}
		}
		var els []ui.Element
		row, els = aui.SplitRow(c, fmt.Sprintf("split-row-%p", it), selected, parts)
		for k, el := range els {
			hook(el, cards[k])
		}
	}
	if dragged, ok := ui.Drop[*tab](row); ok {
		at := indexOf(ws.items, it)
		ws.later(func() { ws.moveToList(dragged, at) })
	}
}

// face is how tb shows in the list: its title, tooltip, icon and the
// icon's color (the zero color follows the text).
func (ws *Workspace) face(c *ui.Context, tb *tab) (title, tip string, glyph *ui.SVG, color ui.Color) {
	title, tip = tb.title, tb.title
	if tb.isMissing() {
		title += " (deleted)"
	}
	if tb.empty {
		return title, tip, icon.Must("globe"), ui.Color{}
	}
	glyph = ws.tabIcon(tb)
	if !tb.page() {
		tip = ws.display(tb.path)
		if icons := ws.app.Icons(); !icons.Show {
			glyph = nil
		} else {
			color = icons.Color(tb.title, c.Theme().Dark)
		}
	}
	return title, tip, glyph, color
}

// headNav is Back and Forward for the active tab, beside the window
// controls.
func (ws *Workspace) headNav(c *ui.Context) {
	t := c.Theme()
	tb := ws.activeTab()
	button := func(label string, glyph *ui.SVG, delta, n int) {
		// Disabled draws the icon muted, as attention's aria-disabled
		// clickable-icon; enabled draws it in the text colour.
		color := t.Text
		if n == 0 {
			color = ui.Color{}
		}
		aui.Button(c, aui.ButtonProps{Label: label, Icon: glyph, Variant: aui.ButtonGhost, Size: aui.ButtonIconSmall,
			Disabled: n == 0, IconColor: color, OnClick: func() { ws.later(func() { ws.goHistory(tb, delta) }) }}).
			Tooltip(label)
	}
	back, forward := 0, 0
	if tb != nil {
		back, forward = len(tb.back), len(tb.forward)
	}
	button("Back", icon.Must("arrow-left"), -1, back)
	button("Forward", icon.Must("arrow-right"), 1, forward)
}

// addressBar is the active tab's address: its folders muted, then its
// name (FileView.renderBreadcrumbs), or its type's own Header; then its
// type's Actions and More options. A press on the address opens the quick
// switcher.
func (ws *Workspace) addressBar(c *ui.Context) {
	props := aui.AddressBarProps{OnClick: func() { ws.sl.OpenPalette("switcher") }}
	tb := ws.activeTab()
	if tb == nil || tb.empty {
		props.Name, props.Icon = "Search or open a file", icon.Must("search")
		aui.AddressBar(c, props)
		return
	}
	p := ws.activePane()
	tt, ok := ws.tabTypes.Get(tb.typeID)
	tp := ws.props(tb, true)
	if ok && tt.Header != nil {
		props.Body = func() { tt.Header(c, tp) }
	}
	if tb.page() {
		props.Name, props.Icon = tb.title, ws.tabIcon(tb)
	} else {
		parts := strings.Split(ws.display(tb.path), "/")
		if len(parts) > 1 {
			props.Prefix = strings.Join(parts[:len(parts)-1], "/") + "/"
		}
		props.Name, props.Locked = tb.title, true
	}
	props.Trailing = func() {
		if ok && tt.Actions != nil {
			tt.Actions(c, tp)
		}
		aui.IconMenu(c, aui.IconMenuProps{Label: "More options", Icon: icon.Must("ellipsis-vertical"), End: true,
			Items: ws.paneMenu(p, tb, tt)})
	}
	aui.AddressBar(c, props)
}

// tabMenu is a tab's context menu: Close and Close others, then More
// options' (WorkspaceLeaf.onOpenTabHeaderMenu).
func (ws *Workspace) tabMenu(p *pane, tb *tab) []aui.MenuItem {
	items := []aui.MenuItem{{Label: "Close", Icon: icon.Must("x"), OnClick: func() {
		ws.later(func() { ws.closeTabs([]*tab{tb}) })
	}}}
	if len(ws.allGroups()) > 1 {
		items = append(items, aui.MenuItem{Label: "Close others", Icon: icon.Must("x"), OnClick: func() {
			var others []*tab
			for _, g := range ws.allGroups() {
				for _, o := range g.tabs {
					if o != tb {
						others = append(others, o)
					}
				}
			}
			ws.later(func() { ws.closeTabs(others) })
		}})
	}
	if tb.empty {
		return items
	}
	tt, _ := ws.tabTypes.Get(tb.typeID)
	return append(append(items, aui.MenuItem{Separator: true}), ws.paneMenu(p, tb, tt)...)
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
		ui.Row(c).Key("empty-" + id).Children(func() {
			aui.Button(c, aui.ButtonProps{Label: text, Variant: aui.ButtonLink, OnClick: cmd.Main})
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

// paneMenu is More options: the tab type's items, then attention's pane
// and file items (ItemView.onPaneMenu, the workspace's file-menu).
func (ws *Workspace) paneMenu(p *pane, tb *tab, tt tabtypes.TabType) []aui.MenuItem {
	var items []aui.MenuItem
	if tt.Menu != nil {
		for _, it := range tt.Menu(tb.id) {
			items = append(items, aui.MenuItem{Label: it.Title, Icon: it.Icon, Checked: it.Checked, OnClick: it.Run})
		}
		if len(items) > 0 {
			items = append(items, aui.MenuItem{Separator: true})
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
		aui.MenuItem{Label: "Split right", Icon: icon.Must("separator-vertical"), OnClick: split(vertical)},
		aui.MenuItem{Label: "Split down", Icon: icon.Must("separator-horizontal"), OnClick: split(horizontal)},
	)
	if tb.page() {
		return items
	}
	return append(items,
		aui.MenuItem{Separator: true},
		aui.MenuItem{Label: "Copy path", Icon: icon.Must("copy"), OnClick: func() { mygo.Clipboard.WriteText(ws.display(path)) }},
		aui.MenuItem{Label: "Copy absolute path", Icon: icon.Must("hard-drive"), OnClick: func() { mygo.Clipboard.WriteText(path) }},
		aui.MenuItem{Separator: true},
		aui.MenuItem{Label: "Open in default app", Icon: icon.Must("arrow-up-right"), OnClick: func() { go func() { _ = mygo.Shell.OpenPath(path) }() }},
		aui.MenuItem{Label: "Show in system explorer", Icon: icon.Must("files"), OnClick: func() { go mygo.Shell.ShowItemInFolder(path) }},
	)
}

// ---- status bar ---------------------------------------------------------------

// tabStatus is the active tab's status items, its type's.
func (ws *Workspace) tabStatus(c *ui.Context) {
	tb := ws.activeTab()
	if tb == nil || tb.empty || tb.page() {
		return
	}
	if tt, ok := ws.tabTypes.Get(tb.typeID); ok && tt.Status != nil {
		tt.Status(c, ws.props(tb, true))
	}
}

// tabIcon is a tab's icon: its type's, a file's by its name, a new tab's
// globe.
func (ws *Workspace) tabIcon(tb *tab) *ui.SVG {
	if tb.empty {
		return icon.Must("globe")
	}
	if tt, ok := ws.tabTypes.Get(tb.typeID); ok && tt.Icon != nil {
		return tt.Icon
	}
	return ws.app.Icons().For(tb.title)
}

// nativeMenu fills a context menu with items.
func nativeMenu(m *ui.Menu, items []aui.MenuItem) {
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
		ui.Icon(c, icon.Must("triangle-alert")).Size(14, 14).TextColor(color)
		ui.Text(c, text).FontSize(12)
	})
}

func centered(c *ui.Context, text string) {
	ui.Column(c).Grow(1).Fill().Center().Children(func() {
		ui.Text(c, text).TextColor(c.Theme().TextMuted)
	})
}
