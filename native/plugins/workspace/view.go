package workspace

import (
	"fmt"
	"strconv"
	"sync"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/ui"
	"github.com/egoist/mygo/ui/editor"
	"github.com/egoist/mygo/ui/markdown"
	"github.com/smallnest/uix/components/lucide"

	"github.com/cunninghamcard-bit/attention-ui/theme"
	omgui "github.com/cunninghamcard-bit/attention-ui/ui"

	"github.com/cunninghamcard-bit/attention/native/slotsapi"
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
	// Dragging a divider changes the widths during the build: save them.
	if ws.leftWidth != ws.seenLeft || ws.splitPct != ws.seenSplit {
		ws.seenLeft, ws.seenSplit = ws.leftWidth, ws.splitPct
		if ws.saveSoon != nil {
			ws.saveSoon()
		}
	}
}

// shortcuts are attention's defaults (apps/web: AppCommands, the command
// palette, the quick switcher), Cmd on macOS and Ctrl elsewhere; the
// editing ones do not apply to a reader. Keys attention leaves unbound get
// ours: Ctrl Shift F, Ctrl B, Ctrl \, Ctrl E, Ctrl Q.
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
	case c.Shortcut(ui.Cmd, ui.KeyB):
		ws.toggleLeft()
	case c.Shortcut(ui.Cmd, ui.KeyBackslash):
		ws.splitRight()
	case c.Shortcut(ui.Cmd, ui.KeyE):
		if tb := ws.activeTab(); tb != nil && tb.kind == kindMarkdown {
			tb.mdSource = !tb.mdSource
		}
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
		var shown *slotsapi.Panel
		if d == slotsapi.Left {
			shown = ws.shownLeft(panels)
		} else if len(panels) > 0 {
			shown = &panels[0]
		}
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
		ui.Column(c).Key("dock:" + shown.ID).Grow(1).FillWidth().MinHeight(0).Children(func() {
			shown.View(c, slotsapi.PanelProps{Reveal: ws.reveals[shown.ID]})
		})
	})
}

// shownLeft is the left dock's shown panel: the chosen one while it is
// registered, else the first.
func (ws *Workspace) shownLeft(panels []slotsapi.Panel) *slotsapi.Panel {
	for i := range panels {
		if panels[i].ID == ws.leftPanel {
			return &panels[i]
		}
	}
	if len(panels) > 0 {
		return &panels[0]
	}
	return nil
}

// ---- panes and tabs -----------------------------------------------------------

func (ws *Workspace) paneGroup(c *ui.Context) {
	if len(ws.panes) == 1 {
		ws.paneView(c, 0)
		return
	}
	ui.SplitPercent(c, &ws.splitPct, func() { ws.paneView(c, 0) }, func() { ws.paneView(c, 1) }).Grow(1)
}

func (ws *Workspace) paneView(c *ui.Context, i int) {
	t := c.Theme()
	p := ws.panes[i]
	focused := i == ws.active
	col := ui.Column(c).Key(fmt.Sprintf("pane-%d", i)).Grow(1).Fill()
	if len(ws.panes) > 1 && i == 1 {
		col.BorderWidth(0, 0, 0, 1).BorderColor(t.Border)
	}
	if col.Clicked() && !focused {
		ws.active = i
		ws.changed()
	}
	col.Children(func() {
		ws.tabBar(c, p, i, focused)
		tb := p.current()
		if tb == nil {
			ws.emptyPane(c)
			return
		}
		ws.tabBody(c, tb)
	})
}

func (ws *Workspace) tabBar(c *ui.Context, p *pane, paneIndex int, focused bool) {
	t := c.Theme()
	ui.ScrollHorizontal(c).Height(38).FillWidth().Background(t.Surface).BorderWidth(0, 0, 1, 0).BorderColor(t.Border).Children(func() {
		ui.Row(c).PaddingX(6).Gap(2).AlignItems(ui.Center).FillHeight().Children(func() {
			for j, tb := range p.tabs {
				j, tb := j, tb
				title := tb.title
				if tb.missing {
					title += " (deleted)"
				}
				tip := tb.title
				icon := fileIcon(tb.title)
				if tb.kind == kindEmpty {
					icon = lucide.Globe()
				} else {
					tip = ws.display(tb.path)
				}
				chip := omgui.TabChip(c, omgui.TabChipProps{
					Key: fmt.Sprintf("tab-%d", tb.id), Title: title, Icon: icon, Tooltip: tip,
					Selected:   j == p.active && (focused || len(ws.panes) == 1),
					CloseLabel: "Close " + tb.title,
					OnClose:    func() { ws.closeTab(p, j) },
				})
				if chip.Clicked() {
					p.active = j
					ws.active = paneIndex
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
	})
}

func (ws *Workspace) tabBody(c *ui.Context, tb *tab) {
	t := c.Theme()
	if tb.kind == kindEmpty {
		ws.emptyPane(c)
		return
	}
	if tb.missing {
		banner(c, "This file was deleted or moved. The last loaded content is shown.", t.Warning)
	}
	switch {
	case tb.err != "":
		centered(c, tb.err)
		return
	case tb.kind == kindImage:
		if tb.img == nil {
			centered(c, "Loading…")
			return
		}
		ui.Scroll(c).Grow(1).Fill().Children(func() {
			ui.Column(c).Padding(16).Center().FillWidth().Children(func() {
				ui.Image(c, tb.img).Fit(ui.Contain).MaxWidthPercent(100)
			})
		})
		return
	case tb.file.Binary:
		centered(c, "This is a binary file and is not shown.")
		return
	case tb.file.TooLarge:
		centered(c, fmt.Sprintf("This file is %s, larger than the %s shown.", size(tb.file.Size), size(maxTextBytes)))
		return
	case tb.ed == nil:
		centered(c, "Loading…")
		return
	}
	if tb.kind == kindMarkdown && !tb.mdSource {
		ui.Scroll(c).Key(fmt.Sprintf("md-%d", tb.id)).Grow(1).Fill().Children(func() {
			ui.Column(c).PaddingX(48).PaddingY(32).MaxWidth(860).FillWidth().Children(func() {
				markdown.View(c, tb.ed.Buffer.String(), &tb.md)
			})
		})
		return
	}
	editor.View(c, tb.ed).Key(fmt.Sprintf("ed-%d", tb.id)).Grow(1).Fill()
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

func size(n int64) string {
	switch {
	case n >= 1<<20:
		return fmt.Sprintf("%.1f MB", float64(n)/(1<<20))
	case n >= 1<<10:
		return fmt.Sprintf("%.1f KB", float64(n)/(1<<10))
	}
	return strconv.FormatInt(n, 10) + " B"
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
			if ui.Icon(c, lucide.PanelRight()).Size(14, 14).TextColor(t.TextMuted).Tooltip("Toggle right sidebar").Clicked() {
				ws.toggleRight()
			}
		}()
		tb := ws.activeTab()
		if tb == nil || tb.kind == kindEmpty {
			return
		}
		if tb.ed != nil && (tb.kind == kindText || tb.mdSource) {
			pos := tb.ed.CursorPos()
			ui.Text(c, fmt.Sprintf("%d:%d", pos.Line+1, pos.Col+1)).FontSize(12).TextColor(t.TextMuted)
		}
		if tb.kind == kindMarkdown {
			label := "Preview"
			if tb.mdSource {
				label = "Source"
			}
			if ui.Text(c, label).FontSize(12).TextColor(t.TextMuted).Tooltip("Toggle reading view (Ctrl E)").Clicked() {
				tb.mdSource = !tb.mdSource
			}
		}
		lang := "Plain Text"
		if tb.ed != nil {
			if l := tb.ed.Buffer.Language(); l != nil {
				lang = l.Name
			}
		}
		if tb.kind == kindImage {
			lang = "Image"
		}
		ui.Text(c, lang).FontSize(12).TextColor(t.TextMuted)
		ui.Text(c, "Read-only").FontSize(12).TextColor(t.TextMuted)
	})
}
