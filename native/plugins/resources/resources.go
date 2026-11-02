// Package resources is the resource registry plugin (RFC 0001 §5.6).
package resources

import (
	"context"
	"strconv"
	"strings"
	"sync"

	"github.com/arcships/rutis/go/rutis"

	"github.com/cunninghamcard-bit/attention/native/plugins/shell"
)

const (
	None Status = iota
	Loading
	Live
	Failed
)

// Plugin provides the "resources" registry while loaded.
var Plugin = rutis.Define(rutis.Plugin[struct{}]{
	Name:   "resources",
	Inject: []string{"shell"},
	Apply: func(ctx *rutis.Ctx, _ struct{}) error {
		var sh *shell.Shell
		if err := ctx.Use("shell", &sh); err != nil {
			return err
		}
		ctx.Provide("resources", New(sh.Update, sh.Invalidate))
		return nil
	},
})

// Status is where an address's stream is.
type Status int

// Snapshot is an address's state.
type Snapshot struct {
	Status  Status
	Value   any
	Err     error
	Version int
}

// Provider serves a protocol.
type Provider struct {
	Protocol string
	Open     func(ctx context.Context, address string, emit func(value any, err error))
}

type record struct {
	holds  int
	snap   Snapshot
	cancel context.CancelFunc
	stream int
}

// Registry manages protocol providers and address streams.
type Registry struct {
	mu        sync.Mutex
	post      func(func())
	inv       func()
	streams   int
	providers map[string]Provider
	records   map[string]*record
}

// New creates a resource registry.
func New(post func(func()), inv func()) *Registry {
	if post == nil {
		post = func(fn func()) { fn() }
	}
	return &Registry{
		post:      post,
		inv:       inv,
		providers: map[string]Provider{},
		records:   map[string]*record{},
	}
}

// SetPost replaces how frames reach the main thread (tests); restore puts
// the previous one back.
func (reg *Registry) SetPost(p func(func())) (restore func()) {
	if reg == nil {
		return func() {}
	}
	reg.mu.Lock()
	old := reg.post
	reg.post = p
	reg.mu.Unlock()
	return func() {
		reg.mu.Lock()
		reg.post = old
		reg.mu.Unlock()
	}
}

// Register serves a protocol until off is called.
func (reg *Registry) Register(p Provider) (off func()) {
	if reg == nil {
		return func() {}
	}
	reg.mu.Lock()
	if _, ok := reg.providers[p.Protocol]; ok {
		reg.mu.Unlock()
		panic("resources: protocol " + strconv.Quote(p.Protocol) + " is already served")
	}
	reg.providers[p.Protocol] = p
	for address, r := range reg.records {
		if Protocol(address) == p.Protocol {
			reg.start(address, r, p)
		}
	}
	reg.mu.Unlock()
	reg.invalidate()
	var once sync.Once
	return func() {
		once.Do(func() {
			reg.mu.Lock()
			delete(reg.providers, p.Protocol)
			for address, r := range reg.records {
				if Protocol(address) == p.Protocol {
					stop(r)
					r.snap = Snapshot{Version: r.snap.Version}
				}
			}
			reg.mu.Unlock()
			reg.invalidate()
		})
	}
}

// Hold keeps address's stream open until release is called.
func (reg *Registry) Hold(address string) (release func()) {
	if reg == nil {
		return func() {}
	}
	reg.mu.Lock()
	r := reg.records[address]
	if r == nil {
		r = &record{}
		reg.records[address] = r
		if p, ok := reg.providers[Protocol(address)]; ok {
			reg.start(address, r, p)
		}
	}
	r.holds++
	reg.mu.Unlock()
	var once sync.Once
	return func() {
		once.Do(func() {
			reg.mu.Lock()
			r.holds--
			if r.holds == 0 {
				stop(r)
				delete(reg.records, address)
			}
			reg.mu.Unlock()
		})
	}
}

// Get is address's snapshot; None when it is not held.
func (reg *Registry) Get(address string) Snapshot {
	if reg == nil {
		return Snapshot{}
	}
	reg.mu.Lock()
	defer reg.mu.Unlock()
	if r := reg.records[address]; r != nil {
		return r.snap
	}
	return Snapshot{}
}

func (reg *Registry) start(address string, r *record, p Provider) {
	reg.streams++
	id := reg.streams
	ctx, cancel := context.WithCancel(context.Background())
	r.cancel, r.stream = cancel, id
	r.snap = Snapshot{Status: Loading, Version: r.snap.Version}
	send := reg.post
	emit := func(value any, err error) {
		if ctx.Err() != nil {
			return
		}
		send(func() {
			reg.mu.Lock()
			if reg.records[address] != r || r.stream != id {
				reg.mu.Unlock()
				return
			}
			if err != nil {
				r.snap.Status, r.snap.Err = Failed, err
			} else {
				r.snap.Status, r.snap.Value, r.snap.Err = Live, value, nil
				r.snap.Version++
			}
			reg.mu.Unlock()
			reg.invalidate()
		})
	}
	go p.Open(ctx, address, emit)
}

func (reg *Registry) invalidate() {
	if reg.inv != nil {
		reg.inv()
	}
}

// Protocol is an address's protocol: "file" in "attention-resource://file/…".
func Protocol(address string) string {
	rest, ok := strings.CutPrefix(address, "attention-resource://")
	if !ok {
		return ""
	}
	p, _, _ := strings.Cut(rest, "/")
	return p
}

func stop(r *record) {
	if r.cancel != nil {
		r.cancel()
		r.cancel = nil
	}
	r.stream = 0
}
