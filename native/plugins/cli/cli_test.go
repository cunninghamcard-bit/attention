package cli

import (
	"path/filepath"
	"testing"

	"github.com/arcships/rutis/go/rutis/rutistest"

	"github.com/cunninghamcard-bit/attention/native/internal/lifecycle"
	"github.com/cunninghamcard-bit/attention/native/plugins/actions"
)

func TestQuitIsTheCLIsInEveryProfile(t *testing.T) {
	t.Setenv("ATTENTION_SOCKET", filepath.Join(t.TempDir(), "cli.sock"))
	quit := false
	lifecycle.SetQuit(func() { quit = true })
	t.Cleanup(func() { lifecycle.SetQuit(nil) })
	act := actions.New()
	rutistest.Load(t, Plugin, nil, map[string]any{"actions": act})
	out, err := act.RunCLI(t.Context(), []string{"quit"}, "")
	if err != nil || out != "Quitting." || !quit {
		t.Fatalf("quit = %q, %v; quit ran %v", out, err, quit)
	}
}
