package shortcuts

import (
	"testing"

	"github.com/egoist/mygo/ui"
)

// Regression: "Ctrl ," split at its comma and bound nothing.
func TestTheCommaKeyBinds(t *testing.T) {
	if b := Parse("Ctrl Comma"); len(b) != 1 || b[0] != (Binding{Mods: ui.Cmd, Key: ui.KeyComma}) {
		t.Fatalf("Ctrl Comma = %v", b)
	}
	if got := Format(Defaults("Ctrl Comma")[0]); got != "Ctrl + ," {
		t.Fatalf("label %q", got)
	}
}
