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

// view is the window's root (RFC §5.8: it reads state, never the disk).
func (ws *Workspace) view(c *ui.Context) {
	c.SetTheme(themeFor(mygo.Theme.IsDark()))
	t := c.Theme()
	ws.shortcuts(c)
	ui.Column(c).Fill().Background(t.Background).Children(func() {
		ui.Row(c).Grow(1).FillWidth().AlignItems(ui.Stretch).Children(func() {
			if ws.panelOpen {
				ui.Split(c, &ws.leftWidth, func() { ws.projectPanel(c) }, func() { ws.paneGroup(c) }).Grow(1)
			} else {
				ws.paneGroup(c)
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

// shortcuts are Zed's defaults on Linux and Windows (Cmd on macOS).
func (ws *Workspace) shortcuts(c *ui.Context) {
	switch {
	case c.Shortcut(ui.Cmd|ui.Shift, ui.KeyP):
		ws.openPalette(modeCommands)
	case c.Shortcut(ui.Cmd, ui.KeyP):
		ws.openPalette(modeFiles)
	case c.Shortcut(ui.Cmd|ui.Shift, ui.KeyF):
		ws.openSearch()
	case c.Shortcut(ui.Cmd, ui.KeyW):
		ws.closeActiveTab()
	case c.Shortcut(ui.Cmd, ui.KeyB):
		ws.panelOpen = !ws.panelOpen
		ws.changed()
	case c.Shortcut(ui.Cmd, ui.KeyBackslash):
		ws.splitRight()
	case c.Shortcut(ui.Ctrl, ui.KeyTab), c.Shortcut(ui.Ctrl, ui.KeyPageDown):
		ws.cycleTab(1)
	case c.Shortcut(ui.Ctrl|ui.Shift, ui.KeyTab), c.Shortcut(ui.Ctrl, ui.KeyPageUp):
		ws.cycleTab(-1)
	case c.Shortcut(ui.Cmd, ui.KeyQ):
		mygo.App.Quit()
	case c.Shortcut(ui.Cmd|ui.Shift, ui.KeyV):
		if tb := ws.activeTab(); tb != nil && tb.kind == kindMarkdown {
			tb.mdSource = !tb.mdSource
		}
	}
}

// ---- project panel ------------------------------------------------------------

func (ws *Workspace) projectPanel(c *ui.Context) {
	t := c.Theme()
	rows := ws.treeRows()
	current := ""
	if tb := ws.activeTab(); tb != nil && tb.kind != kindSearch {
		current = tb.path
	}
	ui.Column(c).Fill().Background(t.Surface).BorderWidth(0, 1, 0, 0).BorderColor(t.Border).Children(func() {
		ui.Row(c).Padding(10, 12).AlignItems(ui.Center).Children(func() {
			ui.Text(c, "PROJECT").FontSize(11).Bold().TextColor(t.TextMuted).Grow(1)
		})
		if ws.notice != "" {
			ui.Text(c, ws.notice).FontSize(11).TextColor(t.Warning).Padding(4, 12)
		}
		if !ws.mountsLoaded {
			ui.Text(c, "Loading…").TextColor(t.TextMuted).Padding(8, 12)
			return
		}
		ui.List(c, nil, len(rows), func(i int) {
			r := rows[i]
			e := r.entry
			row := omgui.SideRow(c, omgui.SideRowProps{Key: e.Path, Selected: !e.Dir && e.Path == current, Depth: r.depth})
			if row.Clicked() {
				if e.Dir {
					ws.toggleDir(e.Path)
				} else {
					ws.open(e.Path, nil)
				}
			}
			row.Tooltip(ws.display(e.Path))
			row.Children(func() {
				if e.Dir {
					d := ws.dirs[e.Path]
					open := d != nil && d.expanded
					chevron := lucide.ChevronRight()
					if open {
						chevron = lucide.ChevronDown()
					}
					ui.Icon(c, chevron).Size(14, 14).TextColor(t.TextMuted).Shrink(0)
					icon := lucide.Folder()
					if open {
						icon = lucide.FolderOpen()
					}
					ui.Icon(c, icon).Size(14, 14).TextColor(t.TextMuted).Shrink(0)
				} else {
					ui.Box(c).Width(14).Shrink(0)
					ui.Icon(c, fileIcon(e.Name)).Size(14, 14).TextColor(t.TextMuted).Shrink(0)
				}
				label := ui.Text(c, e.Name).SingleLine().Ellipsis("…").Shrink(1).FontSize(13)
				if r.mount != nil {
					label.Bold()
				}
				if e.Dir {
					if d := ws.dirs[e.Path]; d != nil && d.err != "" {
						ui.Icon(c, lucide.TriangleAlert()).Size(12, 12).TextColor(t.Warning).Shrink(0).Tooltip(d.err)
					}
				}
			})
		}).Grow(1).FillWidth().PaddingY(4)
	})
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
				tip := "Search"
				if tb.kind != kindSearch {
					tip = ws.display(tb.path)
				}
				icon := fileIcon(tb.title)
				if tb.kind == kindSearch {
					icon = lucide.Search()
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
		hint("Open a file", "Ctrl P")
		hint("Commands", "Ctrl Shift P")
		hint("Search all files", "Ctrl Shift F")
		hint("Toggle project panel", "Ctrl B")
	})
}

func (ws *Workspace) tabBody(c *ui.Context, tb *tab) {
	t := c.Theme()
	if tb.kind == kindSearch {
		ws.searchView(c, tb)
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
		if ui.Icon(c, lucide.PanelLeft()).Size(14, 14).TextColor(t.TextMuted).Tooltip("Toggle project panel (Ctrl B)").Clicked() {
			ws.panelOpen = !ws.panelOpen
			ws.changed()
		}
		mounts := strconv.Itoa(len(ws.mounts)) + " folders"
		if len(ws.mounts) == 1 {
			mounts = ws.mounts[0].Name
		}
		ui.Text(c, mounts).FontSize(12).TextColor(t.TextMuted)
		ui.Box(c).Grow(1)
		tb := ws.activeTab()
		if tb == nil || tb.kind == kindSearch {
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
			if ui.Text(c, label).FontSize(12).TextColor(t.TextMuted).Tooltip("Toggle Markdown source (Ctrl Shift V)").Clicked() {
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
