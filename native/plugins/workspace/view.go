package workspace

import (
	"fmt"
	"math"
	"strconv"
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
// ours: Ctrl Shift F, Ctrl B, Ctrl Alt B, Ctrl \, Ctrl Q. A tab type's own keys are its
// body's (markdown's Ctrl E).
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
		for _, r := range slotsapi.Ribbon() {
			run := r.Run
			omgui.Button(c, omgui.ButtonProps{Label: r.Title, Icon: r.Icon, Variant: omgui.ButtonGhost, Size: omgui.ButtonIconSmall, OnClick: run}).
				Key("ribbon:" + r.ID).Tooltip(r.Title)
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
// build moves pcts, which become the children's shares again.
func (ws *Workspace) splitView(c *ui.Context, n *node) {
	if n.group != nil {
		ws.paneView(c, n.group)
		return
	}
	if len(n.children) == 1 {
		ws.splitView(c, n.children[0])
		return
	}
	shares := n.shares()
	if len(n.pcts) != len(shares)-1 {
		n.pcts = make([]float32, len(shares)-1)
	}
	rest := float32(100)
	for k := range n.pcts {
		n.pcts[k] = shares[k] / rest * 100
		rest -= shares[k]
	}
	set := append([]float32(nil), n.pcts...)
	ws.splitFrom(c, n, 0)
	moved := false
	for k := range set {
		moved = moved || math.Abs(float64(set[k]-n.pcts[k])) > 0.01
	}
	if !moved {
		return
	}
	rest = 100
	for k, ch := range n.children {
		if k == len(n.pcts) {
			ch.dim = rest
			break
		}
		ch.dim = n.pcts[k] / 100 * rest
		rest -= ch.dim
	}
	if ws.saveSoon != nil {
		ws.saveSoon()
	}
}

func (ws *Workspace) splitFrom(c *ui.Context, n *node, k int) {
	if k == len(n.children)-1 {
		ws.splitView(c, n.children[k])
		return
	}
	first := func() { ws.splitView(c, n.children[k]) }
	rest := func() { ws.splitFrom(c, n, k+1) }
	if n.dir == horizontal {
		ui.SplitVerticalPercent(c, &n.pcts[k], first, rest).Grow(1).Fill()
	} else {
		ui.SplitPercent(c, &n.pcts[k], first, rest).Grow(1).Fill()
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
		tb := p.current()
		if tb == nil {
			ws.emptyPane(c)
			return
		}
		ws.tabBody(c, tb, focused || alone)
	})
}

func (ws *Workspace) tabBar(c *ui.Context, p *pane, focused bool) {
	t := c.Theme()
	ui.ScrollHorizontal(c).Height(38).FillWidth().Background(t.Surface).BorderWidth(0, 0, 1, 0).BorderColor(t.Border).Children(func() {
		ui.Row(c).PaddingX(6).Gap(2).AlignItems(ui.Center).FillHeight().Children(func() {
			for j, tb := range p.tabs {
				j, tb := j, tb
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
				chip := omgui.TabChip(c, omgui.TabChipProps{
					Key: fmt.Sprintf("tab-%d", tb.id), Title: title, Icon: icon, Tooltip: tip,
					Selected:   j == p.active && focused,
					CloseLabel: "Close " + tb.title,
					OnClose:    func() { ws.closeTab(p, j) },
				})
				if chip.Clicked() {
					p.active = j
					ws.activeGroup = p
					ws.changed()
				}
			}
		})
	})
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
func (ws *Workspace) tabBody(c *ui.Context, tb *tab, focused bool) {
	t := c.Theme()
	if tb.empty {
		ws.emptyPane(c)
		return
	}
	if tb.isMissing() {
		banner(c, "This file was deleted or moved. The last loaded content is shown.", t.Warning)
	}
	tt, ok := tabtypesapi.Get(tb.typeID)
	if !ok {
		centered(c, "No viewer for this file.")
		return
	}
	tt.Body(c, ws.props(tb, focused))
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
		if ui.Icon(c, lucide.PanelLeft()).Size(14, 14).TextColor(t.TextMuted).Tooltip("Toggle left sidebar (Ctrl B)").Clicked() {
			ws.toggleLeft()
		}
		mounts := strconv.Itoa(len(ws.mounts)) + " folders"
		if len(ws.mounts) == 1 {
			mounts = ws.mounts[0].Name
		}
		ui.Text(c, mounts).FontSize(12).TextColor(t.TextMuted)
		if ws.notice != "" {
			ui.Icon(c, lucide.TriangleAlert()).Size(12, 12).TextColor(t.Warning).Tooltip(ws.notice)
		}
		ui.Box(c).Grow(1)
		defer func() {
			if ui.Icon(c, lucide.PanelRight()).Size(14, 14).TextColor(t.TextMuted).Tooltip("Toggle right sidebar (Ctrl Alt B)").Clicked() {
				ws.toggleRight()
			}
		}()
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
