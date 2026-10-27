package resourcesapi

import (
	"context"
	"errors"
	"testing"
	"time"
)

// stub is a provider whose streams the test drives.
type stub struct {
	opened chan string
	emits  map[string]func(any, error)
	closed chan string
}

func newStub(t *testing.T) (*stub, chan func()) {
	t.Helper()
	posts := make(chan func(), 16)
	t.Cleanup(SetPost(func(f func()) { posts <- f }))
	s := &stub{opened: make(chan string, 4), emits: map[string]func(any, error){}, closed: make(chan string, 4)}
	t.Cleanup(Register(Provider{Protocol: "test", Open: func(ctx context.Context, address string, emit func(any, error)) {
		s.opened <- address
		mu.Lock()
		s.emits[address] = emit
		mu.Unlock()
		<-ctx.Done()
		s.closed <- address
	}}))
	return s, posts
}

func (s *stub) emit(address string, v any, err error) {
	mu.Lock()
	e := s.emits[address]
	mu.Unlock()
	e(v, err)
}

func wait[T any](t *testing.T, c chan T) T {
	t.Helper()
	select {
	case v := <-c:
		return v
	case <-time.After(5 * time.Second):
		t.Fatal("timed out")
	}
	var zero T
	return zero
}

const a = "attention-resource://test/a"

func TestHoldStreamsAndTheLastReleaseCloses(t *testing.T) {
	s, posts := newStub(t)
	r1 := Hold(a)
	r2 := Hold(a)
	if wait(t, s.opened) != a || Get(a).Status != Loading {
		t.Fatalf("held: %+v", Get(a))
	}
	s.emit(a, "one", nil)
	wait(t, posts)()
	if g := Get(a); g.Status != Live || g.Value != "one" || g.Version != 1 {
		t.Fatalf("live: %+v", g)
	}
	s.emit(a, nil, errors.New("gone"))
	wait(t, posts)()
	if g := Get(a); g.Status != Failed || g.Value != "one" || g.Err == nil || g.Version != 1 {
		t.Fatalf("a failure keeps the value: %+v", g)
	}
	r1()
	r1()
	select {
	case <-s.closed:
		t.Fatal("one holder left: the stream stays open")
	case <-time.After(20 * time.Millisecond):
	}
	s.emit(a, "two", nil)
	post := wait(t, posts)
	r2()
	if wait(t, s.closed) != a {
		t.Fatal("the last release closes the stream")
	}
	post() // a frame posted before the release
	if g := Get(a); g.Status != None {
		t.Fatalf("released: %+v", g)
	}
}

func TestAProviderComingLateServesWhatIsHeld(t *testing.T) {
	release := Hold(a)
	defer release()
	if Get(a).Status != None {
		t.Fatal("no provider: None")
	}
	s, _ := newStub(t)
	if wait(t, s.opened) != a || Get(a).Status != Loading {
		t.Fatalf("the provider opens what is held: %+v", Get(a))
	}
}

func TestASecondProviderPanics(t *testing.T) {
	newStub(t)
	defer func() {
		if recover() == nil {
			t.Fatal("a second provider for a protocol does not panic")
		}
	}()
	Register(Provider{Protocol: "test"})
}

func TestProtocol(t *testing.T) {
	for address, want := range map[string]string{
		"attention-resource://file/mount/m/a.md": "file",
		"attention-resource://git":               "git",
		"attention://settings":                   "",
		"/a/b":                                   "",
	} {
		if got := Protocol(address); got != want {
			t.Errorf("Protocol(%q) = %q", address, got)
		}
	}
}
