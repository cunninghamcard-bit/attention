package appearance

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/egoist/mygo/ui"
	"github.com/egoist/mygo/ui/editor"

	"github.com/cunninghamcard-bit/attention/native/plugins/settings"
	"github.com/cunninghamcard-bit/attention/native/plugins/slots"
)

func TestAppearanceSyncAndThemeFiles(t *testing.T) {
	dir := t.TempDir()
	data, err := builtinThemes.ReadFile("themes/base46/one_light.json")
	if err != nil {
		t.Fatal(err)
	}
	var custom map[string]any
	if err := json.Unmarshal(data, &custom); err != nil {
		t.Fatal(err)
	}
	custom["name"] = "custom"
	custom["base_16"].(map[string]any)["base0E"] = "#aa00bb"
	if data, err = json.Marshal(custom); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "custom.json"), data, 0o644); err != nil {
		t.Fatal(err)
	}

	sl := slots.New(nil)
	set := settings.New(nil, sl)
	set.Set(settings.Appearance, "theme", "light")
	set.Set(settings.Appearance, "iconTheme", "zed")
	set.Set(settings.Appearance, "showFileIcons", false)

	a := New(set, dir, func(f func()) { f() })
	a.IsDark = func() bool { return true }
	if len(a.cat.errs) > 0 {
		t.Fatalf("catalog errors: %v", a.cat.errs)
	}
	if light, dark := len(a.ThemeNames(false)), len(a.ThemeNames(true)); light != 22 || dark != 77 {
		t.Fatalf("themes = %d light, %d dark, want base46's 21 and 77 and the custom one", light, dark)
	}
	if a.Dark() {
		t.Fatal("expected the light theme to be light")
	}
	if a.Icons().Show {
		t.Fatal("expected file icons hidden")
	}
	if got := a.Editor(false).Tokens[editor.TokenKeyword].Color; got != ui.Hex("#a626a4") {
		t.Fatalf("one_light keyword color = %+v, want base0E #a626a4", got)
	}

	set.Set(settings.Appearance, "lightTheme", "custom")
	if got := a.Editor(false).Tokens[editor.TokenKeyword].Color; got != ui.Hex("#aa00bb") {
		t.Fatalf("custom keyword color = %+v, want #aa00bb", got)
	}

	tt := ui.NewTester(a.View, 900, 900)
	tt.Frame()
}

func TestSettingsGroupsStayRaised(t *testing.T) {
	a := New(settings.New(nil, slots.New(nil)), t.TempDir(), func(f func()) { f() })
	for _, dark := range []bool{false, true} {
		a.IsDark = func() bool { return dark }
		tt := ui.NewTester(func(c *ui.Context) {
			c.SetTheme(a.UI())
			ui.Column(c).Fill().Background(a.UI().Background).Padding(16).Children(func() { a.View(c) })
		}, 760, 720)
		tt.SetDark(dark)
		tt.Frame()
		r, ok := tt.Find("Base color scheme")
		if !ok {
			t.Fatalf("dark=%v: no Base color scheme row", dark)
		}
		got, want := tt.Image().RGBAAt(int(r.X)-6, int(r.Y+r.H/2)), a.of(dark).tokens.BgRaised
		if d := max(diff(got.R, want.R), diff(got.G, want.G), diff(got.B, want.B)); d > 2 {
			t.Fatalf("dark=%v: settings group = %v, want the raised surface %v", dark, got, want)
		}
	}
}

func diff(a, b uint8) uint8 { return max(a, b) - min(a, b) }
