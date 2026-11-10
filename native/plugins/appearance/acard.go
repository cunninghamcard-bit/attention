package appearance

import (
	acard "github.com/cunninghamcard-bit/acard-ui/tokens"
	"github.com/egoist/mygo/ui"

	aui "github.com/cunninghamcard-bit/attention/native/ui"
)

const (
	// The control heights are RFC 0003 §5's rows: a tab row's close button
	// and an icon button, a field or a button, a command row.
	controlHeightSm float32 = 28
	controlHeightMd float32 = 32
	controlHeightLg float32 = 36
)

// acardOf projects the semantic tokens k and the sizes and font of u
// onto ACard's tokens (RFC 0005 §3.1), over Arc's defaults for what
// attention has no token for: the tones, the series, the gradients, the
// motion.
func acardOf(k *aui.Tokens, u *ui.Theme) *acard.Tokens {
	tok := acard.NewTokens(u.Dark, acard.AccentNeutral)
	// RFC 0003 §5 draws fields, selects and secondary buttons as a
	// translucent wash with no border, and menus as a shadow with none: the
	// surface acard fills a control with is the field wash, and the borders
	// acard draws around controls and panels are clear. The muted surface
	// is acard's hover face, a wash too, which reads over a project's tint.
	tok.Background, tok.Surface, tok.SurfaceRaised = k.BgPage, k.BgField, k.BgOverlay
	tok.SurfaceMuted = k.FillHover
	tok.Foreground, tok.TextSecondary, tok.TextMuted = k.Text, k.TextSecondary, k.TextTertiary
	tok.Border, tok.BorderSubtle, tok.BorderStrong = k.Border.Alpha(0), k.BorderSubtle, k.BorderStrong.Alpha(0)

	// Arc's strong accent stands further from the page than the accent: the
	// raw accent under accentSteps' lighter face on a light page, the hover
	// step over it on a dark one.
	tok.Accent, tok.AccentStrong = k.AccentFill, k.AccentFillPressed
	if u.Dark {
		tok.AccentStrong = k.AccentFillHover
	}
	tok.AccentSubtle, tok.AccentForeground = k.FillAccent, k.TextOnAccent
	tok.ControlOn, tok.ControlFill, tok.ControlGlyph = k.AccentFill, k.AccentFill, k.TextOnAccent
	tok.ControlOnSubtle = k.AccentFill.Alpha(0.1)
	tok.ControlTrack = k.Border.Mix(k.Text, 0.15)
	tok.ControlTrackHover = k.FillHover.Over(tok.ControlTrack)
	tok.ControlThumbOn = k.TextOnAccent
	tok.FocusOutline = k.BorderFocus

	tok.Success, tok.Warning, tok.Danger, tok.Info = k.Success, k.Warning, k.Error, k.Info
	tok.ShadowResting = shadows(k.ShadowSmall)
	tok.ShadowRaised = shadows(k.ShadowMedium)
	tok.ShadowFloating = shadows(k.ShadowLarge)

	tok.ControlHeightSm, tok.ControlHeightMd, tok.ControlHeightLg = controlHeightSm, controlHeightMd, controlHeightLg
	tok.RadiusControl, tok.RadiusPanel, tok.RadiusSurface = max(u.Radius-2, 0), u.Radius+2, u.Radius+4
	tok.TextXs, tok.TextSm, tok.TextBase, tok.TextLg = 12, 13, u.FontSize, 16
	tok.FontBody, tok.FontDisplay = u.Font, u.Font
	return tok
}

func shadows(s aui.Shadow) []acard.Shadow {
	return []acard.Shadow{{X: s.X, Y: s.Y, Blur: s.Blur, Color: s.Color}}
}
