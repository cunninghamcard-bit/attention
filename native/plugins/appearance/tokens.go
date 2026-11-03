package appearance

import (
	"fmt"
	"strconv"
	"strings"

	"github.com/egoist/mygo/ui"

	aui "github.com/cunninghamcard-bit/attention/native/ui"
)

var (
	// paletteKeys are the colors a theme's palette must hold (RFC 0004 §3).
	paletteKeys = [...]string{
		"neutral.0", "neutral.5", "neutral.10", "neutral.20", "neutral.30", "neutral.40", "neutral.50",
		"neutral.60", "neutral.70", "neutral.80", "neutral.100",
		"red", "orange", "yellow", "green", "cyan", "blue", "purple", "pink", "accent",
	}

	// semanticDefaults are RFC 0004 §4's defaults, light then dark where
	// they differ; a later one may name an earlier one.
	semanticDefaults = []struct{ name, light, dark string }{
		{"bg.window", "neutral.10", ""},
		{"bg.page", "neutral.0", ""},
		{"bg.raised", "neutral.0", "neutral.20"},
		{"bg.overlay", "neutral.0", "neutral.10"},
		{"bg.field", "neutral.100@0.05", ""},
		{"bg.inverse", "neutral.100", ""},
		{"text.primary", "neutral.100", ""},
		{"text.secondary", "neutral.70", ""},
		{"text.tertiary", "neutral.50", ""},
		{"text.onAccent", "onAccent", ""},
		{"text.inverse", "neutral.0", ""},
		{"text.link", "accent", ""},
		{"border.subtle", "neutral.100@0.08", ""},
		{"border.default", "neutral.30", ""},
		{"border.strong", "neutral.40", ""},
		{"border.focus", "accent@0.35", ""},
		{"fill.hover", "neutral.100@0.06", ""},
		{"fill.pressed", "neutral.100@0.1", ""},
		{"fill.selected", "neutral.100@0.08", ""},
		{"fill.accent", "accent@0.14", ""},
		{"accent.fill", "accent.1", ""},
		{"accent.fillHover", "accent.2", ""},
		{"accent.fillPressed", "accent", ""},
		{"accent.border", "accent@0.55", ""},
		{"status.error", "red", ""},
		{"status.warning", "orange", ""},
		{"status.success", "green", ""},
		{"status.info", "blue", ""},
		{"status.errorFill", "red", ""},
		{"selection", "accent@0.25", ""},
		{"highlight", "yellow@0.4", ""},
		{"scrollbar", "neutral.100@0.25", ""},
		{"scrim", "#000000@0.32", ""},
		{"shadow.small", "0 1 2 #000000@0.08", ""},
		{"shadow.medium", "0 12 32 #000000@0.18", ""},
		{"shadow.large", "0 24 64 #000000@0.28", ""},
	}

	colorTokens = map[string]func(*aui.Tokens) *ui.Color{
		"bg.window":          func(k *aui.Tokens) *ui.Color { return &k.BgWindow },
		"bg.page":            func(k *aui.Tokens) *ui.Color { return &k.BgPage },
		"bg.raised":          func(k *aui.Tokens) *ui.Color { return &k.BgRaised },
		"bg.overlay":         func(k *aui.Tokens) *ui.Color { return &k.BgOverlay },
		"bg.field":           func(k *aui.Tokens) *ui.Color { return &k.BgField },
		"bg.inverse":         func(k *aui.Tokens) *ui.Color { return &k.BgInverse },
		"text.primary":       func(k *aui.Tokens) *ui.Color { return &k.Text },
		"text.secondary":     func(k *aui.Tokens) *ui.Color { return &k.TextSecondary },
		"text.tertiary":      func(k *aui.Tokens) *ui.Color { return &k.TextTertiary },
		"text.onAccent":      func(k *aui.Tokens) *ui.Color { return &k.TextOnAccent },
		"text.inverse":       func(k *aui.Tokens) *ui.Color { return &k.TextInverse },
		"text.link":          func(k *aui.Tokens) *ui.Color { return &k.TextLink },
		"border.subtle":      func(k *aui.Tokens) *ui.Color { return &k.BorderSubtle },
		"border.default":     func(k *aui.Tokens) *ui.Color { return &k.Border },
		"border.strong":      func(k *aui.Tokens) *ui.Color { return &k.BorderStrong },
		"border.focus":       func(k *aui.Tokens) *ui.Color { return &k.BorderFocus },
		"fill.hover":         func(k *aui.Tokens) *ui.Color { return &k.FillHover },
		"fill.pressed":       func(k *aui.Tokens) *ui.Color { return &k.FillPressed },
		"fill.selected":      func(k *aui.Tokens) *ui.Color { return &k.FillSelected },
		"fill.accent":        func(k *aui.Tokens) *ui.Color { return &k.FillAccent },
		"accent.fill":        func(k *aui.Tokens) *ui.Color { return &k.AccentFill },
		"accent.fillHover":   func(k *aui.Tokens) *ui.Color { return &k.AccentFillHover },
		"accent.fillPressed": func(k *aui.Tokens) *ui.Color { return &k.AccentFillPressed },
		"accent.border":      func(k *aui.Tokens) *ui.Color { return &k.AccentBorder },
		"status.error":       func(k *aui.Tokens) *ui.Color { return &k.Error },
		"status.warning":     func(k *aui.Tokens) *ui.Color { return &k.Warning },
		"status.success":     func(k *aui.Tokens) *ui.Color { return &k.Success },
		"status.info":        func(k *aui.Tokens) *ui.Color { return &k.Info },
		"status.errorFill":   func(k *aui.Tokens) *ui.Color { return &k.ErrorFill },
		"selection":          func(k *aui.Tokens) *ui.Color { return &k.Selection },
		"highlight":          func(k *aui.Tokens) *ui.Color { return &k.Highlight },
		"scrollbar":          func(k *aui.Tokens) *ui.Color { return &k.Scrollbar },
		"scrim":              func(k *aui.Tokens) *ui.Color { return &k.Scrim },
	}

	shadowTokens = map[string]func(*aui.Tokens) *aui.Shadow{
		"shadow.small":  func(k *aui.Tokens) *aui.Shadow { return &k.ShadowSmall },
		"shadow.medium": func(k *aui.Tokens) *aui.Shadow { return &k.ShadowMedium },
		"shadow.large":  func(k *aui.Tokens) *aui.Shadow { return &k.ShadowLarge },
	}

	componentColors = map[string]func(*aui.Tokens) *ui.Color{
		"tabRow.selected":          func(k *aui.Tokens) *ui.Color { return &k.TabRowSelected },
		"tabRow.hover":             func(k *aui.Tokens) *ui.Color { return &k.TabRowHover },
		"splitRow.selected":        func(k *aui.Tokens) *ui.Color { return &k.SplitRowSelected },
		"splitRow.hover":           func(k *aui.Tokens) *ui.Color { return &k.SplitRowHover },
		"addressBar.bg":            func(k *aui.Tokens) *ui.Color { return &k.AddressBar },
		"addressBar.hover":         func(k *aui.Tokens) *ui.Color { return &k.AddressBarHover },
		"card.border":              func(k *aui.Tokens) *ui.Color { return &k.CardBorder },
		"field.hover":              func(k *aui.Tokens) *ui.Color { return &k.FieldHover },
		"menu.itemHover":           func(k *aui.Tokens) *ui.Color { return &k.MenuItem },
		"button.secondary":         func(k *aui.Tokens) *ui.Color { return &k.ButtonSecondary },
		"button.secondary.hover":   func(k *aui.Tokens) *ui.Color { return &k.ButtonSecondaryHover },
		"button.secondary.pressed": func(k *aui.Tokens) *ui.Color { return &k.ButtonSecondaryPressed },
		"button.danger.hover":      func(k *aui.Tokens) *ui.Color { return &k.ButtonDangerHover },
		"button.danger.pressed":    func(k *aui.Tokens) *ui.Color { return &k.ButtonDangerPressed },
		"glass.bg":                 func(k *aui.Tokens) *ui.Color { return &k.GlassTint },
		"glass.track":              func(k *aui.Tokens) *ui.Color { return &k.GlassTrack },
		"segment.pill":             func(k *aui.Tokens) *ui.Color { return &k.SegmentPill },
		"switch.off":               func(k *aui.Tokens) *ui.Color { return &k.SwitchOff },
		"switch.on":                func(k *aui.Tokens) *ui.Color { return &k.SwitchOn },
		"switch.knob":              func(k *aui.Tokens) *ui.Color { return &k.SwitchKnob },
		"switch.knobOn":            func(k *aui.Tokens) *ui.Color { return &k.SwitchKnobOn },
	}

	componentShadows = map[string]func(*aui.Tokens) *aui.Shadow{
		"tabRow.selectedShadow": func(k *aui.Tokens) *aui.Shadow { return &k.TabRowShadow },
		"card.shadow":           func(k *aui.Tokens) *aui.Shadow { return &k.CardShadow },
	}
)

// resolver evaluates token expressions: a palette color, a token or
// "#rrggbb[aa]", each optionally "@alpha"; a shadow is "x y blur color".
type resolver struct {
	colors map[string]ui.Color
	exprs  map[string]string
	busy   map[string]bool
}

func (r *resolver) color(expr string) (ui.Color, error) {
	ref, alpha, hasAlpha := strings.Cut(strings.TrimSpace(expr), "@")
	c, err := r.ref(ref)
	if err != nil || !hasAlpha {
		return c, err
	}
	a, err := strconv.ParseFloat(alpha, 32)
	if err != nil {
		return c, fmt.Errorf("%q: alpha %q is not a number", expr, alpha)
	}
	return c.Alpha(float32(a)), nil
}

func (r *resolver) ref(ref string) (ui.Color, error) {
	if strings.HasPrefix(ref, "#") {
		if c, ok := aui.ParseColor(ref); ok {
			return c, nil
		}
		return ui.Color{}, fmt.Errorf("%q is not #rrggbb[aa]", ref)
	}
	if c, ok := r.colors[ref]; ok {
		return c, nil
	}
	expr, ok := r.exprs[ref]
	if !ok {
		return ui.Color{}, fmt.Errorf("%q names no color or token", ref)
	}
	if r.busy[ref] {
		return ui.Color{}, fmt.Errorf("%q refers to itself", ref)
	}
	r.busy[ref] = true
	c, err := r.color(expr)
	delete(r.busy, ref)
	if err == nil {
		r.colors[ref] = c
	}
	return c, err
}

func (r *resolver) shadow(expr string) (aui.Shadow, error) {
	f := strings.Fields(expr)
	if len(f) != 4 {
		return aui.Shadow{}, fmt.Errorf("shadow %q is not \"x y blur color\"", expr)
	}
	var n [3]float32
	for i := range n {
		v, err := strconv.ParseFloat(f[i], 32)
		if err != nil {
			return aui.Shadow{}, fmt.Errorf("shadow %q: %q is not a number", expr, f[i])
		}
		n[i] = float32(v)
	}
	c, err := r.color(f[3])
	return aui.Shadow{X: n[0], Y: n[1], Blur: n[2], Color: c}, err
}

// tokens resolves t's palette, with accent in place of its own when
// accent is set, and its token overrides into a token set; errs are the
// overrides that did not resolve, which keep their defaults.
func tokens(t Theme, accent ui.Color) (k *aui.Tokens, errs []string) {
	colors := make(map[string]ui.Color, len(t.palette)+3)
	for name, c := range t.palette {
		colors[name] = c
	}
	if accent.A > 0 {
		colors["accent"] = accent
	}
	colors["accent.1"], colors["accent.2"] = accentSteps(colors["accent"], t.Dark)
	colors["onAccent"] = onAccent(colors["accent.1"])
	r := &resolver{colors: colors, exprs: map[string]string{}, busy: map[string]bool{}}
	for _, d := range semanticDefaults {
		r.exprs[d.name] = d.light
		if t.Dark && d.dark != "" {
			r.exprs[d.name] = d.dark
		}
	}
	for name, expr := range t.tokens {
		if _, ok := r.exprs[name]; !ok {
			errs = append(errs, fmt.Sprintf("tokens.%s: no such token", name))
			continue
		}
		r.exprs[name] = expr
	}
	k = &aui.Tokens{}
	for _, d := range semanticDefaults {
		if field, ok := shadowTokens[d.name]; ok {
			s, err := r.shadow(r.exprs[d.name])
			if err != nil {
				errs = append(errs, fmt.Sprintf("tokens.%s: %v", d.name, err))
				s, _ = r.shadow(d.light)
			}
			*field(k) = s
			continue
		}
		c, err := r.ref(d.name)
		if err != nil {
			errs = append(errs, fmt.Sprintf("tokens.%s: %v", d.name, err))
			r.exprs[d.name] = d.light
			if t.Dark && d.dark != "" {
				r.exprs[d.name] = d.dark
			}
			c, _ = r.ref(d.name)
		}
		*colorTokens[d.name](k) = c
	}
	aui.ComponentTokens(k)
	for name, expr := range t.components {
		if field, ok := componentShadows[name]; ok {
			s, err := r.shadow(expr)
			if err != nil {
				errs = append(errs, fmt.Sprintf("components.%s: %v", name, err))
				continue
			}
			*field(k) = s
			continue
		}
		field, ok := componentColors[name]
		if !ok {
			errs = append(errs, fmt.Sprintf("components.%s: no such token", name))
			continue
		}
		c, err := r.color(expr)
		if err != nil {
			errs = append(errs, fmt.Sprintf("components.%s: %v", name, err))
			continue
		}
		*field(k) = c
	}
	return k, errs
}
