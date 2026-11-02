package appearance

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/egoist/mygo/ui"
	"github.com/egoist/mygo/ui/editor"

	"github.com/cunninghamcard-bit/attention/native/internal/fileicon"
	"github.com/cunninghamcard-bit/attention/native/internal/textdoc"
	"github.com/cunninghamcard-bit/attention/native/plugins/settings"
	"github.com/cunninghamcard-bit/attention/native/plugins/slots"
)

func TestAppearanceSyncAndThemeFiles(t *testing.T) {
	t.Setenv("ATTENTION_CONFIG_DIR", t.TempDir())
	// Write a custom Zed theme file in <configDir>/themes/custom.json and verify it loads.
	if err := os.MkdirAll(textdoc.ThemesDir(), 0o755); err != nil {
		t.Fatal(err)
	}
	customJSON := `{"name":"Custom","author":"test","themes":[{"name":"Custom Light","appearance":"light","style":{"editor.background":"#fefefe","editor.foreground":"#112233","syntax":{"keyword":{"color":"#aa00bb"}}}}]}`
	if err := os.WriteFile(filepath.Join(textdoc.ThemesDir(), "custom.json"), []byte(customJSON), 0o644); err != nil {
		t.Fatal(err)
	}
	textdoc.ReloadThemes()

	sl := slots.New(nil)
	set := settings.New(nil, sl)
	set.Set(settings.Appearance, "theme", "moonstone")
	set.Set(settings.Appearance, "lightTheme", "One Light")
	set.Set(settings.Appearance, "accentColor", "#ff5500")
	set.Set(settings.Appearance, "iconTheme", "zed")
	set.Set(settings.Appearance, "showFileIcons", false)
	set.Set(settings.Appearance, "editorFontSize", 16)
	set.Set(settings.Appearance, "lineHeight", "standard")

	m := New(nil, set)
	m.IsDark = func() bool { return false }
	if m.Dark() {
		t.Fatal("expected moonstone theme to be light")
	}
	if fileicon.Shown() {
		t.Fatal("expected fileicon.Shown() to be false after Sync")
	}
	// Verify One Light is loaded 1:1 from themes/one.json:
	// variable is #242529 (not red), keyword is #a449ab, function is #5b79e3.
	ct := textdoc.CodeTheme(false)
	if ct.Tokens[editor.TokenVariable].Color != ui.Hex("#242529") {
		t.Fatalf("One Light variable color = %+v, want #242529", ct.Tokens[editor.TokenVariable].Color)
	}
	if ct.Tokens[editor.TokenKeyword].Color != ui.Hex("#a449ab") {
		t.Fatalf("One Light keyword color = %+v, want #a449ab", ct.Tokens[editor.TokenKeyword].Color)
	}
	if ct.Tokens[editor.TokenFunction].Color != ui.Hex("#5b79e3") {
		t.Fatalf("One Light function color = %+v, want #5b79e3", ct.Tokens[editor.TokenFunction].Color)
	}

	// Switch to user's custom theme file from <configDir>/themes/custom.json.
	set.Set(settings.Appearance, "lightTheme", "Custom Light")
	m.Sync()
	if got := textdoc.CodeTheme(false).Tokens[editor.TokenKeyword].Color; got != ui.Hex("#aa00bb") {
		t.Fatalf("Custom Light keyword color = %+v, want #aa00bb", got)
	}

	tt := ui.NewTester(m.View, 900, 900)
	tt.Frame()
}
