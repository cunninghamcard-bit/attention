package workspace

import (
	"testing"

	"github.com/egoist/mygo/ui"

	"github.com/cunninghamcard-bit/attention/native/plugins/actions"
	fsplugin "github.com/cunninghamcard-bit/attention/native/plugins/fs"
	"github.com/cunninghamcard-bit/attention/native/plugins/slots"
	"github.com/cunninghamcard-bit/attention/native/ui/icon"
)

func TestDockShowsFirstPanelAndRevealsByShortcut(t *testing.T) {
	var searchReveals int
	panel(t, "search", 1, "search body", &searchReveals)
	ws, tt := testWorkspace(t)
	l := testLayout
	// The search plugin's command, which owns Ctrl Shift F.
	t.Cleanup(ws.act.Add(actions.Command{ID: "global-search:open", Keys: "Ctrl Shift F", Main: func() { l.RevealPanel("search") }}))
	if l.ShownPanel(slots.Sidebar) != TabsPanelID || tt.HasText("search body") {
		t.Fatalf("the sidebar should show the first panel, the tabs: %q %v", l.ShownPanel(slots.Sidebar), tt.Texts())
	}
	if err := tt.Click("search"); err != nil {
		t.Fatal(err)
	}
	tt.Frame()
	if l.ShownPanel(slots.Sidebar) != "search" || !tt.HasText("search body") {
		t.Fatalf("clicking the header icon should show search: %q %v", l.ShownPanel(slots.Sidebar), tt.Texts())
	}
	press(tt, ui.Cmd, ui.KeyB)
	if l.Open(slots.Sidebar) || tt.HasText("search body") {
		t.Fatal("Ctrl B should close the left dock")
	}
	press(tt, ui.Cmd|ui.Shift, ui.KeyF)
	if !l.Open(slots.Sidebar) || !tt.HasText("search body") || searchReveals != 2 {
		t.Fatalf("Ctrl Shift F should open the dock on search (reveals %d): %v", searchReveals, tt.Texts())
	}
	if s := l.Snapshot(); s.LeftPanel != "search" {
		t.Fatalf("the session keeps the shown panel: %q", s.LeftPanel)
	}
}

func TestOpenWithMatchSelectsIt(t *testing.T) {
	ws, tt := testWorkspace(t)
	testText = "# note\nfirst match here"
	tb := ws.open("/m/alpha.md", &Nav{Line: 2, Col: 7, Len: 5})
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
	if again := ws.open("/m/alpha.md", &Nav{Line: 1, Col: 3, Len: 4}); again != tb {
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

// Regression: a click on a card's editor, which takes the press, left
// the other card focused.
func TestAClickInACardsBodyFocusesIt(t *testing.T) {
	ws, tt := testWorkspace(t)
	files := fileProvider(t, ws)
	testFiles = map[string]fsplugin.File{"/m/main.go": {Text: "package main"}}
	ws.open("/m/main.go", nil)
	tt.SetPreferences(ui.Preferences{ReduceMotion: true})
	tt.Frame()
	files.frames.next(t)
	tt.Frame()
	testPosts.next(t)
	tt.Frame()
	if err := tt.Click("More options"); err != nil {
		t.Fatal(err)
	}
	if err := tt.Click("Split right"); err != nil {
		t.Fatal(err)
	}
	tt.Frame()
	gs := ws.groups()
	b := gs[0].bodyBounds
	tt.ClickAt(b.X+b.W/2, b.Y+b.H/2)
	tt.Frame()
	if ws.activePane() != gs[0] {
		t.Fatalf("a click in the left card's editor should focus it")
	}
}

// Regression: a Key set on the header's Back button left its OnClick
// never running.
func TestBackButtonRuns(t *testing.T) {
	ws, tt := testWorkspace(t)
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

// Regression: closing a tab from a click during the build changed the
// tree splitView was walking, and it panicked.
func TestClosingATabFromItsRowDoesNotPanic(t *testing.T) {
	ws, tt := testWorkspace(t)
	tt.SetPreferences(ui.Preferences{ReduceMotion: true})
	ws.open("/m/alpha.md", nil)
	ws.openIn("/m/beta.md", nil, true)
	ws.split(vertical)
	tt.Frame()
	if err := tt.Click("Close alpha.md"); err != nil {
		t.Fatal(err)
	}
	tt.Frame()
	if got := tabs(ws); len(got) != 2 || len(ws.groups()) != 2 {
		t.Fatalf("the split of beta should be left, shown: %v, %d cards", got, len(ws.groups()))
	}
}

// panel registers a left panel drawing body, counting its reveals.
func panel(t *testing.T, id string, order int, body string, reveals *int) {
	t.Helper()
	off := ensureSlots(t).RegisterPanel(slots.Panel{ID: id, Title: id, Icon: icon.Must("folder"), Dock: slots.Sidebar, Order: order,
		View: func(c *ui.Context, p slots.PanelProps) {
			if reveals != nil {
				*reveals = p.Reveal
			}
			ui.Text(c, body)
		}})
	t.Cleanup(off)
}
