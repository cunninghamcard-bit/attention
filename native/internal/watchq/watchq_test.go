package watchq

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	fsplugin "github.com/cunninghamcard-bit/attention/native/plugins/fs"
)

func TestCountsOneWatchPerDirectory(t *testing.T) {
	q, f, m, _ := setup(t)
	q.Watch("/a")
	q.Watch("/a")
	q.Unwatch("/a")
	m.pump()
	if got := f.holding(); got["/a"] != 1 {
		t.Fatalf("held = %v", got)
	}
	q.Unwatch("/a")
	m.pump()
	if got := f.holding(); len(got) != 0 {
		t.Fatalf("held after the last unwatch = %v", got)
	}
}

func TestRefusedWatchRetriesOnTheNextWatch(t *testing.T) {
	q, f, m, fails := setup(t)
	f.refuse = true
	q.Watch("/a")
	m.pump()
	if len(*fails) != 1 || q.Watching("/a") {
		t.Fatalf("fails = %v, watching = %v", *fails, q.Watching("/a"))
	}
	// Another tab in the same directory: counted, and the add is retried.
	f.mu.Lock()
	f.refuse = false
	f.mu.Unlock()
	q.Watch("/a")
	m.pump()
	if !q.Watching("/a") || f.holding()["/a"] != 1 {
		t.Fatalf("the retry should hold one watch: %v", f.holding())
	}
	q.Unwatch("/a")
	q.Unwatch("/a")
	m.pump()
	if got := f.holding(); len(got) != 0 {
		t.Fatalf("held = %v", got)
	}
}

func TestRefusedWatchGivenBackSendsNothing(t *testing.T) {
	q, f, m, _ := setup(t)
	f.refuse = true
	q.Watch("/a")
	m.pump()
	q.Unwatch("/a")
	m.pump()
	f.mu.Lock()
	defer f.mu.Unlock()
	if len(f.calls) != 1 {
		t.Fatalf("calls = %v, want the refused watch only", f.calls)
	}
}

func TestStaleFailureDoesNotMarkANewerWatch(t *testing.T) {
	q, f, m, _ := setup(t)
	f.refuse = true
	q.Watch("/a")
	// Wait for fs to refuse it, but do not run the failure's post yet.
	deadline := time.Now().Add(time.Second)
	for {
		f.mu.Lock()
		n := len(f.calls)
		f.mu.Unlock()
		if n == 1 || time.Now().After(deadline) {
			break
		}
		time.Sleep(time.Millisecond)
	}
	f.mu.Lock()
	f.refuse = false
	f.mu.Unlock()
	q.Unwatch("/a") // sends an unwatch fs ignores (held goes -1, then back)
	q.Watch("/a")   // a newer add, which succeeds
	m.pump()
	if !q.Watching("/a") {
		t.Fatal("the old failure marked the newer watch as failed")
	}
}

func TestCloseGivesBackEveryWatch(t *testing.T) {
	q, f, m, _ := setup(t)
	q.Watch("/a")
	q.Watch("/b")
	q.Watch("/b")
	m.pump()
	closed := make(chan struct{})
	go func() { q.Close(); close(closed) }()
	m.pump()
	<-closed
	if got := f.holding(); len(got) != 0 {
		t.Fatalf("held after Close = %v", got)
	}
	q.Watch("/c")
	if q.Watching("/c") {
		t.Fatal("Watch after Close should do nothing")
	}
}

// fakeFS records the calls and refuses watches while refuse is set.
type fakeFS struct {
	mu     sync.Mutex
	calls  []string
	held   map[string]int
	refuse bool
}

func setup(t *testing.T) (*Queue, *fakeFS, *main, *[]string) {
	f := &fakeFS{held: map[string]int{}}
	m := &main{fns: make(chan func(), 64)}
	var fails []string
	q := New(t.Context(), f.contract(), m.post, func(dir, _ string) { fails = append(fails, dir) })
	return q, f, m, &fails
}

func (f *fakeFS) contract() fsplugin.FS {
	return fsplugin.FS{
		Watch: func(_ context.Context, dir string) error {
			f.mu.Lock()
			defer f.mu.Unlock()
			f.calls = append(f.calls, "watch "+dir)
			if f.refuse {
				return errors.New("no space")
			}
			f.held[dir]++
			return nil
		},
		Unwatch: func(_ context.Context, dir string) error {
			f.mu.Lock()
			defer f.mu.Unlock()
			f.calls = append(f.calls, "unwatch "+dir)
			f.held[dir]--
			return nil
		},
	}
}

func (f *fakeFS) holding() map[string]int {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := map[string]int{}
	for k, v := range f.held {
		if v != 0 {
			out[k] = v
		}
	}
	return out
}

// main is the test's main thread: posts queue here and pump runs them.
type main struct{ fns chan func() }

func (m *main) post(fn func()) { m.fns <- fn }

// pump runs posts until none arrives for a while.
func (m *main) pump() {
	for {
		select {
		case fn := <-m.fns:
			fn()
		case <-time.After(50 * time.Millisecond):
			return
		}
	}
}
