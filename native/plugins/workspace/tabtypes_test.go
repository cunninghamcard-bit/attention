package workspace

import (
	"testing"

	"github.com/egoist/mygo/ui"

	fscontract "github.com/cunninghamcard-bit/attention/native/contract/fs"
	"github.com/cunninghamcard-bit/attention/native/tabtypesapi"
)

func TestTabsAreClaimedByAddress(t *testing.T) {
	ws, _ := testWorkspace(t)
	md := ws.open("/m/alpha.md", nil)
	if md.kind != "markdown" || md.typeID != "markdown-ui" || md.address != fscontract.AddressFor("m", "alpha.md") {
		t.Fatalf("alpha.md = %s %s %s", md.kind, md.typeID, md.address)
	}
	if tb := ws.open("/m/main.go", nil); tb.kind != "text" {
		t.Fatalf("main.go opened as %q", tb.kind)
	}
	if tb := ws.open("/m/pic.PNG", nil); tb.kind != "image" {
		t.Fatalf("pic.PNG opened as %q", tb.kind)
	}
	if tb := ws.open("/elsewhere/x.txt", nil); tb.address != fscontract.AbsoluteAddress("/elsewhere/x.txt") {
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
	tb2 := ws.open("/m/beta.md", nil)
	off = tabtypesapi.Register(tabtypesapi.TabType{ID: "ext-md", Kind: "markdown", Priority: tabtypesapi.Extension, Patterns: []string{"*.md"},
		Body:   func(c *ui.Context, _ tabtypesapi.Props) {},
		Closed: func(id int) { closed = append(closed, id) },
	})
	defer off()
	tt.Frame()
	ws.closeActiveTab()
	if len(closed) != 1 || closed[0] != tb2.id {
		t.Fatalf("closing a tab tells its type: %v", closed)
	}
}

func TestAChangeReloadsTheBody(t *testing.T) {
	ws, tt := testWorkspace(t)
	testFiles = map[string]fscontract.File{"/m/main.go": {Text: "package one"}}
	tb := ws.open("/m/main.go", nil)
	tt.Frame()
	testPosts.next(t)
	tt.Frame()
	if _, lines, ok := ws.lines(tb); !ok || lines != 1 {
		t.Fatalf("first read: %d lines", lines)
	}
	testFiles["/m/main.go"] = fscontract.File{Text: "package two\n\nfunc f() {}"}
	ws.applyBatch(fscontract.Batch{Changes: []fscontract.Change{{Path: "/m/main.go", Op: "write"}}})
	tt.Frame()
	testPosts.next(t)
	tt.Frame()
	if _, lines, _ := ws.lines(tb); lines != 3 {
		t.Fatalf("after the change: %d lines", lines)
	}
}
