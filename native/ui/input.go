package ui

import (
	"math"
	"strconv"
	"strings"

	"github.com/cunninghamcard-bit/acard-ui/components/button"
	"github.com/cunninghamcard-bit/acard-ui/icon"
	"github.com/egoist/mygo/ui"
)

// SearchField draws a field with a magnifier at its start. The element
// returned is the text input.
func SearchField(c *ui.Context, value *string, placeholder string, disabled bool) ui.Element {
	t := c.Theme()
	box := ui.Row(c).FillWidth().Height(controlHeight).Radius(controlRadius(t)).Background(TokensOf(c).BgField).
		AlignItems(ui.Center).PaddingX(10).Gap(8)
	focused := ui.Local(box, "focused", func() bool { return false })
	ring(box, TokensOf(c), *focused)
	var input ui.Element
	box.Children(func() {
		ui.Icon(c, icon.Search.SVG()).Size(iconSmall, iconSmall).TextColor(t.TextMuted).Shrink(0)
		input = ui.TextInputBase(c, value).Placeholder(placeholder).FillWidth().Height(controlHeight - 2).
			MinHeight(controlHeight - 2).Padding(0).FontSize(labelSize).TextColor(t.Text)
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
		Background(TokensOf(c).BgField).AlignItems(ui.Center)
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
	step := func(name string, glyph *ui.SVG, disabled bool) bool {
		return button.Button(c, button.ButtonProps{Label: name + " " + label, Variant: button.ButtonGhost, Size: button.ButtonSm,
			Disabled: disabled, Children: func() { ui.Icon(c, glyph).Size(iconSmall, iconSmall) }}).
			Size(24, 24).MinHeight(24).PaddingX(0).Clicked()
	}
	var field ui.Element
	row.Children(func() {
		if step("Decrease", icon.Minus.SVG(), *value <= low) {
			set(*value - 1)
		}
		field = ui.TextInputBase(c, draft).Label(label).Grow(1).MinWidth(0).Height(controlHeight-2).Padding(0, 4).
			FontSize(labelSize).TextColor(t.Text).TextAlign(ui.Center)
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
		if step("Increase", icon.Plus.SVG(), *value >= high) {
			set(*value + 1)
		}
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
