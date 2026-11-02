package ui

import (
	"cmp"
	"time"

	"github.com/egoist/mygo/ui"
)

const (
	controlHeight float32 = 32
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

// Shade is black at alpha a, for shadows.
func Shade(a float32) ui.Color { return ui.RGBA(0, 0, 0, a) }

func reduced(c *ui.Context) bool { return c.Preferences().ReduceMotion }

func controlRadius(t *ui.Theme) float32 { return max(t.Radius-2, 0) }

// control is the face of a field or a select: the window's surface in a
// dark theme, its background in a light one.
func control(t *ui.Theme) ui.Color {
	if t.Dark {
		return t.Surface
	}
	return t.Background
}
