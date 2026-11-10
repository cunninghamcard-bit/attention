package appearance

import (
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
	zed := `{"name":"Custom","author":"test","themes":[{"name":"Custom Light","appearance":"light","style":{"editor.background":"#fefefe","panel.background":"#f0f0f0","border.variant":"#dddddd","text":"#112233","text.muted":"#667788","text.accent":"#0055ff","error":"#cc0000","warning":"#cc8800","success":"#008800","syntax":{"keyword":{"color":"#aa00bb"}}}}]}`
	if err := os.WriteFile(filepath.Join(dir, "custom.json"), []byte(zed), 0o644); err != nil {
		t.Fatal(err)
	}

	sl := slots.New(nil)
	set := settings.New(nil, sl)
	set.Set(settings.Appearance, "theme", "light")
	set.Set(settings.Appearance, "editorTheme", "One")
	set.Set(settings.Appearance, "iconTheme", "zed")
	set.Set(settings.Appearance, "showFileIcons", false)

	a := New(set, dir, func(f func()) { f() })
	a.IsDark = func() bool { return true }
	if a.Dark() {
		t.Fatal("expected the light theme to be light")
	}
	if a.Icons().Show {
		t.Fatal("expected file icons hidden")
	}
	ct := a.Editor(false)
	for k, want := range map[editor.TokenKind]string{
		editor.TokenVariable: "#242529",
		editor.TokenKeyword:  "#a449ab",
		editor.TokenFunction: "#5b79e3",
	} {
		if got := ct.Tokens[k].Color; got != ui.Hex(want) {
			t.Fatalf("One light token %d = %+v, want %s", k, got, want)
		}
	}

	set.Set(settings.Appearance, "editorTheme", "Custom")
	if got := a.Editor(false).Tokens[editor.TokenKeyword].Color; got != ui.Hex("#aa00bb") {
		t.Fatalf("Custom keyword color = %+v, want #aa00bb", got)
	}
	if got := a.UI().Background; got != ui.Hex("#ffffff") {
		t.Fatalf("background under Zed editor colors = %+v, want Attention Light's page #ffffff", got)
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
