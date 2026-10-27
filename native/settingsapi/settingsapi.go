// Package settingsapi is the app's configuration (RFC §5.7 settings,
// attention's vault getConfig and setConfig): named JSON files — app,
// appearance, hotkeys, as attention's app.json, appearance.json and
// hotkeys.json — of keys, in the configuration folder (never in an opened
// folder). The settings plugin loads them; Set saves soon after. Main
// thread only, except Load.
package settingsapi

import (
	"context"
	"encoding/json"
	"path/filepath"
	"sync"

	"github.com/cunninghamcard-bit/attention/native/internal/paths"
	"github.com/cunninghamcard-bit/attention/native/internal/persist"
	"github.com/cunninghamcard-bit/attention/native/shellapi"
)

// The configuration files.
const (
	App        = "app"
	Appearance = "appearance"
	Hotkeys    = "hotkeys"
)

var (
	mu     sync.Mutex
	files  = map[string]map[string]json.RawMessage{}
	savers = map[string]*persist.Saver{}
	gen    int
)

// Path is a configuration file's path.
func Path(file string) string { return filepath.Join(paths.ConfigDir(), file+".json") }

// Generation changes whenever a value is set or a file loaded.
func Generation() int {
	mu.Lock()
	defer mu.Unlock()
	return gen
}

// Get reads key of file into v; false when it is unset or not v's type.
func Get(file, key string, v any) bool {
	mu.Lock()
	raw, ok := files[file][key]
	mu.Unlock()
	return ok && json.Unmarshal(raw, v) == nil
}

// Keys are file's keys and values.
func Keys(file string) map[string]json.RawMessage {
	mu.Lock()
	defer mu.Unlock()
	out := make(map[string]json.RawMessage, len(files[file]))
	for k, v := range files[file] {
		out[k] = v
	}
	return out
}

// Set sets key of file to v and saves the file soon.
func Set(file, key string, v any) {
	raw, err := json.Marshal(v)
	if err != nil {
		return
	}
	mu.Lock()
	if files[file] == nil {
		files[file] = map[string]json.RawMessage{}
	}
	files[file][key] = raw
	gen++
	mu.Unlock()
	saver(file).Soon()
	invalidate()
}

// Unset removes key of file and saves the file soon.
func Unset(file, key string) {
	mu.Lock()
	delete(files[file], key)
	gen++
	mu.Unlock()
	saver(file).Soon()
	invalidate()
}

// Flush writes the files with pending saves now (on unload); later sets
// save afresh.
func Flush(ctx context.Context) {
	mu.Lock()
	pending := savers
	savers = map[string]*persist.Saver{}
	mu.Unlock()
	for _, s := range pending {
		s.Final(ctx)
	}
}

// Load reads the files from disk, off the main thread, and installs them
// on it.
func Load(names ...string) {
	read := map[string]map[string]json.RawMessage{}
	for _, f := range names {
		var m map[string]json.RawMessage
		if persist.Load(Path(f), &m) && m != nil {
			read[f] = m
		}
	}
	shellapi.Update(func() {
		mu.Lock()
		for f, m := range read {
			files[f] = m
		}
		gen++
		mu.Unlock()
		invalidate()
	})
}

func saver(file string) *persist.Saver {
	mu.Lock()
	defer mu.Unlock()
	s, ok := savers[file]
	if !ok {
		s = persist.New(Path(file), func() any { return Keys(file) })
		savers[file] = s
	}
	return s
}

func invalidate() {
	if w := shellapi.Window(); w != nil {
		w.Invalidate()
	}
}
