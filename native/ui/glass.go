package ui

import (
	"github.com/egoist/mygo/ui"
	"github.com/egoist/mygo/ui/shader"
)

var (
	// frost tints the blurred backdrop (CrychicUI's fx.Frosted).
	frost = shader.MustCompile(`package main

var Tint vec4

func Fragment(dst vec4, pos vec2) vec4 {
	b := backdropSample(pos)
	return mix(b, vec4(Tint.rgb, 1), Tint.a)
}
`)

	// liquid bends the backdrop near the rounded edge, as a lens does,
	// and lights the top rim.
	liquid = shader.MustCompile(`package main

var Tint vec4
var Radius float
var Bend float

func box(p vec2, half vec2, r float) float {
	q := abs(p) - half + vec2(r)
	return min(max(q.x, q.y), 0) + length(max(q, vec2(0))) - r
}

func Fragment(dst vec4, pos vec2) vec4 {
	size := rectSize()
	c := pos - size/2
	d := -box(c, size/2, Radius)
	edge := 1 - smoothstep(0, Bend*3, d)
	dir := normalize(c + vec2(0.001))
	b := backdropSample(pos - dir*edge*edge*Bend)
	col := mix(b, vec4(Tint.rgb, 1), Tint.a)
	rim := (1 - smoothstep(0, 1.5, d)) * 0.4 * clamp(0.5-dir.y*0.5, 0, 1)
	return col + vec4(rim, rim, rim, 0)
}
`)
)

// glassMatch is the identity a Segmented pill keeps as it moves between
// segments.
type glassMatch struct{ key string }

// Frost paints el as a frosted pane: the backdrop blurred and tinted by
// the raised face, a faint edge and a drop. el keeps its children and
// layout; radius is its corner. Where the window draws on the CPU, the
// pane is the opaque face. Cost: one backdrop blur pass a frame per pane.
func Frost(c *ui.Context, el ui.Element, radius float32) ui.Element {
	t := c.Theme()
	face := Raised(t)
	tint := face.Alpha(0.78)
	return el.Radius(radius).Border(1, Wash(t, 0.06)).Shadow(0, 12, 32, 0, Shade(0.18)).
		Draw(func(p *ui.Painter, r ui.Rect) {
			if !p.Accelerated() {
				p.Fill(r, face, radius)
				return
			}
			frost.Draw(p, r, shader.Options{BackdropBlur: 16, Radius: radius, Uniforms: map[string]any{"Tint": tint}})
		})
}

// LiquidGlass paints el as liquid glass: Frost's blur, the backdrop bent
// toward the edge and a lit top rim. Cost: as Frost, plus a few ALU ops a
// pixel.
func LiquidGlass(c *ui.Context, el ui.Element, radius float32) ui.Element {
	t := c.Theme()
	tint := t.Surface.Alpha(0.45)
	return el.Radius(radius).Shadow(0, 8, 24, 0, Shade(0.16)).
		Draw(func(p *ui.Painter, r ui.Rect) {
			if !p.Accelerated() {
				p.Fill(r, t.Surface, radius)
				return
			}
			liquid.Draw(p, r, shader.Options{BackdropBlur: 6, Radius: radius,
				Uniforms: map[string]any{"Tint": tint, "Radius": radius, "Bend": float32(6)}})
		})
}

// Segmented draws pill tabs on a liquid glass track; the selected pill
// glides to a new choice. key names the control and keeps the pill's
// identity; *selected is an index into labels.
func Segmented(c *ui.Context, key string, labels []string, selected *int) ui.Element {
	t := c.Theme()
	track := ui.Row(c).Key(key).Padding(3).Gap(2).AlignItems(ui.Center).Role(ui.RoleTabList).Label(key)
	LiquidGlass(c, track, 999)
	track.Children(func() {
		for i, label := range labels {
			c.Key(i)
			seg := ui.ButtonBase(c).Height(26).PaddingX(12).Radius(999).Role(ui.RoleTab).Checked(i == *selected).
				Label(label).Cursor(ui.CursorPointer).AlignItems(ui.Center).Justify(ui.Center)
			fg := t.TextMuted
			if i == *selected || seg.Hovered() {
				fg = t.Text
			}
			seg.TextColor(fg).Children(func() {
				if i == *selected {
					pill := ui.Box(c).Absolute().Top(0).Left(0).Right(0).Bottom(0).Radius(999).
						Background(t.Background.Alpha(0.85)).Shadow(0, 1, 3, 0, Shade(0.12))
					pill.Transition(ui.ElementTransition{Animation: &ui.Snappy, Match: glassMatch{key}})
				}
				ui.Text(c, label).FontSize(smallSize).FontWeight(500).SingleLine()
			})
			if seg.Clicked() {
				*selected = i
			}
		}
	})
	return track
}
