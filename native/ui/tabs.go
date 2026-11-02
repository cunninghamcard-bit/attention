package ui

import (
	"github.com/egoist/mygo/ui"

	"github.com/cunninghamcard-bit/attention/native/ui/icon"
)

// TabChipProps is one tab of a tab strip. Divider draws a hairline after
// an unselected tab; CloseLabel names the close button, which OnClose
// runs.
type TabChipProps struct {
	Key        any
	Title      string
	Tooltip    string
	Icon       *ui.SVG
	IconColor  ui.Color
	Selected   bool
	Divider    bool
	CloseLabel string
	OnClose    func()
}

// TabChip draws a tab: the selected one a raised card open at the bottom,
// the others flat pills. The element returned is the tab, for the caller's
// click, drag and context menu (port of the workspace's tab strip).
func TabChip(c *ui.Context, p TabChipProps) ui.Element {
	t := c.Theme()
	chip := ui.Row(c).Key(p.Key).Shrink(0).AlignItems(ui.Center).Cursor(ui.CursorPointer).
		Focusable().Role(ui.RoleTab).Checked(p.Selected).Label(p.Title).Tooltip(p.Tooltip)
	hovered := chip.Hovered()
	fg, weight := t.TextMuted, 400
	switch {
	case p.Selected:
		fg, weight = t.Text, 500
		chip.Height(34).Radius(6, 6, 0, 0).Background(t.Background).BorderWidth(1, 1, 0, 1).BorderColor(t.Border)
	case hovered:
		fg = t.Text
		chip.Height(30).Margin(0, 0, 2, 0).Radius(4).Background(t.SurfaceHover)
	default:
		chip.Height(30).Margin(0, 0, 2, 0).Radius(4)
		if p.Divider {
			line := t.Border
			chip.DrawOver(func(painter *ui.Painter, r ui.Rect) {
				painter.Fill(ui.Rect{X: r.X + r.W, Y: r.Y + (r.H-14)/2, W: 1, H: 14}, line, 0)
			})
		}
	}
	chip.TextColor(fg)
	chip.Children(func() {
		ui.Row(c).MaxWidth(160).MinWidth(0).Shrink(0).Padding(0, 6, 0, 10).Gap(6).AlignItems(ui.Center).Children(func() {
			if p.Icon != nil {
				ink := fg
				if p.IconColor.A > 0 {
					ink = p.IconColor
				}
				ui.Icon(c, p.Icon).Size(iconSmall, iconSmall).Shrink(0).TextColor(ink)
			}
			ui.Text(c, p.Title).FontSize(12.5).LineHeight(1.3).FontWeight(weight).SingleLine().Ellipsis("…").Grow(1).MinWidth(0)
		})
		if p.CloseLabel == "" {
			return
		}
		x := ui.ButtonBase(c).Label(p.CloseLabel).Size(20, 20).Radius(4).Margin(0, 4, 0, 0).Shrink(0).
			AlignItems(ui.Center).Justify(ui.Center).Cursor(ui.CursorPointer)
		wash := ui.Color{}
		if x.Hovered() {
			wash = t.SurfaceHover
		}
		x.Background(Face(c, x, "aui.tabclose", wash))
		if p.OnClose != nil {
			x.OnClick(p.OnClose)
		}
		x.Children(func() {
			if p.Selected || hovered || x.Hovered() {
				ui.Icon(c, icon.Must("x")).Size(12, 12).TextColor(t.TextMuted)
			}
		})
	})
	return chip
}
