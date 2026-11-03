package ui

import (
	"cmp"

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

// Popover draws body in a floating panel under anchor while *open; a
// press outside or Escape closes it.
func Popover(c *ui.Context, anchor ui.Element, open *bool, body func(panel ui.Element)) ui.Element {
	return ui.PopoverBase(c, anchor, open, func(panel ui.Element) {
		Floating(c, panel.Margin(6, 0, 0, 0))
		body(panel)
	})
}

// Floating styles panel as a popover face: padded frosted glass, easing
// in on first build.
func Floating(c *ui.Context, panel ui.Element) ui.Element {
	t := c.Theme()
	Frost(c, panel.Padding(5).Clip(), t.Radius+2)
	return Arrive(panel, ui.Pose{Y: -4, Fade: 1}, 0)
}

// IconMenu draws the button and, while open, the menu under it. The
// element returned is the button.
func IconMenu(c *ui.Context, p IconMenuProps) ui.Element {
	var b ui.Element
	ui.Row(c).Key("aui.menu:" + p.Label).Shrink(0).Children(func() {
		b = Button(c, ButtonProps{Label: p.Label, Icon: p.Icon, Variant: ButtonGhost, Size: ButtonIconSmall})
		open := ui.Local(b, "open", func() bool { return false })
		if b.Clicked() {
			*open = !*open
		}
		if !*open {
			return
		}
		Popover(c, b, open, func(panel ui.Element) {
			if p.End {
				panel.AttachTo(b, ui.AnchorBottomEnd, ui.AnchorTopEnd)
			}
			panel.MinWidth(176).Role(ui.RoleMenu)
			ui.Column(c).FillWidth().Gap(2).FocusGroup(ui.Vertical).Children(func() {
				for i, it := range p.Items {
					menuEntry(c, i, it, func() { *open = false })
				}
			})
		})
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
					Button(c, ButtonProps{Label: "Close", Icon: icon.Must("x"), Size: ButtonIconSmall, Variant: ButtonGhost,
						OnClick: func() { *p.Open = false }}).Absolute().Top(10).Right(10)
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
