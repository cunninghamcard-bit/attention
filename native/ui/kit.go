package ui

import (
	"cmp"
	"time"

	"github.com/egoist/mygo/ui"
)

const (
	controlHeight float32 = 32
	itemHeight    float32 = 30
	iconSmall     float32 = 14
	iconSize      float32 = 16
	labelSize     float32 = 13
	smallSize     float32 = 12
	captionSize   float32 = 11
)

// faceKey restarts a face's easing when the palette changes, so a theme
// switch does not fade text across two palettes.
type faceKey struct {
	key              any
	background, text ui.Color
}

// Face is the color el shows, eased toward to unless motion is reduced
// (CrychicUI's AnimateColor transitions, without the press scale).
func Face(c *ui.Context, el ui.Element, key any, to ui.Color) ui.Color {
	if reduced(c) {
		return to
	}
	t := c.Theme()
	return el.AnimateColor(faceKey{key, t.Background, t.Text}, to, ui.Snappy)
}

// Arrive eases e from a pose to rest on its first build (port of
// CrychicUI's kit.Arrive).
func Arrive(e ui.Element, from ui.Pose, delay time.Duration) ui.Element {
	p := e.Keyframes("aui.arrive", []ui.Keyframe{{Value: 1}, {At: 160 * time.Millisecond, Value: 0, Ease: ui.EaseOut}},
		ui.KeyframeOptions{Delay: delay})
	s := cmp.Or(from.Scale, 1)
	k := 1 + (s-1)*p
	return e.Translate(from.X*p, from.Y*p).Scale(k, k).Opacity(1 - from.Fade*p)
}

// Card styles el as a content card: the page color over the window's
// tint, rounded, with a soft drop and, in a dark theme, a faint edge.
func Card(c *ui.Context, el ui.Element) ui.Element {
	t, k := c.Theme(), TokensOf(c)
	k.CardShadow.On(el.Radius(t.Radius).Clip().Background(k.BgPage))
	if t.Dark {
		el.Border(1, k.CardBorder)
	}
	return el
}

func reduced(c *ui.Context) bool { return c.Preferences().ReduceMotion }

func controlRadius(t *ui.Theme) float32 { return max(t.Radius-2, 0) }

// ring is the edge of a focused field.
func ring(e ui.Element, k *Tokens, focused bool) ui.Element {
	if focused {
		return e.Border(2, k.BorderFocus)
	}
	return e.BorderWidth(0)
}
