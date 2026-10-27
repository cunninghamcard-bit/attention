package workspace

import (
	"testing"

	"github.com/egoist/mygo/ui"
	"github.com/smallnest/uix/components/lucide"

	"github.com/cunninghamcard-bit/attention/native/actionsapi"
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
	_, tt := testWorkspace(t)
	l := testLayout
	// The search plugin's command, which owns Ctrl Shift F.
	t.Cleanup(actionsapi.Register(actionsapi.Command{ID: "global-search:open", Keys: "Ctrl Shift F", Main: func() { l.RevealPanel("search") }}))
	if !tt.HasText("tree body") || tt.HasText("search body") {
		t.Fatalf("the left dock should show the first panel: %v", tt.Texts())
	}
	if err := tt.Click("search"); err != nil {
		t.Fatal(err)
	}
	tt.Frame()
	if l.ShownPanel(slotsapi.Left) != "search" || !tt.HasText("search body") {
		t.Fatalf("clicking the header icon should show search: %q %v", l.ShownPanel(slotsapi.Left), tt.Texts())
	}
	press(tt, ui.Cmd, ui.KeyB)
	if l.Open(slotsapi.Left) || tt.HasText("tree body") {
		t.Fatal("Ctrl B should close the left dock")
	}
	press(tt, ui.Cmd|ui.Shift, ui.KeyF)
	if !l.Open(slotsapi.Left) || !tt.HasText("search body") || searchReveals != 2 {
		t.Fatalf("Ctrl Shift F should open the dock on search (reveals %d): %v", searchReveals, tt.Texts())
	}
	if s := l.Snapshot(); s.LeftPanel != "search" {
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

// Regression: a Key set on the IconMenu's element left More options never
// opening; and Split right revealed the tab it duplicates, leaving the new
// group empty.
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
	if gs := ws.groups(); len(gs) != 2 || len(gs[1].tabs) != 1 || gs[1].tabs[0].path != "/m/alpha.md" || ws.activePane() != gs[1] {
		t.Fatalf("Split right should show alpha in a second, focused group: %v", tabs(ws))
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

// Regression: closing a group's last tab from a click during the build
// changed the tree splitView was walking, and it panicked.
func TestClosingAGroupFromItsTabListDoesNotPanic(t *testing.T) {
	ws, tt := testWorkspace(t)
	tt.SetPreferences(ui.Preferences{ReduceMotion: true})
	ws.open("/m/alpha.md", nil)
	ws.openIn("/m/beta.md", nil, true)
	ws.split(vertical)
	testLayout.Toggle(slotsapi.Right)
	tt.Frame()
	if err := tt.Click("Tab list"); err != nil {
		t.Fatal(err)
	}
	if err := tt.Click("Close all"); err != nil {
		t.Fatal(err)
	}
	tt.Frame()
	if len(ws.groups()) != 1 {
		t.Fatalf("Close all should close the group: %d groups", len(ws.groups()))
	}
}
