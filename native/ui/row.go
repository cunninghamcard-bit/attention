package ui

import (
	"cmp"

	"github.com/cunninghamcard-bit/acard-ui/icon"
	"github.com/cunninghamcard-bit/acard-ui/tokens"
	"github.com/egoist/mygo/ui"
)

const (
	sideRowHeight float32 = 28
	indentStep    float32 = 16
)

// SideRowProps is a tree or panel row the caller fills: Key keeps its
// hover across rebuilds, Depth indents it one step per level, Height
// overrides the 28 DIP row, and Guides draws a hairline per level.
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
	tok := tokens.TokensOf(c)
	depth := max(p.Depth, 0)
	row := ui.Row(c).Key(p.Key).Height(cmp.Or(p.Height, sideRowHeight)).AlignSelf(ui.Stretch).MinWidth(0).
		Padding(0, 8, 0, 8+float32(depth)*indentStep).Gap(6).AlignItems(ui.Center).
		Radius(tok.RadiusControl).Focusable().Role(ui.RoleButton).Checked(p.Selected).Cursor(ui.CursorPointer)
	k := TokensOf(c)
	fg, wash := tok.TextSecondary, ui.Color{}
	switch {
	case p.Selected:
		fg, wash = tok.Foreground, k.TabRowSelected
		k.TabRowShadow.On(row)
	case row.Hovered():
		fg, wash = tok.Foreground, k.TabRowHover
	}
	if p.Guides && depth > 0 {
		line := tok.BorderSubtle
		row.DrawOver(func(painter *ui.Painter, r ui.Rect) {
			for d := range depth {
				painter.Fill(ui.Rect{X: r.X + 15 + float32(d)*indentStep, Y: r.Y, W: 1, H: r.H}, line, 0)
			}
		})
	}
	return row.Background(Face(c, row, "aui.siderow", wash)).TextColor(fg).FontSize(tok.TextSm)
}

// Disclosure is the chevron of a row that expands: it points right, and
// turns down while open. The element returned reports Clicked.
func Disclosure(c *ui.Context, open bool, size float32) ui.Element {
	turn := float32(0)
	if open {
		turn = 90
	}
	chev := ui.Icon(c, icon.ChevronRight.SVG()).Size(size, size).TextColor(c.Theme().TextMuted).Shrink(0).
		Cursor(ui.CursorPointer)
	if !reduced(c) {
		turn = chev.AnimateTo("aui.turn", turn, ui.Snappy)
	}
	return chev.Rotate(turn)
}

// SidebarItem draws a navigation row; the element returned reports
// Clicked.
func SidebarItem(c *ui.Context, p SidebarItemProps) ui.Element {
	tok := tokens.TokensOf(c)
	b := ui.ButtonBase(c).Label(p.Label).Checked(p.Selected).FillWidth().Height(tok.ControlHeightMd).PaddingX(10).Gap(8).
		Radius(tok.RadiusControl).AlignItems(ui.Center).Justify(ui.Start).Cursor(ui.CursorPointer)
	if p.Key != nil {
		b.Key(p.Key)
	}
	k := TokensOf(c)
	fg, wash, weight := tok.TextSecondary, ui.Color{}, 400
	switch {
	case p.Selected:
		fg, wash, weight = tok.Foreground, k.TabRowSelected, 500
		k.TabRowShadow.On(b)
	case b.Hovered():
		fg, wash = tok.Foreground, k.TabRowHover
	}
	b.Background(Face(c, b, "aui.nav", wash)).TextColor(fg)
	b.Children(func() {
		if p.Icon != nil {
			ui.Icon(c, p.Icon).Size(iconSize, iconSize).Shrink(0)
		}
		ui.Text(c, p.Label).FontSize(tok.TextSm).FontWeight(weight).SingleLine().Ellipsis("…").Grow(1).MinWidth(0)
	})
	return b
}

// CommandRow draws a single-line palette row.
func CommandRow(c *ui.Context, p CommandRowProps) ui.Element {
	tok := tokens.TokensOf(c)
	b := ui.ButtonBase(c).Key(p.Key).Label(p.Label).FillWidth().Height(tok.ControlHeightLg).PaddingX(10).
		Radius(c.Theme().Radius).Gap(10).AlignItems(ui.Center).Cursor(ui.CursorPointer)
	wash := ui.Color{}
	switch {
	case p.Selected:
		wash = tok.AccentSubtle
	case b.Hovered():
		wash = tok.SurfaceMuted
	}
	b.Background(Face(c, b, "aui.command", wash)).TextColor(tok.Foreground)
	b.Children(func() {
		if p.Icon != nil {
			ui.Icon(c, p.Icon).Size(iconSize, iconSize).Shrink(0).TextColor(tok.TextSecondary)
		}
		ui.Text(c, p.Label).FontSize(tok.TextBase).SingleLine().Ellipsis("…").Shrink(1).MinWidth(0)
		if p.Detail != "" {
			ui.Text(c, p.Detail).FontSize(tok.TextXs).TextColor(tok.TextSecondary).SingleLine().Ellipsis("…").Shrink(2).MinWidth(0)
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
	return ui.Text(c, text).FontSize(captionSize).FontWeight(500).TextColor(tokens.TokensOf(c).TextSecondary).SingleLine()
}
