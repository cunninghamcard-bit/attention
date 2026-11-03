package appearance

import (
	"embed"
	"encoding/json"
	"fmt"
	"io/fs"
	"maps"
	"os"
	"path"
	"path/filepath"
	"slices"
	"strings"

	"github.com/egoist/mygo/ui"

	aui "github.com/cunninghamcard-bit/attention/native/ui"
)

//go:embed themes/*.json themes/zed/*.json
var builtinThemes embed.FS

// Theme is one interface theme as its file holds it: the palette and the
// token overrides (RFC 0004 §3–§5, §7). family is its file's name, which
// its own editor colors go by.
type Theme struct {
	Name       string
	Dark       bool
	family     string
	palette    map[string]ui.Color
	tokens     map[string]string
	components map[string]string
}

// Scheme is the editor and terminal colors of a theme, in Zed's style keys
// (RFC 0004 §6): a Zed theme file's, or the editor and terminal parts of
// one of ours.
type Scheme struct {
	Family string
	Name   string
	Dark   bool
	style  map[string]any
}

type schemeKey struct {
	family string
	dark   bool
}

type themeFile struct {
	Name   string            `json:"name"`
	Themes []json.RawMessage `json:"themes"`
}

type themeJSON struct {
	Name       string                     `json:"name"`
	Appearance string                     `json:"appearance"`
	Palette    map[string]json.RawMessage `json:"palette"`
	Tokens     map[string]string          `json:"tokens"`
	Components map[string]string          `json:"components"`
	Editor     map[string]any             `json:"editor"`
	Terminal   map[string]any             `json:"terminal"`
	Style      map[string]any             `json:"style"`
}

func (tj themeJSON) theme(family string) (Theme, error) {
	t := Theme{Name: tj.Name, Dark: tj.Appearance == "dark", family: family, palette: map[string]ui.Color{},
		tokens: tj.Tokens, components: tj.Components}
	for _, key := range paletteKeys {
		raw, ok := tj.Palette[key]
		if !ok {
			return t, fmt.Errorf("palette.%s is missing", key)
		}
		c, err := paletteColor(raw)
		if err != nil {
			return t, fmt.Errorf("palette.%s: %w", key, err)
		}
		t.palette[key] = c
	}
	return t, nil
}

// paletteColor reads "#rrggbb[aa]", or, for the accent, {"h", "s", "l"}
// with s and l in percent.
func paletteColor(raw json.RawMessage) (ui.Color, error) {
	var hex string
	if json.Unmarshal(raw, &hex) == nil {
		if c, ok := aui.ParseColor(hex); ok {
			return c, nil
		}
		return ui.Color{}, fmt.Errorf("%q is not #rrggbb[aa]", hex)
	}
	var hsl struct{ H, S, L *float64 }
	if json.Unmarshal(raw, &hsl) != nil || hsl.H == nil || hsl.S == nil || hsl.L == nil {
		return ui.Color{}, fmt.Errorf("%s is neither #rrggbb[aa] nor {h, s, l}", raw)
	}
	return fromHSL(*hsl.H, *hsl.S/100, *hsl.L/100, 255), nil
}

type catalog struct {
	themes  map[string]Theme
	schemes map[schemeKey]Scheme
	errs    []string
}

func loadCatalog(userDir string) catalog {
	cat := catalog{themes: map[string]Theme{}, schemes: map[schemeKey]Scheme{}}
	for _, dir := range [...]string{"themes", "themes/zed"} {
		entries, _ := fs.ReadDir(builtinThemes, dir)
		for _, e := range entries {
			if e.IsDir() || !strings.HasSuffix(e.Name(), ".json") {
				continue
			}
			if data, err := builtinThemes.ReadFile(path.Join(dir, e.Name())); err == nil {
				cat.add(e.Name(), data)
			}
		}
	}
	userEntries, err := os.ReadDir(userDir)
	if err != nil {
		return cat
	}
	for _, e := range userEntries {
		if e.IsDir() || !strings.HasSuffix(strings.ToLower(e.Name()), ".json") {
			continue
		}
		data, err := os.ReadFile(filepath.Join(userDir, e.Name()))
		if err != nil {
			cat.errs = append(cat.errs, err.Error())
			continue
		}
		cat.add(e.Name(), data)
	}
	return cat
}

func (cat *catalog) add(file string, data []byte) {
	var f themeFile
	if err := json.Unmarshal(data, &f); err != nil {
		cat.errs = append(cat.errs, fmt.Sprintf("%s: %v", file, err))
		return
	}
	family := f.Name
	if family == "" {
		family = strings.TrimSuffix(file, filepath.Ext(file))
	}
	for _, raw := range f.Themes {
		var tj themeJSON
		if err := json.Unmarshal(raw, &tj); err != nil {
			cat.errs = append(cat.errs, fmt.Sprintf("%s: %v", file, err))
			continue
		}
		if tj.Name == "" || tj.Appearance != "light" && tj.Appearance != "dark" {
			cat.errs = append(cat.errs, fmt.Sprintf("%s: a theme needs a name and an appearance of light or dark", file))
			continue
		}
		style := tj.Style
		if style == nil {
			t, err := tj.theme(family)
			if err != nil {
				cat.errs = append(cat.errs, fmt.Sprintf("%s: %s: %v", file, tj.Name, err))
				continue
			}
			cat.themes[t.Name] = t
			if tj.Editor == nil && tj.Terminal == nil {
				continue
			}
			style = map[string]any{}
			maps.Copy(style, tj.Editor)
			maps.Copy(style, tj.Terminal)
		}
		dark := tj.Appearance == "dark"
		cat.schemes[schemeKey{family, dark}] = Scheme{Family: family, Name: tj.Name, Dark: dark, style: style}
	}
}

func (cat catalog) names(dark bool) []string {
	var names []string
	for _, t := range cat.themes {
		if t.Dark == dark {
			names = append(names, t.Name)
		}
	}
	slices.Sort(names)
	return names
}

// families are the editor color families there are.
func (cat catalog) families() []string {
	var out []string
	for k := range cat.schemes {
		if !slices.Contains(out, k.family) {
			out = append(out, k.family)
		}
	}
	slices.Sort(out)
	return out
}

func (cat catalog) theme(name string, dark bool) Theme {
	if t, ok := cat.themes[name]; ok && t.Dark == dark {
		return t
	}
	if dark {
		return cat.themes[DefaultDarkTheme]
	}
	return cat.themes[DefaultLightTheme]
}

// scheme is the editor colors for t: family's of t's appearance, else
// t's own; ok is false when neither has any.
func (cat catalog) scheme(family string, t Theme) (Scheme, bool) {
	if s, ok := cat.schemes[schemeKey{family, t.Dark}]; ok && family != "" {
		return s, true
	}
	s, ok := cat.schemes[schemeKey{t.family, t.Dark}]
	return s, ok
}
