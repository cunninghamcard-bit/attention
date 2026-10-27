package workspace

import (
	"context"
	"testing"
	"time"

	fscontract "github.com/cunninghamcard-bit/attention/native/contract/fs"
	projectcontract "github.com/cunninghamcard-bit/attention/native/contract/project"
	"github.com/cunninghamcard-bit/attention/native/plugins/imageui"
	"github.com/cunninghamcard-bit/attention/native/plugins/markdownui"
	"github.com/cunninghamcard-bit/attention/native/plugins/textui"
)

func fsStub() fscontract.FS {
	return fscontract.FS{
		Watch:   func(context.Context, string) error { return nil },
		Unwatch: func(context.Context, string) error { return nil },
	}
}

func projectStub() projectcontract.Project { return projectcontract.Project{} }

// posts collects the viewers' main-thread posts: without a window,
// shellapi.Update would hold them until one opens.
type posts chan func()

func (p posts) post(fn func()) { p <- fn }

// next runs the next post, waiting for the read that sends it.
func (p posts) next(t *testing.T) {
	t.Helper()
	select {
	case fn := <-p:
		fn()
	case <-time.After(5 * time.Second):
		t.Fatal("no post arrived")
	}
}

var (
	testText    string                     // what the stub fs reads
	testFiles   map[string]fscontract.File // and for these paths
	testMissing map[string]bool            // which it finds gone
	testBytes   []byte                     // what it reads as bytes
	testPosts   posts
	testMD      *markdownui.Viewer
)

// viewers registers the reader's tab types for the test.
func viewers(t *testing.T, ctx context.Context, fs fscontract.FS) {
	t.Helper()
	testPosts = make(posts, 64)
	t.Cleanup(textui.Register(ctx, fs, testPosts.post))
	var off func()
	testMD, off = markdownui.Register(ctx, fs, testPosts.post)
	t.Cleanup(off)
	t.Cleanup(imageui.Register(ctx, fs, testPosts.post))
}
