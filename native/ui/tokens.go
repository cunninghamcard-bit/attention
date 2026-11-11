package ui

import (
	"cmp"

	"github.com/egoist/mygo/ui"
)

var registered = map[*ui.Theme]*Tokens{}

// Shadow is a drop shadow: its offset, blur and color.
type Shadow struct {
	X, Y, Blur float32
	Color      ui.Color
}

// On gives el the shadow.
func (s Shadow) On(el ui.Element) ui.Element { return el.Shadow(s.X, s.Y, s.Blur, 0, s.Color) }

// Tokens are a theme's colors by role (RFC 0004): the semantic tokens,
// then the component tokens for the few components that differ from
// them. A *ui.Theme is their projection for MyGo's own widgets.
type Tokens struct {
	BgWindow, BgPage, BgRaised, BgOverlay, BgField, BgInverse    ui.Color
	Text, TextSecondary, TextTertiary, TextOnAccent, TextInverse ui.Color
	TextLink                                                     ui.Color
	BorderSubtle, Border, BorderStrong, BorderFocus              ui.Color
	FillHover, FillPressed, FillSelected, FillAccent             ui.Color
	AccentFill, AccentFillHover, AccentFillPressed, AccentBorder ui.Color
	Error, Warning, Success, Info, ErrorFill                     ui.Color
	Selection, Highlight, Scrollbar, Scrim                       ui.Color
	ShadowSmall, ShadowMedium, ShadowLarge                       Shadow
	TabRowSelected, TabRowHover, SplitRowSelected, SplitRowHover ui.Color
	TabRowShadow, CardShadow                                     Shadow
	AddressBar, AddressBarHover, CardBorder, MenuItem            ui.Color
	GlassTint                                                    ui.Color
	// RowStep is how many DIPs taller than compact a row and a control
	// are at the window's density (0 in a compact one).
	RowStep float32
}

// Register makes tok the tokens of t, for TokensOf, until Unregister;
// main thread only.
func Register(t *ui.Theme, tok *Tokens) { registered[t] = tok }

// Unregister forgets t's tokens.
func Unregister(t *ui.Theme) { delete(registered, t) }

// TokensOf are the tokens of the theme c draws with.
func TokensOf(c *ui.Context) *Tokens { return TokensFor(c.Theme()) }

// TokensFor are t's registered tokens, or, for a theme no one registered
// (tests, examples), the defaults derived from it.
func TokensFor(t *ui.Theme) *Tokens {
	if tok, ok := registered[t]; ok {
		return tok
	}
	return DerivedTokens(t)
}

// DerivedTokens are the tokens a bare *ui.Theme implies.
func DerivedTokens(t *ui.Theme) *Tokens {
	black := ui.RGBA(0, 0, 0, 1)
	wash := func(a float32) ui.Color { return t.Text.Alpha(a) }
	raised := t.Background
	if t.Dark {
		raised = t.Surface.Mix(t.Text, 0.12)
	}
	small := Shadow{Y: 1, Blur: 2, Color: black.Alpha(0.08)}
	k := &Tokens{
		BgWindow: t.Surface, BgPage: t.Background, BgRaised: raised, BgOverlay: raised, BgField: wash(0.05),
		BgInverse: cmp.Or(t.Inverse, t.Text),
		Text:      t.Text, TextSecondary: t.TextMuted, TextTertiary: t.TextMuted.Mix(t.Background, 0.35),
		TextOnAccent: t.AccentText, TextInverse: cmp.Or(t.InverseText, t.Background), TextLink: t.Accent,
		BorderSubtle: wash(0.08), Border: t.Border, BorderStrong: t.Border.Mix(t.Text, 0.2), BorderFocus: t.Focus,
		FillHover: wash(0.06), FillPressed: wash(0.1), FillSelected: wash(0.08), FillAccent: t.Accent.Alpha(0.14),
		AccentFill: t.Accent, AccentFillHover: t.AccentHover, AccentFillPressed: t.AccentPressed,
		AccentBorder: t.Accent.Alpha(0.55),
		Error:        t.Danger, Warning: t.Warning, Success: t.Success, Info: t.Accent, ErrorFill: t.Danger,
		Selection: t.Selection, Highlight: t.Warning.Alpha(0.4), Scrollbar: t.Scrollbar, Scrim: black.Alpha(0.32),
		ShadowSmall:  small,
		ShadowMedium: Shadow{Y: 12, Blur: 32, Color: black.Alpha(0.18)},
		ShadowLarge:  Shadow{Y: 24, Blur: 64, Color: black.Alpha(0.28)},
	}
	ComponentTokens(k)
	return k
}

// ComponentTokens sets k's component tokens from its semantic ones.
func ComponentTokens(k *Tokens) {
	k.TabRowSelected, k.TabRowHover, k.TabRowShadow = k.BgRaised, k.FillHover, k.ShadowSmall
	k.SplitRowSelected, k.SplitRowHover = k.FillHover, k.FillHover.Alpha(0.66)
	k.AddressBar, k.AddressBarHover = k.FillHover, k.FillHover.Mix(k.FillPressed, 0.75)
	k.CardBorder, k.CardShadow = k.BorderSubtle, Shadow{Y: 1, Blur: 4, Color: k.ShadowSmall.Color}
	k.MenuItem = k.FillHover
	k.GlassTint = k.BgOverlay.Alpha(0.78)
}
