package workspace

import (
	"context"
	"os"
	"sync"
	"testing"
	"time"

	fscontract "github.com/cunninghamcard-bit/attention/native/contract/fs"
	projectcontract "github.com/cunninghamcard-bit/attention/native/contract/project"
	"github.com/cunninghamcard-bit/attention/native/plugins/imageui"
	"github.com/cunninghamcard-bit/attention/native/plugins/markdownui"
	"github.com/cunninghamcard-bit/attention/native/plugins/textui"
	"github.com/cunninghamcard-bit/attention/native/resourcesapi"
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

// fileStub serves the file protocol for a test: an address's first frame
// is its file, or gone when testMissing has its path; send sends another.
// Its frames come through frames.
type fileStub struct {
	mu     sync.Mutex
	emits  map[string]func(any, error)
	frames posts
}

func fileProvider(t *testing.T) *fileStub {
	t.Helper()
	f := &fileStub{emits: map[string]func(any, error){}, frames: make(posts, 64)}
	t.Cleanup(resourcesapi.SetPost(f.frames.post))
	t.Cleanup(resourcesapi.Register(resourcesapi.Provider{Protocol: "file",
		Open: func(ctx context.Context, address string, emit func(any, error)) {
			f.mu.Lock()
			f.emits[address] = emit
			f.mu.Unlock()
			f.send(address)
			<-ctx.Done()
		}}))
	return f
}

// send emits address's file as testMissing has it.
func (f *fileStub) send(address string) {
	f.mu.Lock()
	emit := f.emits[address]
	f.mu.Unlock()
	a, _ := fscontract.ParseAddress(address)
	if testMissing["/m/"+a.Rel] {
		emit(nil, os.ErrNotExist)
		return
	}
	emit(fscontract.Entry{Path: "/m/" + a.Rel}, nil)
}
