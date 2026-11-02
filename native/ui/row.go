package ui

import (
	"github.com/egoist/mygo/ui"
)

const sideRowHeight float32 = 26

// SideRowProps is a tree or panel row the caller fills: Key keeps its
// hover across rebuilds, Depth indents it one step per level.
type SideRowProps struct {
	Key      any
	Selected bool
	Depth    int
}

// SidebarItemProps is a navigation row: an icon and a label.
type SidebarItemProps struct {
	Key      any
	Label    string
	Icon     *ui.SVG
	Selected bool
}

// CommandRowProps is a command palette row; Trailing draws at its end,
// as a hotkey hint.
type CommandRowProps struct {
	Key      any
	Label    string
	Detail   string
	Icon     *ui.SVG
	Selected bool
	Trailing func(c *ui.Context)
	OnClick  func()
}

// SideRow draws a borderless pill row and leaves its contents to the
// caller, who reads Clicked or attaches a menu after it returns.
func SideRow(c *ui.Context, p SideRowProps) ui.Element {
	t := c.Theme()
	row := ui.Row(c).Key(p.Key).Height(sideRowHeight).AlignSelf(ui.Stretch).MinWidth(0).
		Margin(0, 0, 0, float32(max(p.Depth, 0))*12).PaddingX(8).Gap(6).AlignItems(ui.Center).
		Radius(controlRadius(t)).Focusable().Role(ui.RoleButton).Checked(p.Selected).Cursor(ui.CursorPointer)
	fg, wash := t.TextMuted, ui.Color{}
	if p.Selected || row.Hovered() {
		fg, wash = t.Text, t.SurfaceHover
	}
	return row.Background(Face(c, row, "aui.siderow", wash)).TextColor(fg).FontSize(labelSize)
}

// SidebarItem draws a navigation row; the element returned reports
// Clicked.
func SidebarItem(c *ui.Context, p SidebarItemProps) ui.Element {
	t := c.Theme()
	b := ui.ButtonBase(c).Label(p.Label).Checked(p.Selected).FillWidth().Height(28).PaddingX(8).Gap(8).
		Radius(controlRadius(t)).AlignItems(ui.Center).Justify(ui.Start).Cursor(ui.CursorPointer)
	if p.Key != nil {
		b.Key(p.Key)
	}
	fg, wash, weight := t.TextMuted, ui.Color{}, 400
	switch {
	case p.Selected:
		fg, wash, weight = t.Text, t.SurfaceHover, 500
	case b.Hovered():
		fg, wash = t.Text, t.SurfaceHover
	}
	b.Background(Face(c, b, "aui.nav", wash)).TextColor(fg)
	b.Children(func() {
		if p.Icon != nil {
			ui.Icon(c, p.Icon).Size(iconSize, iconSize).Shrink(0)
		}
		ui.Text(c, p.Label).FontSize(labelSize).FontWeight(weight).SingleLine().Ellipsis("…").Grow(1).MinWidth(0)
	})
	return b
}

// CommandRow draws a single-line palette row.
func CommandRow(c *ui.Context, p CommandRowProps) ui.Element {
	t := c.Theme()
	b := ui.ButtonBase(c).Key(p.Key).Label(p.Label).FillWidth().Height(controlHeight).PaddingX(8).
		Radius(t.Radius).Gap(8).AlignItems(ui.Center).Cursor(ui.CursorPointer)
	wash := ui.Color{}
	if p.Selected || b.Hovered() {
		wash = t.SurfaceHover
	}
	b.Background(Face(c, b, "aui.command", wash)).TextColor(t.Text)
	b.Children(func() {
		if p.Icon != nil {
			ui.Icon(c, p.Icon).Size(iconSize, iconSize).Shrink(0).TextColor(t.TextMuted)
		}
		ui.Text(c, p.Label).FontSize(14).SingleLine().Ellipsis("…").Shrink(1).MinWidth(0)
		if p.Detail != "" {
			ui.Text(c, p.Detail).FontSize(smallSize).TextColor(t.TextMuted).SingleLine().Ellipsis("…").Shrink(2).MinWidth(0)
		}
		ui.Box(c).Grow(1)
		if p.Trailing != nil {
			ui.Row(c).Gap(6).AlignItems(ui.Center).Shrink(0).Children(func() { p.Trailing(c) })
		}
	})
	if p.OnClick != nil && b.Clicked() {
		p.OnClick()
	}
	return b
}

// SectionLabel is a group caption: small, medium weight, muted.
func SectionLabel(c *ui.Context, text string) ui.Element {
	return ui.Text(c, text).FontSize(captionSize).FontWeight(500).TextColor(c.Theme().TextMuted).SingleLine()
}
