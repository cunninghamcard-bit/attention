// Package project is the project plugin (RFC 0001 §5.7): the mounted roots,
// their file listing for quick open, project search, and the CLI's file
// and folder commands. The mount list persists in the config home.
package project

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/arcships/rutis/go/rutis"

	"github.com/cunninghamcard-bit/attention/native/internal/natural"
	"github.com/cunninghamcard-bit/attention/native/internal/paths"
	"github.com/cunninghamcard-bit/attention/native/plugins/actions"
	fsplugin "github.com/cunninghamcard-bit/attention/native/plugins/fs"
)

// Walk limits keep quick open and search responsive on a huge mount (the
// default mount is the home directory).
const (
	// MountsChangedEvent is emitted when a mount is added or removed.
	MountsChangedEvent = "project/mounts-changed"

	maxFiles      = 200_000
	walkBudget    = 3 * time.Second
	maxSearchSize = 2 << 20
	maxLineBytes  = 400
)

var (
	// skipDirs are left out of quick open and search walks (not of the tree).
	skipDirs = map[string]bool{"node_modules": true}

	// Plugin provides "project".
	Plugin = rutis.Define(rutis.Plugin[Config]{
		Name:   "project",
		Inject: []string{"actions", "fs"},
		Apply: func(ctx *rutis.Ctx, cfg Config) error {
			var (
				act *actions.Service
				fs  fsplugin.FS
			)
			if err := ctx.Use("actions", &act); err != nil {
				return err
			}
			if err := ctx.Use("fs", &fs); err != nil {
				return err
			}
			emitCtx, cancel := context.WithCancel(context.Background())
			svc := New(cfg.Mounts, true, func() { _ = ctx.Emit(emitCtx, MountsChangedEvent) })
			svc.act = act
			svc.fs = fs
			ctx.Provide("project", svc)
			for _, cmd := range svc.commands() {
				off := act.Add(cmd)
				ctx.Effect(func(context.Context) error { off(); return nil })
			}
			ctx.Effect(func(context.Context) error { cancel(); return nil })
			return nil
		},
	})
)

// Mount is one opened root directory.
type Mount struct {
	ID   string `json:"id"`
	Name string `json:"name"` // the display prefix of its files: "<Name>/<rel>"
	Path string `json:"path"` // absolute
}

// FileRef is one file under a mount.
type FileRef struct {
	Mount string `json:"mount"` // Mount.ID
	Rel   string `json:"rel"`   // slash-separated, relative to the mount
	Path  string `json:"path"`  // absolute
}

// Listing is a walk of every mount's files.
type Listing struct {
	Files []FileRef `json:"files"`
	// Truncated says the walk stopped at its file or time limit.
	Truncated bool `json:"truncated"`
}

// Query is a project search in attention's query language
// (apps/web/search/SearchEngine.ts): words, "quoted phrases", path:,
// file:, tag:, line:(…), section:(…), [property], [property:value], ext:.
type Query struct {
	Text          string `json:"text"`
	CaseSensitive bool   `json:"caseSensitive"`
	// PathPrefix keeps the files whose display path starts with it.
	PathPrefix string `json:"pathPrefix,omitempty"`
	// Limit stops after this many files (0: no limit).
	Limit int `json:"limit"`
}

// Match is one occurrence in a file.
type Match struct {
	Line int    `json:"line"` // 1-based
	Col  int    `json:"col"`  // 1-based, in bytes
	Len  int    `json:"len"`  // bytes matched
	Text string `json:"text"` // the line, trimmed to 400 bytes
}

// FileResult is a file that satisfies the query, with its matches (none
// when the query only filters files, as file:beta).
type FileResult struct {
	Mount   string  `json:"mount"`
	Rel     string  `json:"rel"`
	Path    string  `json:"path"`
	ModTime int64   `json:"modTime"` // Unix nanoseconds, for sorting
	Matches []Match `json:"matches"`
}

// SearchResult is a search's files, sorted by display path naturally.
type SearchResult struct {
	Files     []FileResult `json:"files"`
	Truncated bool         `json:"truncated"`
}

// Project is the client side of the service.
type Project struct {
	Mounts      func(ctx context.Context) ([]Mount, error)
	AddMount    func(ctx context.Context, path string) (Mount, error)
	RemoveMount func(ctx context.Context, id string) error
	Files       func(ctx context.Context) (Listing, error)
	Search      func(ctx context.Context, q Query) (SearchResult, error)
}

// Config is the project row's configuration: the launcher's --mount list.
type Config struct {
	Mounts []string `json:"mounts,omitempty"`
}

// Service implements the project service.
type Service struct {
	mu     sync.Mutex
	mounts []Mount
	save   bool
	notify func()
	engine *Engine
	act    *actions.Service
	fs     fsplugin.FS
}

// New starts from the configured mounts, else the saved list, else the
// home directory.
func New(configured []string, save bool, notify func()) *Service {
	s := &Service{save: save, notify: notify, engine: NewEngine(nil)}
	list := configured
	if len(list) == 0 {
		list = loadSaved()
	}
	if len(list) == 0 {
		if home, err := os.UserHomeDir(); err == nil {
			list = []string{home}
		}
	}
	for _, p := range list {
		s.add(p)
	}
	s.persist()
	return s
}

// Mounts lists the mounts in order.
func (s *Service) Mounts(context.Context) ([]Mount, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]Mount(nil), s.mounts...), nil
}

// AddMount mounts a directory (an already mounted one is returned as is).
func (s *Service) AddMount(_ context.Context, path string) (Mount, error) {
	m, err := s.add(path)
	if err != nil {
		return m, err
	}
	s.persist()
	if s.notify != nil {
		s.notify()
	}
	return m, nil
}

// RemoveMount unmounts by ID.
func (s *Service) RemoveMount(_ context.Context, id string) error {
	s.mu.Lock()
	idx := -1
	for i, m := range s.mounts {
		if m.ID == id {
			idx = i
		}
	}
	if idx < 0 {
		s.mu.Unlock()
		return fmt.Errorf("Mount %q not found.", id)
	}
	s.mounts = append(s.mounts[:idx], s.mounts[idx+1:]...)
	s.mu.Unlock()
	s.persist()
	if s.notify != nil {
		s.notify()
	}
	return nil
}

// Files walks every mount, within maxFiles and walkBudget.
func (s *Service) Files(ctx context.Context) (Listing, error) {
	mounts, _ := s.Mounts(ctx)
	var out Listing
	deadline := time.Now().Add(walkBudget)
	stop := errors.New("stop")
	for _, m := range mounts {
		err := filepath.WalkDir(m.Path, func(p string, d fs.DirEntry, err error) error {
			if err != nil {
				if d != nil && d.IsDir() && p != m.Path {
					return fs.SkipDir // unreadable directory
				}
				return nil
			}
			if ctx.Err() != nil {
				return ctx.Err()
			}
			name := d.Name()
			if d.IsDir() {
				if p != m.Path && (fsplugin.Excluded[name] || skipDirs[name]) {
					return fs.SkipDir
				}
				return nil
			}
			if fsplugin.Excluded[name] || !d.Type().IsRegular() {
				return nil
			}
			if len(out.Files) >= maxFiles || time.Now().After(deadline) {
				out.Truncated = true
				return stop
			}
			rel, _ := filepath.Rel(m.Path, p)
			out.Files = append(out.Files, FileRef{Mount: m.ID, Rel: filepath.ToSlash(rel), Path: p})
			return nil
		})
		if errors.Is(err, stop) {
			break
		}
		if err != nil {
			return out, err
		}
	}
	return out, nil
}

// Search runs attention's search engine over the mounts' files.
func (s *Service) Search(ctx context.Context, q Query) (SearchResult, error) {
	var res SearchResult
	listing, err := s.Files(ctx)
	if err != nil {
		return res, err
	}
	res.Truncated = listing.Truncated
	display := func(f FileRef) string {
		if m, ok := s.mountByID(f.Mount); ok {
			return Display(m, f.Rel)
		}
		return f.Rel
	}
	res.Files, err = s.engine.Search(ctx, listing.Files, display, q)
	if q.Limit > 0 && len(res.Files) >= q.Limit {
		res.Truncated = true
	}
	return res, err
}

func (s *Service) persist() {
	if !s.save {
		return
	}
	s.mu.Lock()
	list := make([]string, len(s.mounts))
	for i, m := range s.mounts {
		list[i] = m.Path
	}
	s.mu.Unlock()
	data, _ := json.MarshalIndent(map[string]any{"mounts": list}, "", "  ")
	_ = paths.WriteFileAtomic(paths.MountsPath(), data)
}

// add appends a mount unless its path is already mounted; s.mu is not held.
func (s *Service) add(path string) (Mount, error) {
	abs, err := filepath.Abs(path)
	if err != nil {
		return Mount{}, err
	}
	abs = filepath.Clean(abs)
	st, err := os.Stat(abs)
	if err != nil {
		return Mount{}, err
	}
	if !st.IsDir() {
		return Mount{}, fmt.Errorf("%s is not a directory", abs)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, m := range s.mounts {
		if m.Path == abs {
			return m, nil
		}
	}
	name := filepath.Base(abs)
	if home, err := os.UserHomeDir(); err == nil && filepath.Clean(home) == abs {
		name = "Home"
	}
	base, n := name, 2
	for s.nameTaken(name) {
		name = base + "-" + strconv.Itoa(n)
		n++
	}
	m := Mount{ID: name, Name: name, Path: abs}
	s.mounts = append(s.mounts, m)
	return m, nil
}

func (s *Service) nameTaken(name string) bool {
	for _, m := range s.mounts {
		if m.Name == name {
			return true
		}
	}
	return false
}

func (s *Service) mountByID(id string) (Mount, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, m := range s.mounts {
		if m.ID == id {
			return m, true
		}
	}
	return Mount{}, false
}

// commands are the CLI's files, mounts, mount, and the file commands.
func (s *Service) commands() []actions.Command {
	return append([]actions.Command{
		{ID: "files", CLI: true, Run: func(ctx context.Context, a actions.Args) (string, error) {
			listing, err := s.Files(ctx)
			if err != nil {
				return "", err
			}
			if listing.Truncated {
				// An agent must not take a partial list for the whole.
				return "", fmt.Errorf("The file listing stopped at its limit (%d files or %s); mount a narrower folder.", maxFiles, walkBudget)
			}
			folder := a.Params["folder"]
			if folder != "" && !strings.HasSuffix(folder, "/") {
				folder += "/"
			}
			ext := strings.TrimPrefix(a.Params["ext"], ".")
			var out []string
			for _, f := range listing.Files {
				m, ok := s.mountByID(f.Mount)
				if !ok {
					continue
				}
				p := Display(m, f.Rel)
				if folder != "" && !strings.HasPrefix(p, folder) {
					continue
				}
				if ext != "" && strings.TrimPrefix(filepath.Ext(p), ".") != ext {
					continue
				}
				out = append(out, p)
			}
			if a.Has("total") {
				return strconv.Itoa(len(out)), nil
			}
			sort.SliceStable(out, func(i, j int) bool { return natural.Less(out[i], out[j]) })
			return strings.Join(out, "\n"), nil
		}},
		{ID: "mounts", CLI: true, Run: func(ctx context.Context, a actions.Args) (string, error) {
			mounts, _ := s.Mounts(ctx)
			if a.Has("total") {
				return strconv.Itoa(len(mounts)), nil
			}
			lines := make([]string, len(mounts))
			for i, m := range mounts {
				lines[i] = m.Name
				if a.Has("verbose") {
					lines[i] += "\t" + m.Path
				}
			}
			return strings.Join(lines, "\n"), nil
		}},
		{ID: "mount", CLI: true, Run: func(ctx context.Context, a actions.Args) (string, error) {
			p := a.Params["path"]
			if p == "" {
				return "", fmt.Errorf("Missing required parameter: path=<dir>")
			}
			if !filepath.IsAbs(p) && a.Cwd != "" {
				p = filepath.Join(a.Cwd, p)
			}
			m, err := s.AddMount(ctx, p)
			if err != nil {
				return "", err
			}
			return "Mounted: " + m.Name + "\t" + m.Path, nil
		}},
	}, append(s.fileCommands(), s.searchCommands()...)...)
}

// Display is how the CLI and quick open show a file: "<mount name>/<rel>".
func Display(m Mount, rel string) string { return m.Name + "/" + rel }

func loadSaved() []string {
	data, err := os.ReadFile(paths.MountsPath())
	if err != nil {
		return nil
	}
	var saved struct {
		Mounts []string `json:"mounts"`
	}
	if json.Unmarshal(data, &saved) != nil {
		return nil
	}
	var out []string
	for _, p := range saved.Mounts {
		if st, err := os.Stat(p); err == nil && st.IsDir() {
			out = append(out, p)
		}
	}
	return out
}
