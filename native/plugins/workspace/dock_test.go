package workspace

import (
	"encoding/json"
	"testing"

	"github.com/egoist/mygo/ui"
	"github.com/smallnest/uix/components/lucide"

	fscontract "github.com/cunninghamcard-bit/attention/native/contract/fs"
	"github.com/cunninghamcard-bit/attention/native/slotsapi"
	"github.com/cunninghamcard-bit/attention/native/workspaceapi"
)

// panel registers a left panel drawing body, counting its reveals.
func panel(t *testing.T, id string, order int, body string, reveals *int) {
	t.Helper()
	off := slotsapi.RegisterPanel(slotsapi.Panel{ID: id, Title: id, Icon: lucide.Folder(), Dock: slotsapi.Left, Order: order,
		View: func(c *ui.Context, p slotsapi.PanelProps) {
			if reveals != nil {
				*reveals = p.Reveal
			}
			ui.Text(c, body)
		}})
	t.Cleanup(off)
}

func TestDockShowsFirstPanelAndRevealsByShortcut(t *testing.T) {
	var searchReveals int
	panel(t, "file-explorer", 0, "tree body", nil)
	panel(t, "search", 1, "search body", &searchReveals)
	ws, tt := testWorkspace(t)
	if !tt.HasText("tree body") || tt.HasText("search body") {
		t.Fatalf("the left dock should show the first panel: %v", tt.Texts())
	}
	if err := tt.Click("search"); err != nil {
		t.Fatal(err)
	}
	tt.Frame()
	if ws.leftPanel != "search" || !tt.HasText("search body") {
		t.Fatalf("clicking the header icon should show search: %q %v", ws.leftPanel, tt.Texts())
	}
	press(tt, ui.Cmd, ui.KeyB)
	if ws.panelOpen || tt.HasText("tree body") {
		t.Fatal("Ctrl B should close the left dock")
	}
	press(tt, ui.Cmd|ui.Shift, ui.KeyF)
	if !ws.panelOpen || !tt.HasText("search body") || searchReveals != 2 {
		t.Fatalf("Ctrl Shift F should open the dock on search (reveals %d): %v", searchReveals, tt.Texts())
	}
	if s := ws.snapshot(); s.LeftPanel != "search" {
		t.Fatalf("the session keeps the shown panel: %q", s.LeftPanel)
	}
}

func TestOpenWithMatchSelectsIt(t *testing.T) {
	ws, _ := testWorkspace(t)
	tb := ws.open("/m/alpha.md", &workspaceapi.Nav{Line: 2, Col: 7, Len: 5})
	// The read's result comes back through shellapi.Update, which needs a
	// window: hand it over directly.
	ws.loaded(tb, fscontract.File{Text: "# note\nfirst match here"}, nil, nil)
	sels := tb.ed.Selections()
	if len(sels) != 1 {
		t.Fatalf("selections = %v", sels)
	}
	from, to := min(sels[0].Anchor, sels[0].Head), max(sels[0].Anchor, sels[0].Head)
	if got := tb.ed.Buffer.String()[from:to]; got != "match" {
		t.Fatalf("selected %q, want the match", got)
	}
	if !tb.mdSource {
		t.Fatal("a match in markdown is shown in the source")
	}
}

func TestPanelStateRoundTrips(t *testing.T) {
	var got string
	off := slotsapi.RegisterPanel(slotsapi.Panel{ID: "search", Title: "search", Icon: lucide.Search(), Dock: slotsapi.Left,
		View:    func(c *ui.Context, _ slotsapi.PanelProps) { ui.Text(c, "body") },
		State:   func() json.RawMessage { data, _ := json.Marshal(got + "-saved"); return data },
		Restore: func(st json.RawMessage) { got = string(st) },
	})
	t.Cleanup(off)
	ws, _ := testWorkspace(t)
	// A state for a panel not loaded this run is kept as it was.
	ws.restoreLayout(session{PanelStates: map[string]json.RawMessage{"search": json.RawMessage(`"q"`), "gone": json.RawMessage(`1`)}})
	if s := ws.snapshot(); string(s.PanelStates["search"]) != `"q"` {
		t.Fatalf("before the first draw the saved state is kept: %s", s.PanelStates["search"])
	}
	tt := ui.NewTester(ws.view, 1000, 700)
	tt.Frame()
	if got != `"q"` {
		t.Fatalf("Restore got %q", got)
	}
	s := ws.snapshot()
	if string(s.PanelStates["search"]) != `"\"q\"-saved"` || string(s.PanelStates["gone"]) != `1` {
		t.Fatalf("panel states = %s / %s", s.PanelStates["search"], s.PanelStates["gone"])
	}
}
