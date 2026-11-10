package ui

import (
	"github.com/cunninghamcard-bit/acard-ui/tokens"
	"github.com/egoist/mygo/ui"
)

// SettingsSection is a settings group: a caption, then body's rows in one
// raised card, divided (omgui's PreferenceSection).
func SettingsSection(c *ui.Context, title string, body func()) ui.Element {
	tok := tokens.TokensOf(c)
	col := ui.Column(c).FillWidth().Gap(8)
	col.Children(func() {
		if title != "" {
			SectionLabel(c, title).PaddingX(8)
		}
		shadow(ui.Column(c).FillWidth().PaddingX(16).Radius(tok.RadiusPanel).Background(TokensOf(c).BgRaised), tok.ShadowResting).
			Dividers(1, tok.BorderSubtle).Children(body)
	})
	return col
}

// PreferenceRow is one settings row: label and description at the start,
// trailing at the end.
func PreferenceRow(c *ui.Context, label, description string, trailing func()) ui.Element {
	tok := tokens.TokensOf(c)
	row := ui.Row(c).FillWidth().MinHeight(56).PaddingY(12).Gap(16).AlignItems(ui.Center)
	row.Children(func() {
		ui.Column(c).Grow(1).MinWidth(0).Gap(2).Children(func() {
			ui.Text(c, label).FontSize(tok.TextSm).FontWeight(500).FillWidth()
			if description != "" {
				ui.Text(c, description).FontSize(tok.TextXs).TextColor(tok.TextSecondary).FillWidth()
			}
		})
		if trailing != nil {
			ui.Column(c).Shrink(0).AlignItems(ui.End).Children(trailing)
		}
	})
	return row
}
