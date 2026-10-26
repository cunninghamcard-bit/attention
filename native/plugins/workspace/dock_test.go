package workspace

import (
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
	press(tt, ui.Cmd, ui.KeyB)
	if ws.panelOpen || tt.HasText("tree body") {
		t.Fatal("Ctrl B should close the left dock")
	}
	press(tt, ui.Cmd|ui.Shift, ui.KeyF)
	if !ws.panelOpen || !tt.HasText("search body") || searchReveals != 1 {
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
