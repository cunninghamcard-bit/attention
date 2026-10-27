package filetree

import (
	"context"
	"testing"
	"time"

	fscontract "github.com/cunninghamcard-bit/attention/native/contract/fs"
	projectcontract "github.com/cunninghamcard-bit/attention/native/contract/project"
)

func TestStateAfterToggle(t *testing.T) {
	tr, p := testTree(t, listingsAB())
	tr.setMounts(mountA())
	p.next(t)
	tr.toggleDir("/a/z")
	p.next(t)
	tr.toggleDir("/a/b")
	p.next(t)
	if got := string(tr.state()); got != `{"expanded":["/a","/a/b","/a/z"]}` {
		t.Fatalf("state = %s", got)
	}
}

func TestRestoreThenSetMountsExpands(t *testing.T) {
	tr, p := testTree(t, listingsAB())
	tr.restore([]byte(`{"expanded":["/a","/a/b","/a/gone"]}`))
	if got := string(tr.state()); got != `{"expanded":["/a","/a/b","/a/gone"]}` {
		t.Fatalf("state before mounts = %s", got)
	}
	tr.setMounts(mountA())
	p.next(t) // /a listed; /a/b becomes known and loadDir runs
	p.next(t) // /a/b listed
	if d := tr.dirs["/a"]; d == nil || !d.expanded || !d.loaded {
		t.Fatalf("mount: %+v", d)
	}
	if d := tr.dirs["/a/b"]; d == nil || !d.expanded || !d.loaded {
		t.Fatalf("restored nested: %+v", d)
	}
	if _, ok := tr.dirs["/a/gone"]; ok {
		t.Fatal("a path that never appeared is not created")
	}
	if got := string(tr.state()); got != `{"expanded":["/a","/a/b"]}` {
		t.Fatalf("a restored path its parent's listing lacks is forgotten: %s", got)
	}
	if d := tr.dirs["/a/z"]; d != nil && d.expanded {
		t.Fatal("a directory that was not restored stays collapsed")
	}
}

type posts chan func()

func testTree(t *testing.T, listings map[string][]fscontract.Entry) (*Tree, posts) {
	t.Helper()
	p := make(posts, 64)
	fs := fscontract.FS{
		List: func(_ context.Context, dir string) ([]fscontract.Entry, error) {
			return listings[dir], nil
		},
		Watch:   func(context.Context, string) error { return nil },
		Unwatch: func(context.Context, string) error { return nil },
	}
	return newTree(t.Context(), fs, p.post), p
}

func (p posts) post(fn func()) { p <- fn }

func (p posts) next(t *testing.T) {
	t.Helper()
	select {
	case fn := <-p:
		fn()
	case <-time.After(5 * time.Second):
		t.Fatal("no post arrived")
	}
}

func mountA() []projectcontract.Mount {
	return []projectcontract.Mount{{ID: "a", Name: "a", Path: "/a"}}
}

func listingsAB() map[string][]fscontract.Entry {
	return map[string][]fscontract.Entry{
		"/a": {
			{Name: "b", Path: "/a/b", Dir: true},
			{Name: "z", Path: "/a/z", Dir: true},
			{Name: "f.md", Path: "/a/f.md"},
		},
		"/a/b": {
			{Name: "c.md", Path: "/a/b/c.md"},
		},
	}
}
