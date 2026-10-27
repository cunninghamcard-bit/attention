// Package fileresource is the file protocol's resource provider (RFC 0001
// §5.6): an address streams a live fs.Entry from Stat, refreshed by
// fs/changed and remounts.
package fileresource

import (
	"context"
	"fmt"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/arcships/rutis/go/rutis"

	fscontract "github.com/cunninghamcard-bit/attention/native/contract/fs"
	projectcontract "github.com/cunninghamcard-bit/attention/native/contract/project"
	"github.com/cunninghamcard-bit/attention/native/resourcesapi"
)

const unwatchTimeout = 2 * time.Second

// Plugin registers the file protocol while loaded.
var Plugin = rutis.Define(rutis.Plugin[struct{}]{
	Name:   "fileresource",
	Inject: []string{"shell", "fs", "project"},
	Apply: func(rctx *rutis.Ctx, _ struct{}) error {
		var fs fscontract.FS
		var project projectcontract.Project
		if err := rctx.Use("fs", &fs); err != nil {
			return err
		}
		if err := rctx.Use("project", &project); err != nil {
			return err
		}
		ctx, cancel := context.WithCancel(context.Background())
		p := New(ctx, fs, project.Mounts)
		off := resourcesapi.Register(resourcesapi.Provider{Protocol: "file", Open: p.Open})
		rctx.On(fscontract.ChangedEvent, func(_ context.Context, args ...any) (any, error) {
			if len(args) == 0 {
				return nil, nil
			}
			b, err := fscontract.DecodeBatch(args[0])
			if err != nil {
				return nil, err
			}
			p.Changed(b)
			return nil, nil
		})
		rctx.On(projectcontract.MountsChangedEvent, func(context.Context, ...any) (any, error) {
			p.MountsChanged()
			return nil, nil
		})
		rctx.Effect(func(context.Context) error {
			off()
			cancel()
			return nil
		})
		return nil
	},
})

// Provider streams file addresses as live fs.Entry values. Open, Changed
// and MountsChanged are safe for concurrent use; nothing here runs on the
// main thread.
type Provider struct {
	ctx   context.Context
	fs    fscontract.FS
	fetch func(context.Context) ([]projectcontract.Mount, error)

	mu      sync.Mutex
	mounts  []projectcontract.Mount
	loaded  bool
	streams map[*stream]struct{}
}

// New starts a mounts fetch in the background. Until that fetch (or a
// later MountsChanged) completes, Open of a mount address waits.
func New(ctx context.Context, fs fscontract.FS, mounts func(context.Context) ([]projectcontract.Mount, error)) *Provider {
	p := &Provider{ctx: ctx, fs: fs, fetch: mounts, streams: map[*stream]struct{}{}}
	go p.loadMounts()
	return p
}

// Open streams address until ctx is done, then returns. Each loop
// re-resolves, re-stats, and waits for a poke; stats of one stream are
// serial so a late Stat cannot overwrite a newer one.
func (p *Provider) Open(ctx context.Context, address string, emit func(any, error)) {
	s := &stream{poke: make(chan struct{}, 1)}
	p.mu.Lock()
	p.streams[s] = struct{}{}
	p.mu.Unlock()
	defer func() {
		p.mu.Lock()
		delete(p.streams, s)
		p.mu.Unlock()
	}()

	watched := ""
	defer func() {
		if watched != "" {
			p.unwatch(watched)
		}
	}()

	var last lastFrame
	for {
		if ctx.Err() != nil {
			return
		}
		path, wait, err := p.resolve(address)
		p.mu.Lock()
		s.path = path
		p.mu.Unlock()
		if wait {
			select {
			case <-ctx.Done():
				return
			case <-s.poke:
				continue
			}
		}
		watched = p.rewatch(ctx, watched, path)
		if ctx.Err() != nil {
			return
		}
		p.emitStat(ctx, path, err, emit, &last)
		if ctx.Err() != nil {
			return
		}
		select {
		case <-ctx.Done():
			return
		case <-s.poke:
		}
	}
}

// Changed pokes streams whose path is a changed path, or under one (a
// parent removed or renamed).
func (p *Provider) Changed(b fscontract.Batch) {
	p.mu.Lock()
	defer p.mu.Unlock()
	for s := range p.streams {
		if s.path == "" {
			continue
		}
		for _, c := range b.Changes {
			if s.path == c.Path || isUnder(s.path, c.Path) {
				s.signal()
				break
			}
		}
	}
}

// MountsChanged re-fetches mounts and pokes every stream.
func (p *Provider) MountsChanged() {
	go p.loadMounts()
}

func (p *Provider) loadMounts() {
	ms, err := p.fetch(p.ctx)
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.ctx.Err() != nil {
		return
	}
	if err == nil {
		p.mounts = append([]projectcontract.Mount(nil), ms...)
	}
	p.loaded = true
	for s := range p.streams {
		s.signal()
	}
}

func (p *Provider) resolve(address string) (path string, wait bool, err error) {
	a, ok := fscontract.ParseAddress(address)
	if !ok {
		return "", false, fmt.Errorf("%q is not a file address", address)
	}
	if a.Abs == "" {
		p.mu.Lock()
		loaded := p.loaded
		p.mu.Unlock()
		if !loaded {
			return "", true, nil
		}
	}
	p.mu.Lock()
	mounts := p.mounts
	p.mu.Unlock()
	path, err = projectcontract.PathOf(mounts, address)
	return path, false, err
}

func (p *Provider) rewatch(ctx context.Context, watched, path string) string {
	dir := ""
	if path != "" {
		dir = filepath.Dir(path)
	}
	if dir == watched {
		return watched
	}
	if watched != "" {
		p.unwatch(watched)
	}
	if dir == "" || ctx.Err() != nil {
		return ""
	}
	if err := p.fs.Watch(ctx, dir); err != nil {
		return ""
	}
	return dir
}

func (p *Provider) unwatch(dir string) {
	ctx, cancel := context.WithTimeout(context.Background(), unwatchTimeout)
	defer cancel()
	_ = p.fs.Unwatch(ctx, dir)
}

func (p *Provider) emitStat(ctx context.Context, path string, resolveErr error, emit func(any, error), last *lastFrame) {
	if resolveErr != nil {
		emitDiff(emit, last, nil, resolveErr)
		return
	}
	e, err := p.fs.Stat(ctx, path)
	if ctx.Err() != nil {
		return
	}
	if err != nil {
		emitDiff(emit, last, nil, err)
		return
	}
	if e.Dir {
		emitDiff(emit, last, nil, fmt.Errorf("%s is a directory", path))
		return
	}
	emitDiff(emit, last, e, nil)
}

type stream struct {
	poke chan struct{}
	path string // last resolved path; Provider.mu
}

func (s *stream) signal() {
	select {
	case s.poke <- struct{}{}:
	default:
	}
}

type lastFrame struct {
	has   bool
	ok    bool
	size  int64
	mod   int64
	inode uint64
	err   string
}

// The registry bumps Version on every Live frame, so duplicates stop here.
func emitDiff(emit func(any, error), last *lastFrame, v any, err error) {
	if err != nil {
		if last.has && !last.ok && last.err == err.Error() {
			return
		}
		*last = lastFrame{has: true, err: err.Error()}
		emit(nil, err)
		return
	}
	e, _ := v.(fscontract.Entry)
	if last.has && last.ok && last.size == e.Size && last.mod == e.ModTime && last.inode == e.Inode {
		return
	}
	*last = lastFrame{has: true, ok: true, size: e.Size, mod: e.ModTime, inode: e.Inode}
	emit(e, nil)
}

func isUnder(path, dir string) bool {
	return strings.HasPrefix(path, dir+string(filepath.Separator))
}
