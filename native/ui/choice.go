package ui

import (
	"cmp"
	"time"

	"github.com/egoist/mygo/ui"

	"github.com/cunninghamcard-bit/attention/native/ui/icon"
)

// SelectOption is one choice of a Select: Value is what it stores, Label
// what it shows ("" shows Value).
type SelectOption struct {
	Value string
	Label string
}

// SelectProps is a control that picks one of Options into *Value. Key
// tells apart selects that share a parent; Aria names the control when
// the value shown is not a name; OnPick runs after a pick sets *Value.
type SelectProps struct {
	Key      string
	Value    *string
	Options  []SelectOption
	Width    float32
	Aria     string
	Disabled bool
	OnPick   func(value string)
}

// Select draws a drop-down on MyGo's SelectBase, with its keyboard
// handling, in the control face (CrychicUI's choice.Dropdown, restyled).
func Select(c *ui.Context, p SelectProps) ui.Element {
	if p.Value == nil {
		return ui.Row(c)
	}
	t := c.Theme()
	var trigger ui.Element
	ui.Row(c).Key(cmp.Or(p.Key, "select")).Shrink(0).Children(func() {
		sel := ui.SelectBase(c, p.Value)
		shown := *p.Value
		for _, o := range p.Options {
			if o.Value == *p.Value {
				shown = cmp.Or(o.Label, o.Value)
			}
		}
		trigger = sel.Trigger.Height(controlHeight).Radius(controlRadius(t)).PaddingX(9).Gap(8).
			AlignItems(ui.Center).Justify(ui.SpaceBetween).Cursor(ui.CursorPointer).
			Label(cmp.Or(p.Aria, shown))
		if p.Width > 0 {
			trigger.Width(p.Width)
		}
		face := control(t)
		switch {
		case p.Disabled:
			trigger.Disabled(true)
		case sel.Open():
			face = Wash(t, 0.12)
		case trigger.Hovered():
			face = Wash(t, 0.09)
		}
		trigger.Background(Face(c, trigger, "aui.select", face)).TextColor(t.Text)
		turn := float32(0)
		if sel.Open() {
			turn = 180
		}
		if !reduced(c) {
			turn = trigger.AnimateTo("aui.chevron", turn, ui.Animation{Duration: 160 * time.Millisecond, Ease: ui.EaseOut})
		}
		trigger.Children(func() {
			ui.Text(c, shown).FontSize(smallSize).FontWeight(500).SingleLine().Ellipsis("…").Grow(1).MinWidth(0)
			ui.Icon(c, icon.Must("chevron-down")).Size(12, 12).Rotate(turn).TextColor(t.TextMuted).Shrink(0)
		})
		sel.Popup(func(panel ui.Element) {
			Floating(c, panel).MinWidth(max(p.Width, 160))
			ui.Column(c).FillWidth().Gap(2).FocusGroup(ui.Vertical).Children(func() {
				for _, o := range p.Options {
					c.Key(o.Value)
					item := sel.Item(o.Value).FillWidth().Height(itemHeight).PaddingX(8).Gap(8).Radius(controlRadius(t)).
						AlignItems(ui.Center).Cursor(ui.CursorPointer)
					wash := ui.Color{}
					if item.Highlighted() || item.Hovered() {
						wash = Wash(t, 0.07)
					}
					item.Background(Face(c, item, "aui.option", wash)).TextColor(t.Text).Children(func() {
						ui.Text(c, cmp.Or(o.Label, o.Value)).FontSize(smallSize).SingleLine().Ellipsis("…").Grow(1).MinWidth(0)
						if o.Value == *p.Value {
							ui.Icon(c, icon.Must("check")).Size(iconSmall, iconSmall).Shrink(0)
						}
					})
				}
			})
		})
		if trigger.Changed() && p.OnPick != nil {
			p.OnPick(*p.Value)
		}
	})
	return trigger
}

// SettingsToggle is a compact row: the label (a click on it toggles too)
// and an optional description at the start, a switch at the end.
func SettingsToggle(c *ui.Context, label, description string, on, disabled bool, changed func(bool)) ui.Element {
	t := c.Theme()
	row := ui.Row(c).FillWidth().MinHeight(controlHeight).PaddingX(8).Gap(12).AlignItems(ui.Center)
	row.Children(func() {
		ui.Column(c).Grow(1).MinWidth(0).Gap(2).Children(func() {
			text := ui.Text(c, label).FontSize(labelSize)
			if changed != nil && !disabled {
				text.Cursor(ui.CursorPointer).OnClick(func() { changed(!on) })
			}
			if description != "" {
				ui.Text(c, description).FontSize(smallSize).TextColor(t.TextMuted)
			}
		})
		if disabled {
			Switch(c, label, on, nil).Shrink(0).Disabled(true)
			return
		}
		Switch(c, label, on, changed).Shrink(0)
	})
	return row
}

// Switch draws MyGo's switch named label, showing on; changed runs with
// the new value when the user flips it.
func Switch(c *ui.Context, label string, on bool, changed func(bool)) ui.Element {
	value := on
	sw := ui.Switch(c, &value).Label(label)
	if value != on && changed != nil {
		changed(value)
	}
	return sw
}
