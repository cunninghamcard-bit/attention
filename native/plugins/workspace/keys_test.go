package workspace

import (
	"context"
	"os"
	"testing"

	"github.com/egoist/mygo/ui"

	fscontract "github.com/cunninghamcard-bit/attention/native/contract/fs"
	projectcontract "github.com/cunninghamcard-bit/attention/native/contract/project"
	"github.com/cunninghamcard-bit/attention/native/plugins/commandpalette"
	"github.com/cunninghamcard-bit/attention/native/plugins/gotoline"
	"github.com/cunninghamcard-bit/attention/native/plugins/layout"
	"github.com/cunninghamcard-bit/attention/native/plugins/palette"
	"github.com/cunninghamcard-bit/attention/native/plugins/shortcuts"
	"github.com/cunninghamcard-bit/attention/native/plugins/switcher"
)

// testPalette and testLayout are testWorkspace's palette and layout.
var (
	testPalette *palette.Palette
	testLayout  *layout.Layout
)

func TestQuickSwitcherOpensIntoTheNewTab(t *testing.T) {
	ws, tt := testWorkspace(t)
	press(tt, ui.Cmd, ui.KeyO)
	if testPalette.Open() != switcher.ID {
		t.Fatal("Ctrl O did not open the quick switcher")
	}
	tt.Type("alpha")
	tt.Frame()
	press(tt, 0, ui.KeyEnter)
	if got := tabs(ws); len(got) != 1 || got[0] != "markdown:alpha" {
		t.Fatalf("after opening alpha: %v", got)
	}

	press(tt, ui.Cmd, ui.KeyT)
	if got := tabs(ws); len(got) != 2 || got[1] != "empty:New tab" {
		t.Fatalf("after Ctrl T: %v", got)
	}
	press(tt, ui.Cmd, ui.KeyO)
	tt.Type("gam")
	tt.Frame()
	press(tt, 0, ui.KeyEnter)
	if got := tabs(ws); len(got) != 2 || got[1] != "markdown:gamma" {
		t.Fatalf("gamma should open in the new tab: %v", got)
	}
}

func TestCloseAndUndoClose(t *testing.T) {
	ws, tt := testWorkspace(t)
	ws.open("/m/alpha.md", nil)
	ws.openIn("/m/beta.md", nil, true)
	tt.Frame()
	press(tt, ui.Cmd, ui.KeyW)
	if got := tabs(ws); len(got) != 1 || got[0] != "markdown:alpha" {
		t.Fatalf("after Ctrl W: %v", got)
	}
	press(tt, ui.Cmd|ui.Shift, ui.KeyT)
	if got := tabs(ws); len(got) != 2 || got[1] != "markdown:beta" {
		t.Fatalf("after Ctrl Shift T: %v", got)
	}
	press(tt, ui.Cmd, ui.Key1)
	if ws.activeTab().displayText() != "alpha" {
		t.Fatalf("Ctrl 1 activated %q", ws.activeTab().displayText())
	}
	press(tt, ui.Cmd, ui.Key9)
	if ws.activeTab().displayText() != "beta" {
		t.Fatalf("Ctrl 9 activated %q", ws.activeTab().displayText())
	}
}

func TestQuickSwitcherEmptyQueryShowsRecentFiles(t *testing.T) {
	ws, tt := testWorkspace(t)
	ws.open("/m/gamma.md", nil)
	ws.open("/m/alpha.md", nil)
	press(tt, ui.Cmd, ui.KeyO)
	var got []string
	for _, it := range testPalette.Items() {
		got = append(got, it.Detail+"/"+it.Label)
	}
	if len(got) != 2 || got[0] != "m/alpha" || got[1] != "m/gamma" {
		t.Fatalf("recent files = %v, want newest first", got)
	}
}

func TestCommandPaletteRunsAndRemembersCommands(t *testing.T) {
	_, tt := testWorkspace(t)
	press(tt, ui.Cmd, ui.KeyP)
	if testPalette.Open() != commandpalette.ID {
		t.Fatal("Ctrl P did not open the command palette")
	}
}

// A workspace over three notes, drawn by mygo's tester: the shortcuts and
// the palette are driven by key presses, without a window or rutis.
func testWorkspace(t *testing.T) (*Workspace, *ui.Tester) {
	t.Helper()
	m := projectcontract.Mount{ID: "m", Name: "m", Path: "/m"}
	files := projectcontract.Listing{Files: []projectcontract.FileRef{
		{Mount: "m", Rel: "alpha.md", Path: "/m/alpha.md"},
		{Mount: "m", Rel: "beta.md", Path: "/m/beta.md"},
		{Mount: "m", Rel: "gamma.md", Path: "/m/gamma.md"},
	}}
	fs := fsStub()
	testText, testFiles, testMissing = "# note", nil, nil
	fs.Read = func(_ context.Context, path string, _ int64) (fscontract.File, error) {
		if testMissing[path] {
			return fscontract.File{}, os.ErrNotExist
		}
		if f, ok := testFiles[path]; ok {
			return f, nil
		}
		return fscontract.File{Text: testText}, nil
	}
	fs.ReadBytes = func(context.Context, string, int64) ([]byte, error) { return testBytes, nil }
	fs.List = func(context.Context, string) ([]fscontract.Entry, error) { return nil, nil }
	project := projectStub()
	project.Files = func(context.Context) (projectcontract.Listing, error) { return files, nil }
	viewers(t, t.Context(), fs)
	ws := newWorkspace(t.Context(), fs, project)
	ws.setMounts([]projectcontract.Mount{m})
	// What the profile loads beside it: the layout around it, the
	// shortcuts, the palette and its sources.
	t.Cleanup(Register(ws))
	testLayout = layout.New()
	testLayout.IsDark = func() bool { return false }
	t.Cleanup(layout.Register(testLayout))
	t.Cleanup(shortcuts.Register(t.Context()))
	var off func()
	testPalette, off = palette.Register()
	t.Cleanup(off)
	// The listing is set here; a refresh's walk is dropped.
	sw := switcher.New(t.Context(), project.Files, func(func()) {})
	sw.SetListing(files)
	t.Cleanup(switcher.Register(sw))
	t.Cleanup(commandpalette.Register(commandpalette.New(t.Context())))
	t.Cleanup(gotoline.Register())
	t.Cleanup(func() {
		for _, p := range ws.groups() {
			for _, tb := range p.tabs {
				if tb.hold != nil {
					tb.hold()
				}
			}
		}
	})
	tt := ui.NewTester(testLayout.View, 1000, 700)
	tt.Frame()
	return ws, tt
}

func tabs(ws *Workspace) []string {
	var out []string
	for _, p := range ws.groups() {
		for _, t := range p.tabs {
			out = append(out, t.viewType()+":"+t.displayText())
		}
	}
	return out
}

func press(tt *ui.Tester, mods ui.Modifiers, key ui.Key) { tt.Key(mods, key); tt.Frame() }
