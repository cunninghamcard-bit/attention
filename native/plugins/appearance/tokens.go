package appearance

import (
	"github.com/egoist/mygo/ui"

	aui "github.com/cunninghamcard-bit/attention/native/ui"
)

// tokens are t's interface colors by role (RFC 0004 §3): attention#11's
// table over base_30, every other role an alias or an alpha of one of its
// colors, and d's row step.
func tokens(t Theme, d density) *aui.Tokens {
	text, accent, red := t.color("white"), t.color("blue"), t.color("red")
	secondary, border := t.color("grey_fg2"), text.Alpha(0.125)
	if t.Dark {
		secondary, border = text.Alpha(0.6), t.color("grey")
	}
	muted := t.pick("darker_black", "one_bg3")
	black := ui.RGBA(0, 0, 0, 1)
	k := &aui.Tokens{
		BgWindow: t.pick("black", "darker_black"), BgPage: t.color("black"), BgRaised: t.pick("black", "one_bg"),
		BgOverlay: t.pick("black", "black2"), BgField: t.pick("darker_black", "one_bg2"), BgInverse: text,
		Text: text, TextSecondary: secondary, TextTertiary: t.color("grey_fg"),
		TextOnAccent: t.color("black"), TextInverse: t.color("black"), TextLink: accent,
		BorderSubtle: border.Alpha(0.6), Border: border, BorderStrong: border, BorderFocus: accent.Alpha(0.25),
		FillHover: muted.Alpha(0.5), FillPressed: muted, FillSelected: accent.Alpha(0.1), FillAccent: accent.Alpha(0.1),
		AccentFill: accent, AccentFillHover: accent.Alpha(0.9), AccentFillPressed: accent.Alpha(0.8),
		AccentBorder: accent.Alpha(0.55),
		Error:        red, Warning: t.color("yellow"), Success: t.color("green"), Info: accent, ErrorFill: red,
		Selection: accent.Alpha(0.25), Highlight: t.color("yellow").Alpha(0.4), Scrollbar: text.Alpha(0.25),
		Scrim:        black.Alpha(0.32),
		ShadowSmall:  aui.Shadow{Y: 1, Blur: 2, Color: black.Alpha(0.08)},
		ShadowMedium: aui.Shadow{Y: 12, Blur: 32, Color: black.Alpha(0.18)},
		ShadowLarge:  aui.Shadow{Y: 24, Blur: 64, Color: black.Alpha(0.28)},
	}
	aui.ComponentTokens(k)
	k.TabRowSelected = t.pick("black2", "one_bg")
	k.RowStep = d.step
	return k
}
