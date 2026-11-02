// Package index is the index plugin (RFC 0001 §5.6, P2): attention's
// MetadataCache over the mounts — every file by path and name, each
// note's parsed metadata (internal/mdmeta), and the resolved and
// unresolved links between them — and the CLI's commands on it
// (apps/web/app/cli/commands/graphLists.ts, metadata.ts,
// linksOutlineCli.ts, wordcountWebCli.ts), including property:set and
// property:remove.
//
// The index is held in memory and built when the plugin loads (RFC open
// question 5): a walk of the mounts, the notes read through fs. It follows
// fs/changed for the folders fs watches, and walks again every
// rescanEvery for the rest (fs watches only what the reader shows, R9).
package index

import (
	"context"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/cunninghamcard-bit/attention/native/internal/mdmeta"
	"github.com/cunninghamcard-bit/attention/native/plugins/actions"
	fsplugin "github.com/cunninghamcard-bit/attention/native/plugins/fs"
	"github.com/cunninghamcard-bit/attention/native/plugins/project"
)

const (
	// maxNote is the largest note read; a larger one is indexed as a file
	// with no metadata.
	maxNote = 4 << 20
	// rescanEvery is how often the whole mounts are walked again.
	rescanEvery = 2 * time.Minute
)

// Cache is the metadata cache. Its methods are safe for concurrent use.
type Cache struct {
	fs      fsplugin.FS
	project project.Project
	act     *actions.Service

	mu     sync.RWMutex
	files  map[string]*file // by display path
	byAbs  map[string]string
	look   lookup
	mounts []project.Mount
	// resolved and unresolved are resolvedLinks and unresolvedLinks: per
	// source, the target (a path, or an unresolved linkpath) and its count.
	resolved, unresolved map[string]map[string]int
	// noteURLs are the http(s) addresses each note cites, pages the web
	// pages submitted, both by normalized URL (web.go).
	noteURLs  map[string]map[string][]Mention
	pages     map[string]*webPage
	built     chan struct{} // closed after the first build
	builtOnce sync.Once
	// gen counts the changes; OnChange, optional, runs after each, off
	// the lock.
	gen      int
	OnChange func()
}

// New is an index over project's mounts, reading notes through fs.
func New(fs fsplugin.FS, proj project.Project) *Cache {
	return &Cache{fs: fs, project: proj, files: map[string]*file{}, byAbs: map[string]string{}, look: lookup{},
		resolved: map[string]map[string]int{}, unresolved: map[string]map[string]int{}, built: make(chan struct{}),
		noteURLs: map[string]map[string][]Mention{}, pages: map[string]*webPage{}}
}

// Ready waits for the first build.
func (x *Cache) Ready(ctx context.Context) error {
	select {
	case <-x.built:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

// Build walks the mounts and reads every note whose size or time changed
// since the last walk, then resolves the links again.
func (x *Cache) Build(ctx context.Context) error {
	defer x.builtOnce.Do(func() { close(x.built) })
	mounts, err := x.project.Mounts(ctx)
	if err != nil {
		return err
	}
	listing, err := x.project.Files(ctx)
	if err != nil {
		return err
	}
	byID := map[string]project.Mount{}
	for _, m := range mounts {
		byID[m.ID] = m
	}
	x.mu.RLock()
	old := x.files
	x.mu.RUnlock()
	next := make(map[string]*file, len(listing.Files))
	var notes []*file
	for _, f := range listing.Files {
		m, ok := byID[f.Mount]
		if !ok {
			continue
		}
		nf := &file{display: project.Display(m, f.Rel), abs: f.Path, md: isNote(f.Path)}
		if prev, ok := old[nf.display]; ok {
			nf.meta, nf.size, nf.mod = prev.meta, prev.size, prev.mod
		}
		next[nf.display] = nf
		if nf.md {
			notes = append(notes, nf)
		}
	}
	x.readNotes(ctx, notes)
	if ctx.Err() != nil {
		return ctx.Err()
	}
	x.mu.Lock()
	x.mounts = mounts
	x.files = next
	x.byAbs = make(map[string]string, len(next))
	x.look = lookup{}
	for _, f := range next {
		x.byAbs[f.abs] = f.display
		x.look.add(f.display)
	}
	x.resolveAll()
	x.gen++
	x.mu.Unlock()
	x.changed()
	return nil
}

// Changed takes fs/changed: notes written are read again, files removed
// leave, files created join, and the links resolve again.
func (x *Cache) Changed(ctx context.Context, b fsplugin.Batch) {
	x.mu.RLock()
	mounts := x.mounts
	x.mu.RUnlock()
	type update struct {
		f    *file
		gone bool
	}
	var updates []update
	for _, c := range b.Changes {
		m, rel, ok := project.MountOf(mounts, c.Path)
		if !ok || rel == "." {
			continue
		}
		st, err := x.fs.Stat(ctx, c.Path)
		display := project.Display(m, rel)
		if err != nil {
			updates = append(updates, update{f: &file{display: display, abs: c.Path}, gone: true})
			continue
		}
		if st.Dir {
			continue // its files come with the next walk
		}
		f := &file{display: display, abs: c.Path, md: isNote(c.Path)}
		x.mu.RLock()
		if prev, ok := x.files[display]; ok {
			f.meta, f.size, f.mod = prev.meta, prev.size, prev.mod
		}
		x.mu.RUnlock()
		if f.md {
			x.readNote(ctx, f)
		}
		updates = append(updates, update{f: f})
	}
	if len(updates) == 0 {
		return
	}
	defer x.changed()
	x.mu.Lock()
	defer x.mu.Unlock()
	x.gen++
	// Names that came or went may change what other notes' links resolve
	// to (MetadataCache.updateRelatedLinks); a note written resolves its
	// own links again (resolveLinks).
	names := map[string]bool{}
	var written []string
	for _, u := range updates {
		if u.gone {
			if _, ok := x.files[u.f.display]; ok {
				delete(x.files, u.f.display)
				delete(x.byAbs, u.f.abs)
				x.look.remove(u.f.display)
				delete(x.resolved, u.f.display)
				delete(x.unresolved, u.f.display)
				delete(x.noteURLs, u.f.display)
				names[linkName(u.f.display)] = true
			}
			continue
		}
		if _, known := x.files[u.f.display]; !known {
			names[linkName(u.f.display)] = true
		}
		x.files[u.f.display] = u.f
		x.byAbs[u.f.abs] = u.f.display
		x.look.add(u.f.display)
		written = append(written, u.f.display)
	}
	for _, p := range written {
		x.resolveOne(p)
	}
	if len(names) == 0 {
		return
	}
	for src := range x.files {
		if related(x.resolved[src], names) || related(x.unresolved[src], names) {
			x.resolveOne(src)
		}
	}
}

// Run builds the index, then walks the mounts again every rescanEvery,
// until ctx ends.
func (x *Cache) Run(ctx context.Context) error {
	_ = x.Build(ctx)
	t := time.NewTicker(rescanEvery)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-t.C:
			_ = x.Build(ctx)
		}
	}
}

func (x *Cache) changed() {
	if x.OnChange != nil {
		x.OnChange()
	}
}

// readNotes parses the notes whose size or modification time moved, on a
// few goroutines.
func (x *Cache) readNotes(ctx context.Context, notes []*file) {
	work := make(chan *file)
	var wg sync.WaitGroup
	for range runtime.NumCPU() {
		wg.Go(func() {
			for f := range work {
				x.readNote(ctx, f)
			}
		})
	}
	for _, f := range notes {
		if ctx.Err() != nil {
			break
		}
		work <- f
	}
	close(work)
	wg.Wait()
}

// readNote parses f when it changed since it was read.
func (x *Cache) readNote(ctx context.Context, f *file) {
	st, err := x.fs.Stat(ctx, f.abs)
	if err != nil {
		f.meta = nil
		return
	}
	if f.meta != nil && st.Size == f.size && st.ModTime == f.mod {
		return
	}
	f.size, f.mod = st.Size, st.ModTime
	if st.Size > maxNote {
		f.meta = nil
		return
	}
	data, err := x.fs.ReadBytes(ctx, f.abs, maxNote)
	if err != nil {
		f.meta = nil
		return
	}
	m := mdmeta.Parse(string(data))
	f.meta = &m
}

// resolveAll is resolveLinks for every note. Called with mu held.
func (x *Cache) resolveAll() {
	x.resolved = map[string]map[string]int{}
	x.unresolved = map[string]map[string]int{}
	x.noteURLs = map[string]map[string][]Mention{}
	for path := range x.files {
		x.resolveOne(path)
	}
}

// resolveOne is resolveLinks for one note. Called with mu held.
func (x *Cache) resolveOne(path string) {
	f := x.files[path]
	if f == nil || f.meta == nil {
		delete(x.resolved, path)
		delete(x.unresolved, path)
		delete(x.noteURLs, path)
		return
	}
	x.citeNote(path, f.meta)
	res, unres := map[string]int{}, map[string]int{}
	for _, link := range refs(f.meta) {
		lp := stripSubpath(link)
		if dest, ok := x.look.first(lp, path, x.isMD); ok {
			res[dest]++
		} else {
			unres[unresolvedKey(lp)]++
		}
	}
	x.resolved[path], x.unresolved[path] = res, unres
}

// isMD reports whether path is an indexed note. Called with mu held.
func (x *Cache) isMD(path string) bool {
	f, ok := x.files[path]
	return ok && f.md
}

// file is an indexed file.
type file struct {
	display string // "<mount>/<rel>", the CLI's path
	abs     string
	md      bool
	meta    *mdmeta.Metadata // nil for a file not a note, or unread
	size    int64
	mod     int64
}

func isNote(path string) bool { return strings.EqualFold(filepath.Ext(path), ".md") }

// linkName is the name a link may give a file: its base name, lowercased,
// without .md.
func linkName(path string) string {
	n := strings.ToLower(basename(path))
	return strings.TrimSuffix(n, ".md")
}

// related is hasRelatedLink: whether a source's link record names one of
// names.
func related(links map[string]int, names map[string]bool) bool {
	for target := range links {
		if names[linkName(target)] {
			return true
		}
	}
	return false
}

// refs is iterateRefsForCache: the frontmatter links, the links, the
// embeds.
func refs(m *mdmeta.Metadata) []string {
	out := make([]string, 0, len(m.FrontmatterLinks)+len(m.Links)+len(m.Embeds))
	for _, l := range m.FrontmatterLinks {
		out = append(out, l.Link)
	}
	for _, l := range m.Links {
		out = append(out, l.Link)
	}
	for _, l := range m.Embeds {
		out = append(out, l.Link)
	}
	return out
}
