// Package resourcesapi is the in-process resource registry (RFC 0001 §5.6
// "resources"; dsh's ResourceRegistry, ui-resources): a provider per
// protocol turns an address into a live snapshot, and whoever holds an
// address keeps its stream open. A tab holds its address for its life.
//
// Departure from the RFC: an in-process package like tabtypesapi, not a
// rutis service; there is no consumer in another process yet.
//
// Hold, Get and the snapshots are read on the main thread; providers run
// on goroutines and their frames come back through Post.
package resourcesapi

import (
	"context"
	"strconv"
	"strings"
	"sync"

	"github.com/cunninghamcard-bit/attention/native/shellapi"
)

// Status is where an address's stream is.
type Status int

const (
	None    Status = iota // not held, or no provider for its protocol
	Loading               // held, no frame yet
	Live                  // the last frame was a value
	Failed                // the last frame was an error
)

// Snapshot is an address's state. Value is the last Live value and is kept
// through a failure (dsh: ok:false keeps the previous value); Version
// bumps on every Live frame.
type Snapshot struct {
	Status  Status
	Value   any
	Err     error
	Version int
}

// Provider serves a protocol: Open streams address's frames through emit
// until ctx is done, then returns. It runs on its own goroutine; emit may
// be called from any goroutine, a value and a nil error for Live, an error
// for Failed.
type Provider struct {
	Protocol string
	Open     func(ctx context.Context, address string, emit func(value any, err error))
}

type record struct {
	holds  int
	snap   Snapshot
	cancel context.CancelFunc
	stream int // the open stream's id; frames of an earlier one are dropped
}

var (
	mu        sync.Mutex
	post      = shellapi.Update
	streams   int
	providers = map[string]Provider{}
	records   = map[string]*record{}
)

// SetPost replaces how frames reach the main thread (tests); restore puts
// the previous one back.
func SetPost(p func(func())) (restore func()) {
	mu.Lock()
	old := post
	post = p
	mu.Unlock()
	return func() {
		mu.Lock()
		post = old
		mu.Unlock()
	}
}

// Protocol is an address's protocol: "file" in
// "attention-resource://file/…", "" for no resource address.
func Protocol(address string) string {
	rest, ok := strings.CutPrefix(address, "attention-resource://")
	if !ok {
		return ""
	}
	p, _, _ := strings.Cut(rest, "/")
	return p
}

// Register serves a protocol until off is called; the addresses held for
// it start streaming. A second provider for a protocol panics.
func Register(p Provider) (off func()) {
	mu.Lock()
	if _, ok := providers[p.Protocol]; ok {
		mu.Unlock()
		panic("resources: protocol " + strconv.Quote(p.Protocol) + " is already served")
	}
	providers[p.Protocol] = p
	for address, r := range records {
		if Protocol(address) == p.Protocol {
			start(address, r, p)
		}
	}
	mu.Unlock()
	invalidate()
	var once sync.Once
	return func() {
		once.Do(func() {
			mu.Lock()
			delete(providers, p.Protocol)
			for address, r := range records {
				if Protocol(address) == p.Protocol {
					stop(r)
					r.snap = Snapshot{Version: r.snap.Version}
				}
			}
			mu.Unlock()
			invalidate()
		})
	}
}

// Hold keeps address's stream open until release is called; the first
// hold opens it, the last release closes it and forgets the snapshot.
func Hold(address string) (release func()) {
	mu.Lock()
	r := records[address]
	if r == nil {
		r = &record{}
		records[address] = r
		if p, ok := providers[Protocol(address)]; ok {
			start(address, r, p)
		}
	}
	r.holds++
	mu.Unlock()
	var once sync.Once
	return func() {
		once.Do(func() {
			mu.Lock()
			r.holds--
			if r.holds == 0 {
				stop(r)
				delete(records, address)
			}
			mu.Unlock()
		})
	}
}

// Get is address's snapshot; None when it is not held.
func Get(address string) Snapshot {
	mu.Lock()
	defer mu.Unlock()
	if r := records[address]; r != nil {
		return r.snap
	}
	return Snapshot{}
}

// start opens r's stream. Called with mu held.
func start(address string, r *record, p Provider) {
	streams++
	id := streams
	ctx, cancel := context.WithCancel(context.Background())
	r.cancel, r.stream = cancel, id
	r.snap = Snapshot{Status: Loading, Version: r.snap.Version} // Version never goes back
	send := post
	emit := func(value any, err error) {
		if ctx.Err() != nil {
			return
		}
		send(func() {
			mu.Lock()
			// The stream may have closed while this frame was posted.
			if records[address] != r || r.stream != id {
				mu.Unlock()
				return
			}
			if err != nil {
				r.snap.Status, r.snap.Err = Failed, err
			} else {
				r.snap.Status, r.snap.Value, r.snap.Err = Live, value, nil
				r.snap.Version++
			}
			mu.Unlock()
			invalidate()
		})
	}
	go p.Open(ctx, address, emit)
}

// stop closes r's stream. Called with mu held.
func stop(r *record) {
	if r.cancel != nil {
		r.cancel()
		r.cancel = nil
	}
	r.stream = 0
}

func invalidate() {
	if w := shellapi.Window(); w != nil {
		w.Invalidate()
	}
}
