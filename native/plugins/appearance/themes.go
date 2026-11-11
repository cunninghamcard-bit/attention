package appearance

import (
	"cmp"
	"embed"
	"encoding/json"
	"fmt"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"slices"
	"strings"

	"github.com/egoist/mygo/ui"

	aui "github.com/cunninghamcard-bit/attention/native/ui"
)

var (
	//go:embed themes/base46/*.json
	builtinThemes embed.FS

	// base30Keys are the base_30 colors the interface and the editor read
	// (attention#11); a theme without one of them does not load.
	base30Keys = [...]string{
		"white", "darker_black", "black", "black2", "one_bg", "one_bg2", "one_bg3", "grey", "grey_fg", "grey_fg2",
		"line", "red", "green", "yellow", "blue", "purple",
	}
)

// Theme is one base46 theme (NvChad's, themes/base46/LICENSE): base30 its
// interface colors, base16 its code colors, base00 to base0F.
type Theme struct {
	Name   string
	Dark   bool
	base30 map[string]ui.Color
	base16 [16]ui.Color
}

// color is t's base_30 color key.
func (t Theme) color(key string) ui.Color { return t.base30[key] }

// pick is t's base_30 color light in a light theme, dark in a dark one.
func (t Theme) pick(light, dark string) ui.Color {
	if t.Dark {
		return t.base30[dark]
	}
	return t.base30[light]
}

type themeJSON struct {
	Name   string            `json:"name"`
	Type   string            `json:"type"`
	Base30 map[string]string `json:"base_30"`
	Base16 map[string]string `json:"base_16"`
}

func (tj themeJSON) theme(file string) (Theme, error) {
	t := Theme{Name: cmp.Or(tj.Name, strings.TrimSuffix(file, filepath.Ext(file))), Dark: tj.Type == "dark",
		base30: map[string]ui.Color{}}
	if tj.Type != "light" && tj.Type != "dark" {
		return t, fmt.Errorf("type %q is neither light nor dark", tj.Type)
	}
	for _, key := range base30Keys {
		c, ok := aui.ParseColor(tj.Base30[key])
		if !ok {
			return t, fmt.Errorf("base_30.%s %q is not #rrggbb[aa]", key, tj.Base30[key])
		}
		t.base30[key] = c
	}
	for i := range t.base16 {
		key := fmt.Sprintf("base%02X", i)
		c, ok := aui.ParseColor(tj.Base16[key])
		if !ok {
			return t, fmt.Errorf("base_16.%s %q is not #rrggbb[aa]", key, tj.Base16[key])
		}
		t.base16[i] = c
	}
	return t, nil
}

type catalog struct {
	themes map[string]Theme
	errs   []string
}

func loadCatalog(userDir string) catalog {
	cat := catalog{themes: map[string]Theme{}}
	entries, _ := fs.ReadDir(builtinThemes, "themes/base46")
	for _, e := range entries {
		if data, err := builtinThemes.ReadFile(path.Join("themes/base46", e.Name())); err == nil {
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
	var tj themeJSON
	if err := json.Unmarshal(data, &tj); err != nil {
		cat.errs = append(cat.errs, fmt.Sprintf("%s: %v", file, err))
		return
	}
	t, err := tj.theme(file)
	if err != nil {
		cat.errs = append(cat.errs, fmt.Sprintf("%s: %v", file, err))
		return
	}
	cat.themes[t.Name] = t
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
