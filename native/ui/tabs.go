package ui

import (
	"github.com/egoist/mygo/ui"

	"github.com/cunninghamcard-bit/attention/native/ui/icon"
)

const tabRowHeight float32 = 34

// TabRowProps is one tab of the sidebar's list. Dot is the tab's project
// color, the zero color for none; CloseLabel names the close button, which
// OnClose runs.
type TabRowProps struct {
	Key        any
	Title      string
	Tooltip    string
	Icon       *ui.SVG
	IconColor  ui.Color
	Dot        ui.Color
	Selected   bool
	Muted      bool
	CloseLabel string
	OnClose    func()
}

// SplitPart is one tab of a split row.
type SplitPart struct {
	Key       any
	Title     string
	Icon      *ui.SVG
	IconColor ui.Color
	Dot       ui.Color
	Focused   bool
}

// AddressBarProps is the sidebar's address bar. Prefix and Name are the
// address, the prefix muted; Body, when set, draws instead of them (a web
// page's own field). Trailing draws at the end; OnClick runs on a press on
// the address.
type AddressBarProps struct {
	Key      any // "aui.address" when nil
	Prefix   string
	Name     string
	Icon     *ui.SVG
	Locked   bool
	Body     func()
	Trailing func()
	OnClick  func()
}

// TabRow draws a tab of the sidebar's list: the selected one a raised
// card. The element returned is the row, for the caller's click, drag and
// context menu.
func TabRow(c *ui.Context, p TabRowProps) ui.Element {
	t := c.Theme()
	row := ui.Row(c).Key(p.Key).Height(tabRowHeight).AlignSelf(ui.Stretch).MinWidth(0).Padding(0, 4, 0, 10).Gap(8).
		AlignItems(ui.Center).Radius(controlRadius(t)).Cursor(ui.CursorPointer).Focusable().Role(ui.RoleTab).
		Checked(p.Selected).Label(p.Title).Tooltip(p.Tooltip)
	hovered := row.Hovered()
	k := TokensOf(c)
	fg, wash := t.Text, ui.Color{}
	switch {
	case p.Selected:
		wash = k.TabRowSelected
		k.TabRowShadow.On(row)
	case hovered:
		wash = k.TabRowHover
	}
	if p.Muted && !p.Selected {
		fg = t.TextMuted
	}
	row.Background(Face(c, row, "aui.tabrow", wash)).TextColor(fg)
	row.Children(func() {
		tabFace(c, p.Dot, p.Icon, p.IconColor, fg)
		ui.Text(c, p.Title).FontSize(labelSize).FontWeight(500).SingleLine().Ellipsis("…").Grow(1).MinWidth(0)
		if p.CloseLabel == "" {
			return
		}
		x := ui.ButtonBase(c).Label(p.CloseLabel).Size(24, 24).Radius(6).Shrink(0).
			AlignItems(ui.Center).Justify(ui.Center).Cursor(ui.CursorPointer)
		face := ui.Color{}
		if x.Hovered() {
			face = k.FillHover
		}
		x.Background(Face(c, x, "aui.tabclose", face))
		if p.OnClose != nil {
			x.OnClick(p.OnClose)
		}
		x.Children(func() {
			if p.Selected || hovered || x.Hovered() {
				ui.Icon(c, icon.Must("x")).Size(12, 12).TextColor(t.TextMuted)
			}
		})
	})
	return row
}

// SplitRow draws a split in the sidebar's list: its tabs side by side in
// one row, the focused one raised while the split is selected. It returns
// the row and each part, for the caller's clicks, drags and menus.
func SplitRow(c *ui.Context, key any, selected bool, parts []SplitPart) (ui.Element, []ui.Element) {
	t := c.Theme()
	row := ui.Row(c).Key(key).Height(tabRowHeight).AlignSelf(ui.Stretch).MinWidth(0).Padding(3).Gap(3).
		AlignItems(ui.Stretch).Radius(controlRadius(t)).Role(ui.RoleGroup)
	k := TokensOf(c)
	wash := ui.Color{}
	switch {
	case selected:
		wash = k.SplitRowSelected
	case row.Hovered():
		wash = k.SplitRowHover
	}
	row.Background(Face(c, row, "aui.splitrow", wash))
	out := make([]ui.Element, 0, len(parts))
	row.Children(func() {
		for _, sp := range parts {
			part := ui.Row(c).Key(sp.Key).Width(0).Grow(1).MinWidth(0).PaddingX(7).Gap(6).AlignItems(ui.Center).
				Radius(max(controlRadius(t)-3, 0)).Cursor(ui.CursorPointer).Focusable().Role(ui.RoleTab).
				Checked(selected && sp.Focused).Label(sp.Title).Tooltip(sp.Title)
			face := ui.Color{}
			switch {
			case selected && sp.Focused:
				face = k.TabRowSelected
				k.TabRowShadow.On(part)
			case part.Hovered():
				face = k.TabRowHover
			}
			part.Background(Face(c, part, "aui.splitpart", face)).TextColor(t.Text)
			part.Children(func() {
				tabFace(c, sp.Dot, sp.Icon, sp.IconColor, t.Text)
				ui.Text(c, sp.Title).FontSize(smallSize).FontWeight(500).SingleLine().Ellipsis("…").Grow(1).MinWidth(0)
			})
			out = append(out, part)
		}
	})
	return row, out
}

// AddressBar draws the address bar: a translucent pill with the address,
// a lock for a file shown read-only, and Trailing at its end.
func AddressBar(c *ui.Context, p AddressBarProps) ui.Element {
	t := c.Theme()
	key := p.Key
	if key == nil {
		key = "aui.address"
	}
	bar := ui.Row(c).Key(key).FillWidth().Height(tabRowHeight).Padding(0, 3, 0, 10).Gap(6).
		AlignItems(ui.Center).Radius(controlRadius(t))
	k := TokensOf(c)
	face := k.AddressBar
	if p.Body == nil && bar.Hovered() {
		face = k.AddressBarHover
	}
	bar.Background(Face(c, bar, "aui.address", face)).TextColor(t.Text)
	bar.Children(func() {
		if p.Body != nil {
			ui.Row(c).Grow(1).MinWidth(0).AlignItems(ui.Center).Children(p.Body)
		} else {
			text := ui.Row(c).Grow(1).MinWidth(0).FillHeight().Gap(6).AlignItems(ui.Center).Cursor(ui.CursorPointer).
				Role(ui.RoleButton).Label(p.Prefix + p.Name)
			text.Children(func() {
				if p.Locked {
					ui.Icon(c, icon.Must("file-lock")).Size(iconSmall, iconSmall).TextColor(t.TextMuted).Shrink(0).
						Tooltip("Read-only")
				} else if p.Icon != nil {
					ui.Icon(c, p.Icon).Size(iconSmall, iconSmall).TextColor(t.TextMuted).Shrink(0)
				}
				ui.Row(c).Grow(1).MinWidth(0).AlignItems(ui.Center).Children(func() {
					if p.Prefix != "" {
						ui.Text(c, p.Prefix).FontSize(smallSize).TextColor(t.TextMuted).SingleLine().Ellipsis("…").
							Shrink(1).MinWidth(0)
					}
					ui.Text(c, p.Name).FontSize(smallSize).FontWeight(500).SingleLine().Ellipsis("…").Shrink(0).MaxWidth(160)
				})
			})
			if p.OnClick != nil && text.Clicked() {
				p.OnClick()
			}
		}
		if p.Trailing != nil {
			ui.Row(c).Shrink(0).AlignItems(ui.Center).Children(p.Trailing)
		}
	})
	return bar
}

// Dot draws a project's color dot, nothing for the zero color.
func Dot(c *ui.Context, color ui.Color) {
	if color.A > 0 {
		ui.Box(c).Size(6, 6).Radius(3).Background(color).Shrink(0)
	}
}

// tabFace is a tab's project dot and icon.
func tabFace(c *ui.Context, dot ui.Color, glyph *ui.SVG, glyphColor, fg ui.Color) {
	Dot(c, dot)
	if glyph == nil {
		return
	}
	ink := fg
	if glyphColor.A > 0 {
		ink = glyphColor
	}
	ui.Icon(c, glyph).Size(iconSize, iconSize).Shrink(0).TextColor(ink)
}
