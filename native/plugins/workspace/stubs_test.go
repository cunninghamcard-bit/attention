package workspace

import (
	"context"
	"os"
	"sync"
	"testing"
	"time"

	fsplugin "github.com/cunninghamcard-bit/attention/native/plugins/fs"
	"github.com/cunninghamcard-bit/attention/native/plugins/imageui"
	"github.com/cunninghamcard-bit/attention/native/plugins/markdownui"
	projectplugin "github.com/cunninghamcard-bit/attention/native/plugins/project"
	"github.com/cunninghamcard-bit/attention/native/plugins/resources"
	"github.com/cunninghamcard-bit/attention/native/plugins/textui"
)

var (
	testText    string                   // what the stub fs reads
	testFiles   map[string]fsplugin.File // and for these paths
	testMissing map[string]bool          // which it finds gone
	testBytes   []byte                   // what it reads as bytes
	testPosts   posts
	testMD      *markdownui.Viewer
)

// posts collects the viewers' main-thread posts: without a window,
// shell.Shell.Update would hold them until one opens.
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

// fileStub serves the file protocol for a test: an address's first frame
// is its file, or gone when testMissing has its path; send sends another.
// Its frames come through frames.
type fileStub struct {
	mu     sync.Mutex
	emits  map[string]func(any, error)
	frames posts
}

func fileProvider(t *testing.T, ws *Workspace) *fileStub {
	t.Helper()
	f := &fileStub{emits: map[string]func(any, error){}, frames: make(posts, 64)}
	t.Cleanup(ws.res.SetPost(f.frames.post))
	t.Cleanup(ws.res.Register(resources.Provider{Protocol: "file",
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
	a, _ := fsplugin.ParseAddress(address)
	if testMissing["/m/"+a.Rel] {
		emit(nil, os.ErrNotExist)
		return
	}
	emit(fsplugin.Entry{Path: "/m/" + a.Rel}, nil)
}

// lines is t's caret line and line count, from its tab type.
func (ws *Workspace) lines(t *tab) (cur, lines int, ok bool) {
	if t == nil || t.empty {
		return 0, 0, false
	}
	tt, found := ws.tabTypes.Get(t.typeID)
	if !found || tt.Lines == nil {
		return 0, 0, false
	}
	return tt.Lines(t.id)
}

func fsStub() fsplugin.FS {
	return fsplugin.FS{
		Watch:   func(context.Context, string) error { return nil },
		Unwatch: func(context.Context, string) error { return nil },
	}
}

func projectStub() projectplugin.Project { return projectplugin.Project{} }

// viewers registers the reader's tab types for the test.
func viewers(t *testing.T, ctx context.Context, ws *Workspace, fs fsplugin.FS) {
	t.Helper()
	testPosts = make(posts, 64)
	t.Cleanup(textui.Register(ctx, fs, ws.tabTypes, testPosts.post))
	var off func()
	testMD, off = markdownui.Register(ctx, fs, ws.sh, ws.act, ws.tabTypes, ws, testPosts.post)
	t.Cleanup(off)
	t.Cleanup(imageui.Register(ctx, fs, ws.tabTypes, testPosts.post))
}
