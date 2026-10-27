package layout

import (
	"encoding/json"
	"testing"

	"github.com/egoist/mygo/ui"
	"github.com/smallnest/uix/components/lucide"

	"github.com/cunninghamcard-bit/attention/native/slotsapi"
)

func TestPanelStateRoundTrips(t *testing.T) {
	var got string
	off := slotsapi.RegisterPanel(slotsapi.Panel{ID: "search", Title: "search", Icon: lucide.Search(), Dock: slotsapi.Left,
		View:    func(c *ui.Context, _ slotsapi.PanelProps) { ui.Text(c, "body") },
		State:   func() json.RawMessage { data, _ := json.Marshal(got + "-saved"); return data },
		Restore: func(st json.RawMessage) { got = string(st) },
	})
	t.Cleanup(off)
	l := New()
	l.IsDark = func() bool { return false }
	// A state for a panel not loaded this run is kept as it was.
	l.Restore(state{PanelOpen: true, PanelStates: map[string]json.RawMessage{"search": json.RawMessage(`"q"`), "gone": json.RawMessage(`1`)}})
	if s := l.Snapshot(); string(s.PanelStates["search"]) != `"q"` {
		t.Fatalf("before the first draw the saved state is kept: %s", s.PanelStates["search"])
	}
	tt := ui.NewTester(l.View, 1000, 700)
	tt.Frame()
	if got != `"q"` {
		t.Fatalf("Restore got %q", got)
	}
	s := l.Snapshot()
	if string(s.PanelStates["search"]) != `"\"q\"-saved"` || string(s.PanelStates["gone"]) != `1` {
		t.Fatalf("panel states = %s / %s", s.PanelStates["search"], s.PanelStates["gone"])
	}
}
