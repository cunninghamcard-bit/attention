package workspace

import (
	"testing"

	"github.com/egoist/mygo/ui"

	fsplugin "github.com/cunninghamcard-bit/attention/native/plugins/fs"
	projectplugin "github.com/cunninghamcard-bit/attention/native/plugins/project"
	"github.com/cunninghamcard-bit/attention/native/plugins/resources"
	"github.com/cunninghamcard-bit/attention/native/plugins/tabtypes"
)

func TestTabsAreClaimedByAddress(t *testing.T) {
	ws, _ := testWorkspace(t)
	md := ws.open("/m/alpha.md", nil)
	if md.kind != "markdown" || md.typeID != "markdown-ui" || md.address != fsplugin.AddressFor("m", "alpha.md") {
		t.Fatalf("alpha.md = %s %s %s", md.kind, md.typeID, md.address)
	}
	if tb := ws.openIn("/m/main.go", nil, true); tb.kind != "text" {
		t.Fatalf("main.go opened as %q", tb.kind)
	}
	if tb := ws.openIn("/m/pic.PNG", nil, true); tb.kind != "image" {
		t.Fatalf("pic.PNG opened as %q", tb.kind)
	}
	if tb := ws.openIn("/elsewhere/x.txt", nil, true); tb.address != fsplugin.AbsoluteAddress("/elsewhere/x.txt") {
		t.Fatalf("a file outside the mounts = %s", tb.address)
	}
	if again := ws.open("/m/alpha.md", nil); again != md || len(ws.activePane().tabs) != 4 {
		t.Fatal("the same (kind, address) focuses its tab")
	}
}

func TestTypesComingAndGoingReclaimTabs(t *testing.T) {
	ws, tt := testWorkspace(t)
	tb := ws.open("/m/alpha.md", nil)
	var closed []int
	off := ws.tabTypes.Register(tabtypes.TabType{ID: "ext-md", Kind: "markdown", Priority: tabtypes.Extension, Patterns: []string{"*.md"},
		Body:   func(c *ui.Context, _ tabtypes.Props) { ui.Text(c, "extension body") },
		Closed: func(id int) { closed = append(closed, id) },
	})
	tt.Frame()
	if tb.typeID != "ext-md" || !tt.HasText("extension body") {
		t.Fatalf("an extension type takes the tab over: %s %v", tb.typeID, tt.Texts())
	}
	off()
	tt.Frame()
	if tb.typeID != "markdown-ui" {
		t.Fatalf("its viewer gone, the tab goes back to the builtin: %s", tb.typeID)
	}
	tb2 := ws.openIn("/m/beta.md", nil, true)
	off = ws.tabTypes.Register(tabtypes.TabType{ID: "ext-md", Kind: "markdown", Priority: tabtypes.Extension, Patterns: []string{"*.md"},
		Body:   func(c *ui.Context, _ tabtypes.Props) {},
		Closed: func(id int) { closed = append(closed, id) },
	})
	defer off()
	tt.Frame()
	ws.closeActiveTab()
	if len(closed) != 2 || closed[0] != tb.id || closed[1] != tb2.id {
		t.Fatalf("a type is told of a tab gone from it, by unloading or closing: %v", closed)
	}
}

func TestAChangeReloadsTheBody(t *testing.T) {
	ws, tt := testWorkspace(t)
	files := fileProvider(t, ws)
	testFiles = map[string]fsplugin.File{"/m/main.go": {Text: "package one"}}
	tb := ws.open("/m/main.go", nil)
	tt.Frame()
	if !tt.HasText("Loading…") {
		t.Fatal("the body waits for the file's first state")
	}
	files.frames.next(t)
	tt.Frame()
	testPosts.next(t)
	tt.Frame()
	if _, lines, ok := ws.lines(tb); !ok || lines != 1 {
		t.Fatalf("first read: %d lines", lines)
	}
	testFiles["/m/main.go"] = fsplugin.File{Text: "package two\n\nfunc f() {}"}
	files.send(tb.address)
	files.frames.next(t)
	tt.Frame()
	testPosts.next(t)
	tt.Frame()
	if _, lines, _ := ws.lines(tb); lines != 3 {
		t.Fatalf("after the change: %d lines", lines)
	}
	testMissing = map[string]bool{"/m/main.go": true}
	files.send(tb.address)
	files.frames.next(t)
	tt.Frame()
	if !tb.isMissing() || !tt.HasText("This file was deleted or moved. The last loaded content is shown.") {
		t.Fatalf("deleted: %v", tt.Texts())
	}
	ws.closeActiveTab()
	if ws.res.Get(tb.address).Status != resources.None {
		t.Fatal("a closed tab no longer holds its address")
	}
}

func TestAFileNeverReadShowsItIsGone(t *testing.T) {
	ws, tt := testWorkspace(t)
	files := fileProvider(t, ws)
	testMissing = map[string]bool{"/m/gone.go": true}
	tb := ws.open("/m/gone.go", nil)
	files.frames.next(t)
	tt.Frame()
	testPosts.next(t)
	tt.Frame()
	if !tb.isMissing() || !tt.HasText("This file does not exist.") || tt.HasText("Loading…") {
		t.Fatalf("missing %v: %v", tb.isMissing(), tt.Texts())
	}
}

func TestAMountMovesTheHoldToTheMountAddress(t *testing.T) {
	ws, _ := testWorkspace(t)
	ws.setMounts(nil)
	tb := ws.open("/m/alpha.md", nil)
	abs := tb.address
	ws.setMounts([]projectplugin.Mount{{ID: "m", Name: "m", Path: "/m"}})
	files := fileProvider(t, ws)
	files.frames.next(t)
	if tb.address == abs || ws.res.Get(abs).Status != resources.None || ws.res.Get(tb.address).Status != resources.Live {
		t.Fatalf("%s held %v, %s held %v", abs, ws.res.Get(abs).Status, tb.address, ws.res.Get(tb.address).Status)
	}
}

func TestOpenResourceAsAKindKeepsTheKind(t *testing.T) {
	ws, tt := testWorkspace(t)
	md := ws.open("/m/alpha.md", nil)
	asText, err := ws.openResource(fsplugin.AddressFor("m", "alpha.md"), OpenOptions{Kind: "text", NewTab: true})
	if err != nil || asText == md || asText.typeID != "text-ui" {
		t.Fatalf("a markdown file opened as text is a tab of its own: %v %v", asText, err)
	}
	ws.tabTypes.Register(tabtypes.TabType{ID: "other", Kind: "other", Patterns: []string{"*.md"}})()
	tt.Frame()
	if asText.kind != "text" || md.kind != "markdown" {
		t.Fatalf("after a reclaim: %s and %s", asText.kind, md.kind)
	}
	if again, _ := ws.openResource(fsplugin.AbsoluteAddress("/m/alpha.md"), OpenOptions{}); again != md {
		t.Fatal("an absolute address under a mount is the mount's address, and its tab")
	}
}

func TestOpenResourceRefusesWhatItCannotOpen(t *testing.T) {
	ws, _ := testWorkspace(t)
	before := len(ws.activePane().tabs)
	for _, c := range []struct{ address, kind string }{
		{"garbage", ""},
		{"attention-resource://git/r/a.md", ""},
		{fsplugin.AddressFor("nope", "a.md"), ""},
		{fsplugin.AddressFor("m", "../etc/passwd"), ""},
		{fsplugin.AddressFor("m", "alpha.md"), "no-such-kind"},
	} {
		if _, err := ws.openResource(c.address, OpenOptions{Kind: c.kind}); err == nil {
			t.Errorf("%s as %q opened", c.address, c.kind)
		}
	}
	if len(ws.activePane().tabs) != before {
		t.Fatal("a refused open made a tab")
	}
}
