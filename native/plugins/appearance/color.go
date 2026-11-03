package appearance

import (
	"math"

	"github.com/egoist/mygo/ui"
)

// accentSteps are the button face and its hover from accent, as the TS
// app's --color-accent-1 and --color-accent-2 shift hue, saturation and
// lightness (RFC 0004 §3).
func accentSteps(accent ui.Color, dark bool) (one, two ui.Color) {
	h, s, l := toHSL(accent)
	if dark {
		return fromHSL(h-3, s*1.02, l*1.15, accent.A), fromHSL(h-5, s*1.05, l*1.29, accent.A)
	}
	return fromHSL(h-1, s*1.01, l*1.075, accent.A), fromHSL(h-3, s*1.02, l*1.15, accent.A)
}

// onAccent is text on c: near black on a light face, near white on a dark one.
func onAccent(c ui.Color) ui.Color {
	if (int(c.R)*299+int(c.G)*587+int(c.B)*114)/1000 >= 160 {
		return ui.Hex("#0c0c0c")
	}
	return ui.Hex("#fafafa")
}

// toHSL is c's hue in degrees and its saturation and lightness in [0, 1].
func toHSL(c ui.Color) (h, s, l float64) {
	r, g, b := float64(c.R)/255, float64(c.G)/255, float64(c.B)/255
	hi, lo := max(r, g, b), min(r, g, b)
	l = (hi + lo) / 2
	d := hi - lo
	if d == 0 {
		return 0, 0, l
	}
	s = d / (1 - math.Abs(2*l-1))
	switch hi {
	case r:
		h = math.Mod((g-b)/d, 6)
	case g:
		h = (b-r)/d + 2
	default:
		h = (r-g)/d + 4
	}
	return math.Mod(h*60+360, 360), s, l
}

// fromHSL is the color of hue h in degrees, saturation s and lightness l,
// both clamped to [0, 1], and alpha a.
func fromHSL(h, s, l float64, a uint8) ui.Color {
	s, l = min(max(s, 0), 1), min(max(l, 0), 1)
	h = math.Mod(h+360, 360)
	c := (1 - math.Abs(2*l-1)) * s
	x := c * (1 - math.Abs(math.Mod(h/60, 2)-1))
	m := l - c/2
	var r, g, b float64
	switch {
	case h < 60:
		r, g = c, x
	case h < 120:
		r, g = x, c
	case h < 180:
		g, b = c, x
	case h < 240:
		g, b = x, c
	case h < 300:
		r, b = x, c
	default:
		r, b = c, x
	}
	to8 := func(v float64) uint8 { return uint8(math.Round((v + m) * 255)) }
	return ui.Color{R: to8(r), G: to8(g), B: to8(b), A: a}
}
