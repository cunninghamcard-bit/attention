package ui

import (
	"math"
	"strconv"
	"strings"

	"github.com/egoist/mygo/ui"

	"github.com/cunninghamcard-bit/attention/native/ui/icon"
)

// Field draws a single-line text input on the control face. The element
// returned is the input, so a caller can read Submitted or mark it;
// placeholder is also its accessible name.
func Field(c *ui.Context, value *string, placeholder string, disabled bool) ui.Element {
	t := c.Theme()
	e := ui.TextInput(c, value).Placeholder(placeholder)
	if placeholder != "" {
		e.Label(placeholder)
	}
	e.FillWidth().Height(controlHeight).MinHeight(controlHeight).PaddingX(10).PaddingY(0).
		Radius(controlRadius(t)).FontSize(labelSize).Background(control(t)).TextColor(t.Text)
	ring(e, t, e.Focused())
	if disabled {
		e.Disabled(true).TextColor(t.TextMuted)
	}
	return e
}

// SearchField draws a field with a magnifier at its start. The element
// returned is the text input.
func SearchField(c *ui.Context, value *string, placeholder string, disabled bool) ui.Element {
	t := c.Theme()
	box := ui.Row(c).FillWidth().Height(controlHeight).Radius(controlRadius(t)).Background(control(t)).
		AlignItems(ui.Center).PaddingX(10).Gap(8)
	focused := ui.Local(box, "focused", func() bool { return false })
	ring(box, t, *focused)
	var input ui.Element
	box.Children(func() {
		ui.Icon(c, icon.Must("search")).Size(iconSmall, iconSmall).TextColor(t.TextMuted).Shrink(0)
		input = ui.TextInput(c, value).Placeholder(placeholder).FillWidth().Height(controlHeight-2).
			MinHeight(controlHeight-2).Padding(0).FontSize(labelSize).TextColor(t.Text).
			BorderWidth(0, 0, 0, 0).Background(ui.Color{})
		if placeholder != "" {
			input.Label(placeholder)
		}
		if disabled {
			input.Disabled(true).TextColor(t.TextMuted)
		}
		*focused = input.Focused()
	})
	return input
}

// NumberField is minus, an editable whole number, plus, in one control
// ring; Up/Down step it, and Enter or leaving the field commits a draft
// (port of omgui.NumberField).
func NumberField(c *ui.Context, value *float64, low, high float64, label string, changed func(float64)) ui.Element {
	t := c.Theme()
	row := ui.Row(c).Key(label).Width(112).Height(controlHeight).PaddingX(4).Radius(controlRadius(t)).
		Background(control(t)).AlignItems(ui.Center)
	format := func(n float64) string { return strconv.FormatFloat(n, 'f', 0, 64) }
	draft := ui.Local(row, "draft", func() string { return format(*value) })
	wasFocused := ui.Local(row, "focused", func() bool { return false })
	set := func(n float64) {
		n = math.Round(max(low, min(high, n)))
		*draft = format(n)
		if n != *value {
			*value = n
			if changed != nil {
				changed(n)
			}
		}
	}
	var field ui.Element
	row.Children(func() {
		Button(c, ButtonProps{Label: "Decrease " + label, Icon: icon.Must("minus"), Size: ButtonIconTiny, Variant: ButtonGhost,
			Disabled: *value <= low, OnClick: func() { set(*value - 1) }})
		field = ui.TextInput(c, draft).Label(label).Grow(1).MinWidth(0).Height(controlHeight-2).Padding(0, 4).
			FontSize(labelSize).TextColor(t.Text).TextAlign(ui.Center).Background(ui.Color{}).BorderWidth(0)
		field.OnChange(func() {
			if n, err := strconv.ParseFloat(strings.TrimSpace(*draft), 64); err == nil && n >= low && n <= high {
				set(n)
			}
		})
		commit := func() {
			if n, err := strconv.ParseFloat(strings.TrimSpace(*draft), 64); err == nil {
				set(n)
			} else {
				*draft = format(*value)
			}
		}
		field.OnSubmit(commit)
		field.OnTextKey(func(k ui.TextKey) bool {
			if k.Mods != 0 || k.Key != ui.KeyUp && k.Key != ui.KeyDown {
				return false
			}
			if k.Key == ui.KeyUp {
				set(*value + 1)
			} else {
				set(*value - 1)
			}
			k.SetText(*draft)
			return true
		})
		Button(c, ButtonProps{Label: "Increase " + label, Icon: icon.Must("plus"), Size: ButtonIconTiny, Variant: ButtonGhost,
			Disabled: *value >= high, OnClick: func() { set(*value + 1) }})
		focused := field.Focused()
		if *wasFocused && !focused {
			commit()
		}
		*wasFocused = focused
		if !focused {
			*draft = format(*value)
		}
	})
	return field
}
