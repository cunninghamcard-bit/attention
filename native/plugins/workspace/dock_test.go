package workspace

import (
	"encoding/json"
	"testing"

	"github.com/egoist/mygo/ui"
	"github.com/smallnest/uix/components/lucide"

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
	ws, tt := testWorkspace(t)
	testText = "# note\nfirst match here"
	tb := ws.open("/m/alpha.md", &workspaceapi.Nav{Line: 2, Col: 7, Len: 5})
	tt.Frame() // the body starts the read
	testPosts.next(t)
	tt.Frame()
	if tb.kind != "markdown" {
		t.Fatalf("alpha.md opened as %q", tb.kind)
	}
	if got := testMD.Selected(tb.id); got != "match" {
		t.Fatalf("selected %q, want the match", got)
	}
	if !testMD.Source(tb.id) {
		t.Fatal("a match in markdown is shown in the source")
	}
	// Again on the open tab, as a search result click: applied as it draws.
	testMD.Toggle(tb.id)
	if again := ws.open("/m/alpha.md", &workspaceapi.Nav{Line: 1, Col: 3, Len: 4}); again != tb {
		t.Fatal("the open tab is reused")
	}
	tt.Frame()
	if got := testMD.Selected(tb.id); got != "note" || !testMD.Source(tb.id) {
		t.Fatalf("re-navigation selected %q (source %v)", got, testMD.Source(tb.id))
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

// Regression: a Key set on the IconMenu's element left More options never
// opening.
func TestMoreOptionsOpensAndSplits(t *testing.T) {
	ws, tt := testWorkspace(t)
	ws.open("/m/alpha.md", nil)
	tt.SetPreferences(ui.Preferences{ReduceMotion: true})
	tt.Frame()
	if err := tt.Click("More options"); err != nil {
		t.Fatal(err)
	}
	if err := tt.Click("Split right"); err != nil {
		t.Fatalf("More options should list Split right: %v (%v)", err, tt.Texts())
	}
	if len(ws.groups()) != 2 {
		t.Fatalf("Split right should make a second group: %d", len(ws.groups()))
	}
}

// Regression: a Key set on the ribbon button's element left its OnClick
// never running, and the header's Back the same.
func TestRibbonAndBackButtonsRun(t *testing.T) {
	ran := false
	off := slotsapi.RegisterRibbon(slotsapi.RibbonItem{ID: "x", Title: "Do it", Icon: lucide.Folder(), Run: func() { ran = true }})
	t.Cleanup(off)
	ws, tt := testWorkspace(t)
	if err := tt.Click("Do it"); err != nil || !ran {
		t.Fatalf("the ribbon button should run: %v", err)
	}
	ws.open("/m/alpha.md", nil)
	ws.open("/m/beta.md", nil)
	tt.Frame()
	if err := tt.Click("Back"); err != nil {
		t.Fatal(err)
	}
	if got := tabs(ws); len(got) != 1 || got[0] != "markdown:alpha" {
		t.Fatalf("Back should return the tab to alpha: %v", got)
	}
}
