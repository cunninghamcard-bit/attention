package cli

import (
	"path/filepath"
	"testing"

	"github.com/arcships/rutis/go/rutis/rutistest"

	"github.com/cunninghamcard-bit/attention/native/actionsapi"
	"github.com/cunninghamcard-bit/attention/native/internal/lifecycle"
)

// Regression: quit was the workspace's, so a headless run, which loads no
// workspace, could not be quit from the CLI.
func TestQuitIsTheCLIsInEveryProfile(t *testing.T) {
	t.Setenv("ATTENTION_SOCKET", filepath.Join(t.TempDir(), "cli.sock"))
	quit := false
	lifecycle.SetQuit(func() { quit = true })
	t.Cleanup(func() { lifecycle.SetQuit(nil) })
	rutistest.Load(t, Plugin, nil, map[string]any{"actions": struct{}{}})
	out, err := actionsapi.RunCLI(t.Context(), []string{"quit"}, "")
	if err != nil || out != "Quitting." || !quit {
		t.Fatalf("quit = %q, %v; quit ran %v", out, err, quit)
	}
}
