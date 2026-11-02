// Package persist saves a plugin's state file: debounced, the snapshot
// taken on the main thread and the write done off it, and a final save on
// unload that no earlier one lands after.
package persist

import (
	"context"
	"encoding/json"
	"os"
	"sync"
	"time"

	"github.com/cunninghamcard-bit/attention/native/internal/paths"
	"github.com/cunninghamcard-bit/attention/native/plugins/shell"
)

// Saver writes snapshot() to path.
type Saver struct {
	sh       *shell.Shell
	path     string
	snapshot func() any // on the main thread

	mu     sync.Mutex
	timer  *time.Timer
	closed bool
	write  sync.Mutex // orders the writes, so the final save is the last
}

// New is a saver of snapshot to path.
func New(sh *shell.Shell, path string, snapshot func() any) *Saver {
	return &Saver{sh: sh, path: path, snapshot: snapshot}
}

// Soon saves within 400 ms, once for a burst of changes.
func (s *Saver) Soon() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return
	}
	if s.timer != nil {
		s.timer.Stop()
	}
	s.timer = time.AfterFunc(400*time.Millisecond, func() {
		s.sh.Update(func() {
			if s.isClosed() {
				return
			}
			v := s.snapshot()
			go func() {
				s.write.Lock()
				defer s.write.Unlock()
				if !s.isClosed() {
					s.save(v)
				}
			}()
		})
	})
}

// Final stops the pending saves and saves once more, the snapshot taken on
// the main thread (the shell is still loaded: its users inject it).
func (s *Saver) Final(ctx context.Context) {
	s.mu.Lock()
	s.closed = true
	if s.timer != nil {
		s.timer.Stop()
	}
	s.mu.Unlock()
	v, err := shell.OnMain(ctx, s.sh, func() (any, error) { return s.snapshot(), nil })
	if err != nil {
		return
	}
	s.write.Lock()
	defer s.write.Unlock()
	s.save(v)
}

func (s *Saver) save(v any) {
	data, err := json.MarshalIndent(v, "", "  ")
	if err == nil {
		_ = paths.WriteFileAtomic(s.path, data)
	}
}

func (s *Saver) isClosed() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.closed
}

// Load reads path into v; false when it is missing or unreadable.
func Load(path string, v any) bool {
	data, err := os.ReadFile(path)
	if err != nil {
		return false
	}
	return json.Unmarshal(data, v) == nil
}
