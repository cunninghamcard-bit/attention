package ui

import (
	"cmp"

	"github.com/cunninghamcard-bit/acard-ui/components/button"
	"github.com/cunninghamcard-bit/acard-ui/components/popover"
	"github.com/egoist/mygo/ui"

	"github.com/cunninghamcard-bit/attention/native/ui/icon"
)

// MenuItem is one entry of a menu; Separator draws a hairline and ignores
// the other fields.
type MenuItem struct {
	Label     string
	Icon      *ui.SVG
	Checked   bool
	Disabled  bool
	Danger    bool
	Separator bool
	OnClick   func()
}

// IconMenuProps is a ghost icon button that opens a menu of Items. Label
// names the button; End opens the menu leftward from the button's end.
type IconMenuProps struct {
	Label string
	Icon  *ui.SVG
	Items []MenuItem
	End   bool
}

// DialogProps is a centered dialog over a dim, shown while *Open. Key
// tells apart dialogs that share a title. Flush drops the padding and the
// title so Body fills the panel, and adds a close button at its corner.
type DialogProps struct {
	Open      *bool
	Key       string
	Title     string
	Width     float32
	MaxHeight float32
	Flush     bool
	Body      func(c *ui.Context)
}

// IconMenu draws the button and, while open, the menu under it. The
// element returned is the button.
func IconMenu(c *ui.Context, p IconMenuProps) ui.Element {
	var b ui.Element
	ui.Row(c).Key("aui.menu:" + p.Label).Shrink(0).Children(func() {
		b = button.Button(c, button.ButtonProps{Label: p.Label, Variant: button.ButtonGhost, Size: button.ButtonSm, AnchorsPopup: true,
			Children: func() { ui.Icon(c, p.Icon).Size(iconSmall, iconSmall) }}).Width(28).PaddingX(0)
		open := ui.Local(b, "open", func() bool { return false })
		align := popover.PopoverStart
		if p.End {
			align = popover.PopoverEnd
		}
		popover.Popover(c, b, open, popover.PopoverProps{Label: p.Label, Align: align,
			Panel: func(panel ui.Element) ui.Element { return panel.MinWidth(176).Padding(5).Role(ui.RoleMenu) },
			Content: func() {
				ui.Column(c).FillWidth().Gap(2).FocusGroup(ui.Vertical).Children(func() {
					for i, it := range p.Items {
						menuEntry(c, i, it, func() { *open = false })
					}
				})
			}})
	})
	return b
}

// Dialog draws the dialog while *p.Open; Escape and a press on the dim
// close it.
func Dialog(c *ui.Context, p DialogProps) ui.Element {
	if p.Open == nil {
		return ui.Element{}
	}
	t, k := c.Theme(), TokensOf(c)
	host := ui.Box(c).Key("aui.dialog:" + cmp.Or(p.Key, p.Title)).Absolute()
	host.Children(func() {
		ui.DialogBase(c, p.Open, func(back, panel ui.Element) {
			Arrive(back.Background(k.Scrim), ui.Pose{Fade: 1}, 0)
			w := cmp.Or(p.Width, 440)
			k.ShadowLarge.On(panel.Width(w).MaxWidth(w).Radius(t.Radius + 4).Clip().Background(k.BgPage))
			if p.MaxHeight > 0 {
				panel.MaxHeight(p.MaxHeight)
			}
			Arrive(panel, ui.Pose{Y: 6, Scale: 0.98, Fade: 1}, 0)
			panel.Children(func() {
				if p.Flush {
					if p.Body != nil {
						p.Body(c)
					}
					if button.Button(c, button.ButtonProps{Label: "Close", Variant: button.ButtonGhost, Size: button.ButtonSm,
						Children: func() { ui.Icon(c, icon.Must("x")).Size(iconSmall, iconSmall) }}).
						Width(28).PaddingX(0).Absolute().Top(10).Right(10).Clicked() {
						*p.Open = false
					}
					return
				}
				ui.Column(c).FillWidth().Padding(20).Gap(12).Children(func() {
					if p.Title != "" {
						ui.Text(c, p.Title).FontSize(16).FontWeight(600)
					}
					if p.Body != nil {
						p.Body(c)
					}
				})
			})
		})
	})
	return host
}

func menuEntry(c *ui.Context, key int, it MenuItem, done func()) {
	t, k := c.Theme(), TokensOf(c)
	if it.Separator {
		ui.Box(c).Key(key).Height(1).FillWidth().Margin(4, 6).Background(k.BorderSubtle)
		return
	}
	b := ui.ButtonBase(c).Key(key).FillWidth().Height(itemHeight).PaddingX(8).Radius(controlRadius(t)).Gap(8).
		AlignItems(ui.Center).Cursor(ui.CursorPointer).Label(it.Label).Role(ui.RoleMenuItem)
	fg, wash := t.Text, ui.Color{}
	if it.Danger {
		fg = k.Error
	}
	if it.Disabled {
		b.Disabled(true)
		fg = t.TextMuted
	} else if b.Hovered() || b.Focused() {
		wash = k.MenuItem
	}
	b.Background(Face(c, b, "aui.item", wash)).TextColor(fg)
	b.Children(func() {
		if it.Icon != nil {
			ui.Icon(c, it.Icon).Size(iconSmall, iconSmall).Shrink(0).TextColor(t.TextMuted)
		}
		ui.Text(c, it.Label).FontSize(smallSize).SingleLine().Ellipsis("…").Grow(1).MinWidth(0)
		if it.Checked {
			ui.Icon(c, icon.Must("check")).Size(iconSmall, iconSmall).Shrink(0)
		}
	})
	if !it.Disabled && b.Clicked() {
		if it.OnClick != nil {
			it.OnClick()
		}
		done()
	}
}
