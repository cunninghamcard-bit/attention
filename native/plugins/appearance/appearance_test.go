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
	set.Set(settings.Appearance, "theme", "moonstone")
	set.Set(settings.Appearance, "lightTheme", "One Light")
	set.Set(settings.Appearance, "iconTheme", "zed")
	set.Set(settings.Appearance, "showFileIcons", false)

	a := New(set, dir, func(f func()) { f() })
	a.IsDark = func() bool { return true }
	if a.Dark() {
		t.Fatal("expected moonstone theme to be light")
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
			t.Fatalf("One Light token %d = %+v, want %s", k, got, want)
		}
	}

	set.Set(settings.Appearance, "lightTheme", "Custom Light")
	if got := a.Editor(false).Tokens[editor.TokenKeyword].Color; got != ui.Hex("#aa00bb") {
		t.Fatalf("Custom Light keyword color = %+v, want #aa00bb", got)
	}
	if got := a.UI().Background; got != ui.Hex("#fefefe") {
		t.Fatalf("Custom Light background = %+v, want #fefefe", got)
	}

	tt := ui.NewTester(a.View, 900, 900)
	tt.Frame()
}
