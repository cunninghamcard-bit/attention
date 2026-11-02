package appearance

import (
	"embed"
	"encoding/json"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"

	"github.com/egoist/mygo/ui"
)

var (
	//go:embed themes/*.json
	builtinThemes embed.FS

	colorKeys  = [...]string{"background", "surface", "border", "text", "textMuted", "accent", "danger", "warning", "success"}
	syntaxKeys = [...]string{"comment", "keyword", "string", "number", "function", "type", "variable", "punctuation", "tag"}
	// zedColors and zedSyntax import a Zed theme: the first key a theme sets wins.
	zedColors = [len(colorKeys)][]string{
		{"editor.background", "background"},
		{"panel.background", "surface.background", "elevated_surface.background"},
		{"border.variant", "border"},
		{"text", "editor.foreground"},
		{"text.muted", "text.placeholder"},
		{"text.accent", "border.focused"},
		{"error", "version_control.deleted"},
		{"warning", "version_control.modified"},
		{"success", "created", "version_control.added"},
	}
	zedSyntax = [len(syntaxKeys)][]string{
		{"comment"}, {"keyword"}, {"string"}, {"number", "constant"}, {"function"},
		{"type"}, {"variable", "property"}, {"punctuation", "operator"}, {"tag"},
	}
	ansiNames = [...]string{"black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"}
)

// Theme is one color theme: what a theme file holds, and nothing else.
// Sizes and fonts are Settings; every other color is derived (build.go).
type Theme struct {
	Name string
	Dark bool
	// Colors is nil for attention-ui's own palette.
	Colors   *Colors
	Syntax   Syntax
	Terminal *[16]ui.Color
}

// Colors are a theme's interface colors.
type Colors struct {
	Background, Surface, Border, Text, TextMuted ui.Color
	Accent, Danger, Warning, Success             ui.Color
}

func (c *Colors) fields() [len(colorKeys)]*ui.Color {
	return [...]*ui.Color{&c.Background, &c.Surface, &c.Border, &c.Text, &c.TextMuted, &c.Accent, &c.Danger, &c.Warning, &c.Success}
}

// Syntax are a theme's code colors; a zero color keeps the editor's default.
type Syntax struct {
	Comment, Keyword, String, Number, Function ui.Color
	Type, Variable, Punctuation, Tag           ui.Color
}

func (s *Syntax) fields() [len(syntaxKeys)]*ui.Color {
	return [...]*ui.Color{&s.Comment, &s.Keyword, &s.String, &s.Number, &s.Function, &s.Type, &s.Variable, &s.Punctuation, &s.Tag}
}

type themeFile struct {
	Name   string            `json:"name"`
	Themes []json.RawMessage `json:"themes"`
}

type themeJSON struct {
	Name       string            `json:"name"`
	Appearance string            `json:"appearance"`
	Colors     map[string]string `json:"colors"`
	Syntax     map[string]string `json:"syntax"`
	Terminal   []string          `json:"terminal"`
	Style      map[string]any    `json:"style"`
}

func (tj themeJSON) theme() (Theme, error) {
	t := Theme{Name: tj.Name, Dark: tj.Appearance == "dark"}
	if t.Name == "" || tj.Appearance != "light" && tj.Appearance != "dark" {
		return t, fmt.Errorf("a theme needs a name and an appearance of light or dark")
	}
	if tj.Colors != nil {
		t.Colors = &Colors{}
		for i, dst := range t.Colors.fields() {
			c, ok := parseColor(tj.Colors[colorKeys[i]])
			if !ok {
				return t, fmt.Errorf("colors.%s is missing or not #rrggbb[aa]", colorKeys[i])
			}
			*dst = c
		}
	}
	for i, dst := range t.Syntax.fields() {
		*dst, _ = parseColor(tj.Syntax[syntaxKeys[i]])
	}
	if len(tj.Terminal) == 16 {
		var term [16]ui.Color
		for i, raw := range tj.Terminal {
			c, ok := parseColor(raw)
			if !ok {
				return t, fmt.Errorf("terminal[%d] is not #rrggbb[aa]", i)
			}
			term[i] = c
		}
		t.Terminal = &term
	}
	return t, nil
}

type catalog struct {
	themes map[string]Theme
	errs   []string
}

func loadCatalog(userDir string) catalog {
	cat := catalog{themes: map[string]Theme{}}
	entries, _ := fs.ReadDir(builtinThemes, "themes")
	for _, e := range entries {
		if data, err := builtinThemes.ReadFile("themes/" + e.Name()); err == nil {
			cat.add(e.Name(), data)
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
		path := filepath.Join(userDir, e.Name())
		data, err := os.ReadFile(path)
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
	for _, raw := range f.Themes {
		var tj themeJSON
		if err := json.Unmarshal(raw, &tj); err != nil {
			cat.errs = append(cat.errs, fmt.Sprintf("%s: %v", file, err))
			continue
		}
		if tj.Style != nil {
			tj = fromZed(tj)
		}
		t, err := tj.theme()
		if err != nil {
			cat.errs = append(cat.errs, fmt.Sprintf("%s: %s: %v", file, tj.Name, err))
			continue
		}
		cat.themes[t.Name] = t
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

func (cat catalog) theme(name string, dark bool) Theme {
	if t, ok := cat.themes[name]; ok && t.Dark == dark {
		return t
	}
	if dark {
		return cat.themes[DefaultDarkTheme]
	}
	return cat.themes[DefaultLightTheme]
}

func fromZed(tj themeJSON) themeJSON {
	str := func(m map[string]any, key string) string {
		switch v := m[key].(type) {
		case string:
			return v
		case map[string]any:
			s, _ := v["color"].(string)
			return s
		}
		return ""
	}
	first := func(m map[string]any, keys []string) string {
		for _, k := range keys {
			if s := str(m, k); s != "" {
				return s
			}
		}
		return ""
	}
	out := themeJSON{Name: tj.Name, Appearance: tj.Appearance, Colors: map[string]string{}, Syntax: map[string]string{}}
	for i, keys := range zedColors {
		out.Colors[colorKeys[i]] = first(tj.Style, keys)
	}
	syntax, _ := tj.Style["syntax"].(map[string]any)
	for i, keys := range zedSyntax {
		out.Syntax[syntaxKeys[i]] = first(syntax, keys)
	}
	for _, prefix := range [...]string{"terminal.ansi.", "terminal.ansi.bright_"} {
		for _, n := range ansiNames {
			out.Terminal = append(out.Terminal, str(tj.Style, prefix+n))
		}
	}
	if slices.Contains(out.Terminal, "") {
		out.Terminal = nil
	}
	return out
}

func parseColor(raw string) (ui.Color, bool) {
	h := strings.TrimPrefix(strings.TrimSpace(raw), "#")
	if len(h) == 3 {
		h = string([]byte{h[0], h[0], h[1], h[1], h[2], h[2]})
	}
	if len(h) != 6 && len(h) != 8 {
		return ui.Color{}, false
	}
	v, err := strconv.ParseUint(h, 16, 32)
	if err != nil {
		return ui.Color{}, false
	}
	if len(h) == 6 {
		v = v<<8 | 0xff
	}
	return ui.Color{R: uint8(v >> 24), G: uint8(v >> 16), B: uint8(v >> 8), A: uint8(v)}, true
}
