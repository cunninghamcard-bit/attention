// Package fs is the contract of the fs service (RFC 0001 §5.7): plain data
// and a struct of function fields, so the service can run in this process
// or another. Every method ends in error, as rutis's Use requires.
package fs

import (
	"context"
	"encoding/json"
	"errors"
)

// ErrTooLarge is returned by ReadBytes when the file is larger than max.
var ErrTooLarge = errors.New("file too large")

// Entry is one item of a directory listing.
type Entry struct {
	Name string `json:"name"`
	Path string `json:"path"` // absolute
	Dir  bool   `json:"dir"`
	Size int64  `json:"size"`
	// ModTime (Unix nanoseconds) and Inode, 0 where unknown, are filled by
	// Stat: with Size they tell one version of a file from the next.
	ModTime int64  `json:"modTime,omitempty"`
	Inode   uint64 `json:"inode,omitempty"`
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

// ChangedEvent is emitted with one Batch per debounce window.
const ChangedEvent = "fs/changed"

// WatchErrorEvent is emitted with a message when the system refuses a
// watch (inotify limits) or reports an error.
const WatchErrorEvent = "fs/watch-error"

// FS is the client side of the service.
type FS struct {
	List      func(ctx context.Context, dir string) ([]Entry, error)
	Read      func(ctx context.Context, path string, max int64) (File, error)
	ReadBytes func(ctx context.Context, path string, max int64) ([]byte, error)
	Stat      func(ctx context.Context, path string) (Entry, error)
	Watch     func(ctx context.Context, dir string) error
	Unwatch   func(ctx context.Context, dir string) error
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

// Excluded are names never listed, as Zed's default file_scan_exclusions.
var Excluded = map[string]bool{".git": true, ".svn": true, ".hg": true, "CVS": true, ".DS_Store": true, "Thumbs.db": true}
