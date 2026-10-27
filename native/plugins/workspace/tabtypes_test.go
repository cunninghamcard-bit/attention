package workspace

import (
	"testing"

	"github.com/egoist/mygo/ui"

	fscontract "github.com/cunninghamcard-bit/attention/native/contract/fs"
	projectcontract "github.com/cunninghamcard-bit/attention/native/contract/project"
	"github.com/cunninghamcard-bit/attention/native/resourcesapi"
	"github.com/cunninghamcard-bit/attention/native/tabtypesapi"
	"github.com/cunninghamcard-bit/attention/native/workspaceapi"
)

func TestTabsAreClaimedByAddress(t *testing.T) {
	ws, _ := testWorkspace(t)
	md := ws.open("/m/alpha.md", nil)
	if md.kind != "markdown" || md.typeID != "markdown-ui" || md.address != fscontract.AddressFor("m", "alpha.md") {
		t.Fatalf("alpha.md = %s %s %s", md.kind, md.typeID, md.address)
	}
	if tb := ws.openIn("/m/main.go", nil, true); tb.kind != "text" {
		t.Fatalf("main.go opened as %q", tb.kind)
	}
	if tb := ws.openIn("/m/pic.PNG", nil, true); tb.kind != "image" {
		t.Fatalf("pic.PNG opened as %q", tb.kind)
	}
	if tb := ws.openIn("/elsewhere/x.txt", nil, true); tb.address != fscontract.AbsoluteAddress("/elsewhere/x.txt") {
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
	off := tabtypesapi.Register(tabtypesapi.TabType{ID: "ext-md", Kind: "markdown", Priority: tabtypesapi.Extension, Patterns: []string{"*.md"},
		Body:   func(c *ui.Context, _ tabtypesapi.Props) { ui.Text(c, "extension body") },
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
	off = tabtypesapi.Register(tabtypesapi.TabType{ID: "ext-md", Kind: "markdown", Priority: tabtypesapi.Extension, Patterns: []string{"*.md"},
		Body:   func(c *ui.Context, _ tabtypesapi.Props) {},
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
	files := fileProvider(t)
	testFiles = map[string]fscontract.File{"/m/main.go": {Text: "package one"}}
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
	testFiles["/m/main.go"] = fscontract.File{Text: "package two\n\nfunc f() {}"}
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
	if resourcesapi.Get(tb.address).Status != resourcesapi.None {
		t.Fatal("a closed tab no longer holds its address")
	}
}

func TestAFileNeverReadShowsItIsGone(t *testing.T) {
	ws, tt := testWorkspace(t)
	files := fileProvider(t)
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
	ws.setMounts([]projectcontract.Mount{{ID: "m", Name: "m", Path: "/m"}})
	files := fileProvider(t)
	files.frames.next(t)
	if tb.address == abs || resourcesapi.Get(abs).Status != resourcesapi.None || resourcesapi.Get(tb.address).Status != resourcesapi.Live {
		t.Fatalf("%s held %v, %s held %v", abs, resourcesapi.Get(abs).Status, tb.address, resourcesapi.Get(tb.address).Status)
	}
}

func TestOpenResourceAsAKindKeepsTheKind(t *testing.T) {
	ws, tt := testWorkspace(t)
	md := ws.open("/m/alpha.md", nil)
	asText, err := ws.openResource(fscontract.AddressFor("m", "alpha.md"), workspaceapi.OpenOptions{Kind: "text", NewTab: true})
	if err != nil || asText == md || asText.typeID != "text-ui" {
		t.Fatalf("a markdown file opened as text is a tab of its own: %v %v", asText, err)
	}
	tabtypesapi.Register(tabtypesapi.TabType{ID: "other", Kind: "other", Patterns: []string{"*.md"}})()
	tt.Frame()
	if asText.kind != "text" || md.kind != "markdown" {
		t.Fatalf("after a reclaim: %s and %s", asText.kind, md.kind)
	}
	if again, _ := ws.openResource(fscontract.AbsoluteAddress("/m/alpha.md"), workspaceapi.OpenOptions{}); again != md {
		t.Fatal("an absolute address under a mount is the mount's address, and its tab")
	}
}

func TestOpenResourceRefusesWhatItCannotOpen(t *testing.T) {
	ws, _ := testWorkspace(t)
	before := len(ws.activePane().tabs)
	for _, c := range []struct{ address, kind string }{
		{"garbage", ""},
		{"attention-resource://git/r/a.md", ""},
		{fscontract.AddressFor("nope", "a.md"), ""},
		{fscontract.AddressFor("m", "../etc/passwd"), ""},
		{fscontract.AddressFor("m", "alpha.md"), "no-such-kind"},
	} {
		if _, err := ws.openResource(c.address, workspaceapi.OpenOptions{Kind: c.kind}); err == nil {
			t.Errorf("%s as %q opened", c.address, c.kind)
		}
	}
	if len(ws.activePane().tabs) != before {
		t.Fatal("a refused open made a tab")
	}
}
