package ui

import (
	"cmp"

	"github.com/egoist/mygo/ui"

	"github.com/cunninghamcard-bit/attention/native/ui/icon"
)

const (
	sideRowHeight float32 = 26
	indentStep    float32 = 16
)

// SideRowProps is a tree or panel row the caller fills: Key keeps its
// hover across rebuilds, Depth indents it one step per level, Height
// overrides the 26 DIP row, and Guides draws a hairline per level.
type SideRowProps struct {
	Key      any
	Selected bool
	Depth    int
	Height   float32
	Guides   bool
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
	depth := max(p.Depth, 0)
	row := ui.Row(c).Key(p.Key).Height(cmp.Or(p.Height, sideRowHeight)).AlignSelf(ui.Stretch).MinWidth(0).
		Padding(0, 8, 0, 8+float32(depth)*indentStep).Gap(6).AlignItems(ui.Center).
		Radius(controlRadius(t)).Focusable().Role(ui.RoleButton).Checked(p.Selected).Cursor(ui.CursorPointer)
	fg, wash := t.TextMuted, ui.Color{}
	switch {
	case p.Selected:
		fg, wash = t.Text, t.SurfacePressed
	case row.Hovered():
		fg, wash = t.Text, t.SurfaceHover
	}
	if p.Guides && depth > 0 {
		line := t.Border.Alpha(0.75)
		row.DrawOver(func(painter *ui.Painter, r ui.Rect) {
			for d := range depth {
				painter.Fill(ui.Rect{X: r.X + 15 + float32(d)*indentStep, Y: r.Y, W: 1, H: r.H}, line, 0)
			}
		})
	}
	return row.Background(Face(c, row, "aui.siderow", wash)).TextColor(fg).FontSize(labelSize)
}

// Disclosure is the chevron of a row that expands: it points right, and
// turns down while open. The element returned reports Clicked.
func Disclosure(c *ui.Context, open bool, size float32) ui.Element {
	turn := float32(0)
	if open {
		turn = 90
	}
	chev := ui.Icon(c, icon.Must("chevron-right")).Size(size, size).TextColor(c.Theme().TextMuted).Shrink(0).
		Cursor(ui.CursorPointer)
	if !reduced(c) {
		turn = chev.AnimateTo("aui.turn", turn, ui.Snappy)
	}
	return chev.Rotate(turn)
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
