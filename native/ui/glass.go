package ui

import (
	"github.com/cunninghamcard-bit/acard-ui/tokens"
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

// Frost paints el as a frosted pane: the backdrop blurred and tinted by
// the raised face, a faint edge and a drop. el keeps its children and
// layout; radius is its corner. Where the window draws on the CPU, the
// pane is the opaque face. Cost: one backdrop blur pass a frame per pane.
func Frost(c *ui.Context, el ui.Element, radius float32) ui.Element {
	tok, k := tokens.TokensOf(c), TokensOf(c)
	return shadow(el.Radius(radius).Border(1, tok.BorderSubtle), tok.ShadowRaised).
		Draw(func(p *ui.Painter, r ui.Rect) {
			if !p.Accelerated() {
				p.Fill(r, tok.SurfaceRaised, radius)
				return
			}
			frost.Draw(p, r, shader.Options{BackdropBlur: 16, Radius: radius, Uniforms: map[string]any{"Tint": k.GlassTint}})
		})
}

// LiquidGlass paints el as liquid glass: Frost's blur, the backdrop bent
// toward the edge and a lit top rim. Cost: as Frost, plus a few ALU ops a
// pixel.
func LiquidGlass(c *ui.Context, el ui.Element, radius float32) ui.Element {
	k := TokensOf(c)
	return shadow(el.Radius(radius), tokens.TokensOf(c).ShadowRaised).
		Draw(func(p *ui.Painter, r ui.Rect) {
			if !p.Accelerated() {
				p.Fill(r, k.BgWindow, radius)
				return
			}
			liquid.Draw(p, r, shader.Options{BackdropBlur: 6, Radius: radius,
				Uniforms: map[string]any{"Tint": k.GlassTrack, "Radius": radius, "Bend": float32(6)}})
		})
}
