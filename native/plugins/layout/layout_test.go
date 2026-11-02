package layout

import (
	"encoding/json"
	"testing"

	"github.com/egoist/mygo/ui"
	"github.com/smallnest/uix/components/lucide"

	"github.com/cunninghamcard-bit/attention/native/plugins/slots"
)

func TestPanelStateRoundTrips(t *testing.T) {
	sl := slots.New(nil)
	var got string
	off := sl.RegisterPanel(slots.Panel{ID: "search", Title: "search", Icon: lucide.Search(), Dock: slots.Left,
		View:    func(c *ui.Context, _ slots.PanelProps) { ui.Text(c, "body") },
		State:   func() json.RawMessage { data, _ := json.Marshal(got + "-saved"); return data },
		Restore: func(st json.RawMessage) { got = string(st) },
	})
	t.Cleanup(off)
	l := New(nil, sl, nil)
	l.IsDark = func() bool { return false }
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
