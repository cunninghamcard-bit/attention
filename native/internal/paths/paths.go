// Package paths names where attention keeps its files (RFC 0001 §5.9,
// §5.10): one config home, nothing written into opened folders.
package paths

import (
	"os"
	"path/filepath"
)

// ConfigDir is $XDG_CONFIG_HOME/attention (the platform's user config dir
// elsewhere). The Electron app used "Attention"; this one is lowercase so
// the two never share files.
func ConfigDir() string {
	if dir := os.Getenv("ATTENTION_CONFIG_DIR"); dir != "" {
		return dir
	}
	base, err := os.UserConfigDir()
	if err != nil {
		base = filepath.Join(os.TempDir(), "attention-config")
	}
	return filepath.Join(base, "attention")
}

// RuntimeDir holds the socket and lock: $XDG_RUNTIME_DIR when set, else the
// config dir.
func RuntimeDir() string {
	if dir := os.Getenv("XDG_RUNTIME_DIR"); dir != "" {
		return dir
	}
	return ConfigDir()
}

// SocketPath is the CLI socket; ATTENTION_SOCKET overrides it so test runs
// never collide with a running instance.
func SocketPath() string {
	if p := os.Getenv("ATTENTION_SOCKET"); p != "" {
		return p
	}
	return filepath.Join(RuntimeDir(), "attention-cli.sock")
}

// LockPath is the single-instance lock, beside the socket.
func LockPath() string { return SocketPath() + ".lock" }

// MountsPath keeps the last mount list.
func MountsPath() string { return filepath.Join(ConfigDir(), "mounts.json") }

// SessionPath keeps the open tabs (the workspace's).
func SessionPath() string { return filepath.Join(ConfigDir(), "session.json") }

// LayoutPath keeps the docks and the panels' states (the layout's).
func LayoutPath() string { return filepath.Join(ConfigDir(), "layout.json") }

// WriteFileAtomic writes data to a temporary file beside path and renames
// it over path, so a crash never leaves a half-written file.
func WriteFileAtomic(path string, data []byte) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	f, err := os.CreateTemp(filepath.Dir(path), "."+filepath.Base(path)+".*")
	if err != nil {
		return err
	}
	tmp := f.Name()
	if _, err := f.Write(data); err != nil {
		f.Close()
		os.Remove(tmp)
		return err
	}
	if err := f.Sync(); err != nil {
		f.Close()
		os.Remove(tmp)
		return err
	}
	if err := f.Close(); err != nil {
		os.Remove(tmp)
		return err
	}
	return os.Rename(tmp, path)
}
