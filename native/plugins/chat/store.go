package chat

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"time"

	"github.com/cunninghamcard-bit/attention/native/internal/paths"
)

// Thread is one conversation with dim, shown as a Chat tab (RFC 0006
// §7.2). Its messages live in dim's session; attention keeps the link.
type Thread struct {
	ID        string    `json:"id"`
	SessionID string    `json:"sessionId,omitempty"`
	Cwd       string    `json:"cwd"`
	Title     string    `json:"title,omitempty"`
	Created   time.Time `json:"created"`
	Used      time.Time `json:"used"`
}

// StorePath is the threads file in the config folder.
func StorePath() string { return filepath.Join(paths.ConfigDir(), "threads.json") }

// load reads the threads at path, none when it does not exist.
func load(path string) ([]*Thread, error) {
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read threads: %w", err)
	}
	var file struct {
		Threads []*Thread `json:"threads"`
	}
	if err := json.Unmarshal(data, &file); err != nil {
		return nil, fmt.Errorf("parse threads: %w", err)
	}
	return slices.DeleteFunc(file.Threads, func(t *Thread) bool { return t == nil || t.ID == "" }), nil
}

// save writes threads to path, replacing it whole.
func save(path string, threads []Thread) error {
	data, err := json.MarshalIndent(struct {
		Threads []Thread `json:"threads"`
	}{threads}, "", "  ")
	if err != nil {
		return fmt.Errorf("encode threads: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("create config folder: %w", err)
	}
	return paths.WriteFileAtomic(path, data)
}

func newThreadID() string {
	var b [8]byte
	_, _ = rand.Read(b[:])
	return hex.EncodeToString(b[:])
}
