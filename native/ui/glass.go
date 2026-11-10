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
