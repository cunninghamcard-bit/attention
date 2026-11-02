// Package fs is the fs service plugin (RFC 0001 §5.7): listing, reading,
// writing and watching files. Watching uses fsnotify, never mygo.WatchFiles,
// so the plugin behaves the same in the UI runtime and in a process of its
// own. Only directories someone asked for are watched (RFC R9). Writes do
// not emit events; the watcher reports them.
package fs

import (
	"bytes"
	"context"
	"encoding/json"
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

	"github.com/cunninghamcard-bit/attention/native/internal/natural"
)

const (
	// ChangedEvent is emitted with one Batch per debounce window.
	ChangedEvent = "fs/changed"

	// WatchErrorEvent is emitted with a message when the system refuses a
	// watch (inotify limits) or reports an error.
	WatchErrorEvent = "fs/watch-error"

	// debounce is how long changes gather before one batch is emitted.
	debounce = 75 * time.Millisecond

	// sniff is how much of a file decides whether it is binary.
	sniff = 8000

	// chunkSize is how much Read and ReadBytes copy between ctx checks.
	chunkSize = 64 << 10
)

var (
	// ErrTooLarge is returned by ReadBytes when the file is larger than max.
	ErrTooLarge = errors.New("file too large")

	// Excluded are names never listed, as Zed's default file_scan_exclusions.
	Excluded = map[string]bool{".git": true, ".svn": true, ".hg": true, "CVS": true, ".DS_Store": true, "Thumbs.db": true}

	// Plugin provides "fs".
	Plugin = rutis.Define(rutis.Plugin[struct{}]{
		Name: "fs",
		Apply: func(ctx *rutis.Ctx, _ struct{}) error {
			// Events go out on a context of this plugin's own, not a caller's.
			emitCtx, cancel := context.WithCancel(context.Background())
			svc, err := New(
				func(b Batch) { _ = ctx.Emit(emitCtx, ChangedEvent, b) },
				func(msg string) { _ = ctx.Emit(emitCtx, WatchErrorEvent, msg) },
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
)

// Entry is one item of a directory listing.
type Entry struct {
	Name string `json:"name"`
	Path string `json:"path"` // absolute
	Dir  bool   `json:"dir"`
	Size int64  `json:"size"`
	// ModTime (Unix nanoseconds) and Inode, 0 where unknown, are filled by
	// Stat: with Size they tell one version of a file from the next.
	ModTime int64 `json:"modTime,omitempty"`
	// CTime is the inode change time (Unix nanoseconds), 0 where unknown.
	// Stat fills it; List may leave it empty.
	CTime int64  `json:"ctime,omitempty"`
	Inode uint64 `json:"inode,omitempty"`
}

// File is a read text file. Binary and TooLarge files carry no Text.
type File struct {
	Path     string `json:"path"`
	Text     string `json:"text"`
	Size     int64  `json:"size"`
	ModTime  int64  `json:"modTime"` // Unix nanoseconds
	Binary   bool   `json:"binary"`
	TooLarge bool   `json:"tooLarge"`
}

// Change is one path that changed under a watched directory.
type Change struct {
	Path string `json:"path"` // absolute
	Op   string `json:"op"`   // create, write, remove, rename
}

// Batch is the payload of ChangedEvent.
type Batch struct {
	Changes []Change `json:"changes"`
}

// FS is the client side of the service.
type FS struct {
	List      func(ctx context.Context, dir string) ([]Entry, error)
	Read      func(ctx context.Context, path string, max int64) (File, error)
	ReadBytes func(ctx context.Context, path string, max int64) ([]byte, error)
	Stat      func(ctx context.Context, path string) (Entry, error)
	Watch     func(ctx context.Context, dir string) error
	Unwatch   func(ctx context.Context, dir string) error
	Write     func(ctx context.Context, path string, data []byte) error
	Append    func(ctx context.Context, path string, data []byte) error
	Mkdir     func(ctx context.Context, path string,
	) error
	Rename func(ctx context.Context, oldpath, newpath string) error
	Remove func(ctx context.Context, path string) error
	Trash  func(ctx context.Context, path string) error
}

// Service implements the fs service.
type Service struct {
	watcher *fsnotify.Watcher

	mu      sync.Mutex
	watched map[string]int // directory -> watch count
	pending map[string]string
	timer   *time.Timer
	emit    func(Batch)
	report  func(string)
}

// New makes a service with its own watcher; emit receives the batches and
// report the watch errors.
func New(emit func(Batch), report func(string)) (*Service, error) {
	w, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, err
	}
	return &Service{watcher: w, watched: map[string]int{}, pending: map[string]string{}, emit: emit, report: report}, nil
}

// List lists a directory: directories first, then files, each by name
// without case, skipping Excluded.
func (s *Service) List(ctx context.Context, dir string) ([]Entry, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	items, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	out := make([]Entry, 0, len(items))
	for _, it := range items {
		if Excluded[it.Name()] {
			continue
		}
		e := Entry{Name: it.Name(), Path: filepath.Join(dir, it.Name()), Dir: it.IsDir()}
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

// Read reads a text file of at most max bytes. A larger file comes back
// TooLarge and a file with a NUL byte in its first 8000 bytes Binary, both
// without text. It returns ctx.Err() once ctx is done.
func (s *Service) Read(ctx context.Context, path string, max int64) (File, error) {
	if err := ctx.Err(); err != nil {
		return File{}, err
	}
	f, err := os.Open(path)
	if err != nil {
		return File{}, err
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil {
		return File{}, err
	}
	if st.IsDir() {
		return File{}, fmt.Errorf("%s is a directory", path)
	}
	out := File{Path: path, Size: st.Size(), ModTime: st.ModTime().UnixNano()}
	if err := ctx.Err(); err != nil {
		return File{}, err
	}
	head := make([]byte, sniff)
	n, err := io.ReadFull(f, head)
	if err != nil && !errors.Is(err, io.ErrUnexpectedEOF) && !errors.Is(err, io.EOF) {
		return File{}, err
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
	if errors.Is(err, ErrTooLarge) {
		out.TooLarge = true
		return out, nil
	}
	if err != nil {
		return File{}, err
	}
	out.Text = string(head[:n]) + string(rest)
	return out, nil
}

// ReadBytes reads a file of at most max bytes. A larger file returns
// ErrTooLarge. It returns ctx.Err() once ctx is done.
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
	if errors.Is(err, ErrTooLarge) {
		return nil, tooLarge(path, max)
	}
	return data, err
}

// Stat describes one path.
func (s *Service) Stat(ctx context.Context, path string) (Entry, error) {
	if err := ctx.Err(); err != nil {
		return Entry{}, err
	}
	st, err := os.Stat(path)
	if err != nil {
		return Entry{}, err
	}
	e := Entry{Name: filepath.Base(path), Path: path, Dir: st.IsDir(), Size: st.Size(), ModTime: st.ModTime().UnixNano()}
	if sys, ok := st.Sys().(*syscall.Stat_t); ok {
		e.Inode = uint64(sys.Ino)
		e.CTime = ctime(sys)
	}
	return e, nil
}

// Watch reports changes to the entries of dir (not deeper) as
// ChangedEvent batches. Watches are counted: each Watch needs an
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
	s.noteOp(ev.Name, op)
}

// noteOp queues a change of path for the next batch. The service's own
// writes queue theirs too, so fs/changed reports a write the CLI did in a
// folder nothing watches.
func (s *Service) noteOp(path, op string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.pending == nil {
		return // a Service not made by New, as a test's
	}
	if prev, ok := s.pending[path]; ok && prev == "create" && op == "write" {
		op = "create"
	}
	s.pending[path] = op
	if s.timer == nil {
		s.timer = time.AfterFunc(debounce, s.flush)
	}
}

func (s *Service) flush() {
	s.mu.Lock()
	batch := Batch{Changes: make([]Change, 0, len(s.pending))}
	for p, op := range s.pending {
		batch.Changes = append(batch.Changes, Change{Path: p, Op: op})
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

// DecodeBatch reads an event argument as a Batch, whether it arrived as the
// original value (same process) or as decoded data (another process).
func DecodeBatch(arg any) (Batch, error) {
	if b, ok := arg.(Batch); ok {
		return b, nil
	}
	data, err := json.Marshal(arg)
	if err != nil {
		return Batch{}, err
	}
	var b Batch
	err = json.Unmarshal(data, &b)
	return b, err
}

// SortEntries orders directories first, then by name in natural order
// (without case, d2 before d10), as Zed does.
func SortEntries(es []Entry) {
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

func tooLarge(path string, max int64) error {
	return fmt.Errorf("%s is larger than %d bytes: %w", filepath.Base(path), max, ErrTooLarge)
}

// readChunks copies r in chunkSize pieces. max < 0 means no size limit;
// otherwise more than max bytes is ErrTooLarge. ctx is checked
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
		return nil, ErrTooLarge
	}
	return buf.Bytes(), nil
}
