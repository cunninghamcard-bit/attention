package ui

import (
	"github.com/egoist/mygo/ui"
)

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
			Switch(c, label, on, nil).Disabled(true).Opacity(0.5)
			return
		}
		Switch(c, label, on, changed).Shrink(0)
	})
	return row
}

// Switch draws a switch named label, showing on, on MyGo's SwitchBase with
// a sliding knob (CrychicUI's choice.Toggle track); changed runs with the
// new value when the user flips it.
func Switch(c *ui.Context, label string, on bool, changed func(bool)) ui.Element {
	const w, h, inset float32 = 36, 20, 2
	k := TokensOf(c)
	value := on
	sw := ui.SwitchBase(c, &value).Label(label).Size(w, h).Radius(h / 2).Shrink(0).Cursor(ui.CursorPointer)
	pos := float32(0)
	if value {
		pos = 1
	}
	if !reduced(c) {
		pos = sw.AnimateTo("aui.knob", pos, ui.Snappy)
	}
	sw.Background(k.SwitchOff.Mix(k.SwitchOn, pos)).Children(func() {
		d := h - 2*inset
		knob := ui.Box(c).Absolute().Top(inset).Left(inset).Size(d, d).Radius(d/2).
			Background(k.SwitchKnob.Mix(k.SwitchKnobOn, pos)).Translate((w-h)*pos, 0)
		k.ShadowSmall.On(knob)
	})
	if value != on && changed != nil {
		changed(value)
	}
	return sw
}
