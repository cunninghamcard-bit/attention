// Package fs is the fs service plugin (RFC 0001 §5.7): listing, reading,
// writing and watching files. Watching uses fsnotify, never mygo.WatchFiles,
// so the plugin behaves the same in the UI runtime and in a process of its
// own. Only directories someone asked for are watched (RFC R9). Writes do
// not emit events; the watcher reports them.
package fs

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"syscall"
	"time"

	"github.com/arcships/rutis/go/rutis"
	"github.com/fsnotify/fsnotify"

	contract "github.com/cunninghamcard-bit/attention/native/contract/fs"
	"github.com/cunninghamcard-bit/attention/native/internal/natural"
)

// debounce is how long changes gather before one batch is emitted.
const debounce = 75 * time.Millisecond

// Service implements the fs contract.
type Service struct {
	watcher *fsnotify.Watcher

	mu      sync.Mutex
	watched map[string]int // directory -> watch count
	pending map[string]string
	timer   *time.Timer
	emit    func(contract.Batch)
	report  func(string)
}

// List lists a directory: directories first, then files, each by name
// without case, skipping contract.Excluded.
func (s *Service) List(ctx context.Context, dir string) ([]contract.Entry, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	items, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	out := make([]contract.Entry, 0, len(items))
	for _, it := range items {
		if contract.Excluded[it.Name()] {
			continue
		}
		e := contract.Entry{Name: it.Name(), Path: filepath.Join(dir, it.Name()), Dir: it.IsDir()}
		if it.Type()&os.ModeSymlink != 0 {
			// A link to a directory lists as one; a broken link as a file.
			if st, err := os.Stat(e.Path); err == nil {
				e.Dir = st.IsDir()
				e.Size = st.Size()
			}
		} else if info, err := it.Info(); err == nil {
			e.Size = info.Size()
		}
		out = append(out, e)
	}
	SortEntries(out)
	return out, nil
}

// SortEntries orders directories first, then by name in natural order
// (without case, d2 before d10), as Zed does.
func SortEntries(es []contract.Entry) {
	sort.SliceStable(es, func(i, j int) bool {
		a, b := es[i], es[j]
		if a.Dir != b.Dir {
			return a.Dir
		}
		if natural.Less(a.Name, b.Name) != natural.Less(b.Name, a.Name) {
			return natural.Less(a.Name, b.Name)
		}
		return a.Name < b.Name
	})
}

// sniff is how much of a file decides whether it is binary.
const sniff = 8000

// chunkSize is how much Read and ReadBytes copy between ctx checks.
const chunkSize = 64 << 10

// Read reads a text file of at most max bytes. A larger file comes back
// TooLarge and a file with a NUL byte in its first 8000 bytes Binary, both
// without text. It returns ctx.Err() once ctx is done.
func (s *Service) Read(ctx context.Context, path string, max int64) (contract.File, error) {
	if err := ctx.Err(); err != nil {
		return contract.File{}, err
	}
	f, err := os.Open(path)
	if err != nil {
		return contract.File{}, err
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil {
		return contract.File{}, err
	}
	if st.IsDir() {
		return contract.File{}, fmt.Errorf("%s is a directory", path)
	}
	out := contract.File{Path: path, Size: st.Size(), ModTime: st.ModTime().UnixNano()}
	if err := ctx.Err(); err != nil {
		return contract.File{}, err
	}
	head := make([]byte, sniff)
	n, err := io.ReadFull(f, head)
	if err != nil && !errors.Is(err, io.ErrUnexpectedEOF) && !errors.Is(err, io.EOF) {
		return contract.File{}, err
	}
	if bytes.IndexByte(head[:n], 0) >= 0 {
		out.Binary = true
		return out, nil
	}
	if max > 0 && (st.Size() > max || int64(n) > max) {
		out.TooLarge = true
		return out, nil
	}
	budget := int64(-1)
	if max > 0 {
		budget = max - int64(n)
	}
	rest, err := readChunks(ctx, f, budget)
	if errors.Is(err, contract.ErrTooLarge) {
		out.TooLarge = true
		return out, nil
	}
	if err != nil {
		return contract.File{}, err
	}
	out.Text = string(head[:n]) + string(rest)
	return out, nil
}

func tooLarge(path string, max int64) error {
	return fmt.Errorf("%s is larger than %d bytes: %w", filepath.Base(path), max, contract.ErrTooLarge)
}

// ReadBytes reads a file of at most max bytes. A larger file returns
// contract.ErrTooLarge. It returns ctx.Err() once ctx is done.
func (s *Service) ReadBytes(ctx context.Context, path string, max int64) ([]byte, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	if max <= 0 {
		return readChunks(ctx, f, -1)
	}
	st, err := f.Stat()
	if err != nil {
		return nil, err
	}
	if st.Size() > max {
		return nil, tooLarge(path, max)
	}
	data, err := readChunks(ctx, f, max)
	if errors.Is(err, contract.ErrTooLarge) {
		return nil, tooLarge(path, max)
	}
	return data, err
}

// readChunks copies r in chunkSize pieces. max < 0 means no size limit;
// otherwise more than max bytes is contract.ErrTooLarge. ctx is checked
// before each piece.
func readChunks(ctx context.Context, r io.Reader, max int64) ([]byte, error) {
	var buf bytes.Buffer
	chunk := make([]byte, chunkSize)
	var taken int64
	unlimited := max < 0
	limit := max
	if !unlimited {
		limit = max + 1
	}
	for {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		toRead := chunk
		if !unlimited {
			remain := limit - taken
			if remain <= 0 {
				break
			}
			if remain < int64(len(toRead)) {
				toRead = chunk[:remain]
			}
		}
		n, err := r.Read(toRead)
		if n > 0 {
			buf.Write(toRead[:n])
			taken += int64(n)
		}
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return nil, err
		}
	}
	if !unlimited && taken > max {
		return nil, contract.ErrTooLarge
	}
	return buf.Bytes(), nil
}

// Stat describes one path.
func (s *Service) Stat(ctx context.Context, path string) (contract.Entry, error) {
	if err := ctx.Err(); err != nil {
		return contract.Entry{}, err
	}
	st, err := os.Stat(path)
	if err != nil {
		return contract.Entry{}, err
	}
	e := contract.Entry{Name: filepath.Base(path), Path: path, Dir: st.IsDir(), Size: st.Size(), ModTime: st.ModTime().UnixNano()}
	if sys, ok := st.Sys().(*syscall.Stat_t); ok {
		e.Inode = uint64(sys.Ino)
		e.CTime = sys.Ctim.Nano()
	}
	return e, nil
}

// Watch reports changes to the entries of dir (not deeper) as
// contract.ChangedEvent batches. Watches are counted: each Watch needs an
// Unwatch.
func (s *Service) Watch(_ context.Context, dir string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.watched[dir] > 0 {
		s.watched[dir]++
		return nil
	}
	if err := s.watcher.Add(dir); err != nil {
		if errors.Is(err, syscall.ENOSPC) {
			return fmt.Errorf("the system's file watch limit is reached (fs.inotify.max_user_watches); %s will not refresh by itself", dir)
		}
		return err
	}
	s.watched[dir] = 1
	return nil
}

// Unwatch drops one Watch of dir.
func (s *Service) Unwatch(_ context.Context, dir string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	switch n := s.watched[dir]; {
	case n > 1:
		s.watched[dir] = n - 1
	case n == 1:
		delete(s.watched, dir)
		// The directory may be gone already; that is not an error here.
		_ = s.watcher.Remove(dir)
	}
	return nil
}

func (s *Service) note(ev fsnotify.Event) {
	op := ""
	switch {
	case ev.Op.Has(fsnotify.Remove):
		op = "remove"
	case ev.Op.Has(fsnotify.Rename):
		op = "rename"
	case ev.Op.Has(fsnotify.Create):
		op = "create"
	case ev.Op.Has(fsnotify.Write):
		op = "write"
	default:
		return // chmod only
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if prev, ok := s.pending[ev.Name]; ok && prev == "create" && op == "write" {
		op = "create"
	}
	s.pending[ev.Name] = op
	if s.timer == nil {
		s.timer = time.AfterFunc(debounce, s.flush)
	}
}

func (s *Service) flush() {
	s.mu.Lock()
	batch := contract.Batch{Changes: make([]contract.Change, 0, len(s.pending))}
	for p, op := range s.pending {
		batch.Changes = append(batch.Changes, contract.Change{Path: p, Op: op})
	}
	s.pending = map[string]string{}
	s.timer = nil
	emit := s.emit
	s.mu.Unlock()
	sort.Slice(batch.Changes, func(i, j int) bool { return batch.Changes[i].Path < batch.Changes[j].Path })
	if len(batch.Changes) > 0 && emit != nil {
		emit(batch)
	}
}

// New makes a service with its own watcher; emit receives the batches and
// report the watch errors.
func New(emit func(contract.Batch), report func(string)) (*Service, error) {
	w, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, err
	}
	return &Service{watcher: w, watched: map[string]int{}, pending: map[string]string{}, emit: emit, report: report}, nil
}

// Run delivers the watcher's events until ctx ends.
func (s *Service) Run(ctx context.Context) error {
	for {
		select {
		case <-ctx.Done():
			return nil
		case ev, ok := <-s.watcher.Events:
			if !ok {
				return nil
			}
			s.note(ev)
		case err, ok := <-s.watcher.Errors:
			if !ok {
				return nil
			}
			if s.report != nil {
				s.report(err.Error())
			}
		}
	}
}

// Close stops the watcher.
func (s *Service) Close() error {
	s.mu.Lock()
	if s.timer != nil {
		s.timer.Stop()
		s.timer = nil
	}
	s.emit = nil
	s.mu.Unlock()
	return s.watcher.Close()
}

// Plugin provides "fs".
var Plugin = rutis.Define(rutis.Plugin[struct{}]{
	Name: "fs",
	Apply: func(ctx *rutis.Ctx, _ struct{}) error {
		// Events go out on a context of this plugin's own, not a caller's.
		emitCtx, cancel := context.WithCancel(context.Background())
		svc, err := New(
			func(b contract.Batch) { _ = ctx.Emit(emitCtx, contract.ChangedEvent, b) },
			func(msg string) { _ = ctx.Emit(emitCtx, contract.WatchErrorEvent, msg) },
		)
		if err != nil {
			cancel()
			return err
		}
		ctx.Go(svc.Run)
		ctx.Provide("fs", svc)
		ctx.Effect(func(context.Context) error {
			cancel()
			return svc.Close()
		})
		return nil
	},
})
