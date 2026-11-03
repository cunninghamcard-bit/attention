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
	t := c.Theme()
	el.Radius(t.Radius).Clip().Background(t.Background).Shadow(0, 1, 4, 0, Shade(0.08))
	if t.Dark {
		el.Border(1, Wash(t, 0.08))
	}
	return el
}

// Raised is the face of a selected row or a card: the page color in a
// light theme, a lifted surface in a dark one.
func Raised(t *ui.Theme) ui.Color {
	if t.Dark {
		return t.Surface.Mix(t.Text, 0.12)
	}
	return t.Background
}

// Shade is black at alpha a, for shadows.
func Shade(a float32) ui.Color { return ui.RGBA(0, 0, 0, a) }

// Wash is the text color at alpha a: the overlay of a hovered or pressed
// face, readable over any window tint.
func Wash(t *ui.Theme, a float32) ui.Color { return t.Text.Alpha(a) }

func reduced(c *ui.Context) bool { return c.Preferences().ReduceMotion }

func controlRadius(t *ui.Theme) float32 { return max(t.Radius-2, 0) }

// control is the face of a field or a select: a translucent fill.
func control(t *ui.Theme) ui.Color { return Wash(t, 0.05) }

// ring is the edge of a focused field.
func ring(e ui.Element, t *ui.Theme, focused bool) ui.Element {
	if focused {
		return e.Border(2, t.Focus)
	}
	return e.BorderWidth(0)
}
