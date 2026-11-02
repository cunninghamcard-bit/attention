// Package tabtypes is the tab type registry (RFC 0001 §5.6).
package tabtypes

import (
	"cmp"
	"net/url"
	"path"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"

	"github.com/egoist/mygo/ui"

	fsplugin "github.com/cunninghamcard-bit/attention/native/plugins/fs"
)

const (
	Fallback Priority = iota + 1
	Builtin
	Extension
)

// Priority is a claim's tier; a higher tier wins.
type Priority int

// Nav is where to put the reader in the opened file, 1-based.
type Nav struct {
	Line, To int
	Col, Len int
}

// Info is a tab as its body sees it.
type Info struct {
	ID          int
	Kind        string
	Address     string
	Path        string
	Title       string
	Nav         *Nav
	NavRevision int
	Version     int
	Pending     bool
	Missing     bool
	Focused     bool
}

// Props are what the workspace gives a body.
type Props struct {
	Info     Info
	Retarget func(address, title string)
	SetTitle func(title string)
}

// MenuItem is an entry a tab type adds to its tab's More options.
type MenuItem struct {
	Title   string
	Icon    *ui.SVG
	Checked bool
	Run     func()
}

// TabType is a tab type's definition and body.
type TabType struct {
	ID       string
	Kind     string
	Patterns []string
	Priority Priority
	CanOpen  func(address string) bool
	Title    func(address string) string
	Icon     *ui.SVG
	Body     func(c *ui.Context, p Props)
	Status   func(c *ui.Context, p Props)
	Actions  func(c *ui.Context, p Props)
	Header   func(c *ui.Context, p Props)
	Menu     func(tabID int) []MenuItem
	Closed   func(tabID int)
	Lines    func(tabID int) (cur, lines int, ok bool)
}

type kindSlot struct {
	inForce, shadowed int
}

// Registry manages registered tab types and address claims.
type Registry struct {
	mu    sync.Mutex
	inv   func()
	seq   int
	gen   int
	types map[int]TabType
	ids   map[string]bool
	kinds map[string]*kindSlot
}

// New creates an empty tab type registry.
func New(inv func()) *Registry {
	return &Registry{
		inv:   inv,
		types: map[int]TabType{},
		ids:   map[string]bool{},
		kinds: map[string]*kindSlot{},
	}
}

// Get is the type registered under id, in force or shadowed.
func (r *Registry) Get(id string) (TabType, bool) {
	if r == nil {
		return TabType{}, false
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, t := range r.types {
		if t.ID == id {
			return t, true
		}
	}
	return TabType{}, false
}

// Claim is the type that shows address.
func (r *Registry) Claim(address, kind string) (TabType, bool) {
	if r == nil {
		return TabType{}, false
	}
	if kind == "" {
		cs := r.Candidates(address)
		if len(cs) == 0 {
			return TabType{}, false
		}
		return cs[0], true
	}
	r.mu.Lock()
	slot := r.kinds[kind]
	var t TabType
	if slot != nil {
		t = r.types[slot.inForce]
	}
	r.mu.Unlock()
	if slot == nil || (t.CanOpen != nil && !t.CanOpen(address)) {
		return TabType{}, false
	}
	return t, true
}

// Register adds a tab type until off is called.
func (r *Registry) Register(t TabType) (off func()) {
	if r == nil {
		return func() {}
	}
	t.Priority = cmp.Or(t.Priority, Extension)
	r.mu.Lock()
	if r.ids[t.ID] {
		r.mu.Unlock()
		panic("tabtypes: tab type id " + strconv.Quote(t.ID) + " is already registered")
	}
	slot := r.kinds[t.Kind]
	if slot != nil && !r.coexists(slot, t.Priority) {
		r.mu.Unlock()
		panic("tabtypes: tab kind " + strconv.Quote(t.Kind) + " is already registered")
	}
	r.seq++
	id := r.seq
	r.types[id] = t
	r.ids[t.ID] = true
	switch {
	case slot == nil:
		r.kinds[t.Kind] = &kindSlot{inForce: id}
	case t.Priority > r.types[slot.inForce].Priority:
		slot.shadowed, slot.inForce = slot.inForce, id
	default:
		slot.shadowed = id
	}
	r.gen++
	r.mu.Unlock()
	r.invalidate()
	var once sync.Once
	return func() {
		once.Do(func() {
			r.mu.Lock()
			slot := r.kinds[t.Kind]
			switch {
			case slot.inForce != id:
				slot.shadowed = 0
			case slot.shadowed == 0:
				delete(r.kinds, t.Kind)
			default:
				slot.inForce, slot.shadowed = slot.shadowed, 0
			}
			delete(r.types, id)
			delete(r.ids, t.ID)
			r.gen++
			r.mu.Unlock()
			r.invalidate()
		})
	}
}

// Generation changes whenever a type is registered or removed.
func (r *Registry) Generation() int {
	if r == nil {
		return 0
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.gen
}

// Candidates are the types in force that can show address, best first.
func (r *Registry) Candidates(address string) []TabType {
	if r == nil {
		return nil
	}
	r.mu.Lock()
	type cand struct {
		t     TabType
		score int
	}
	var cs []cand
	for _, k := range r.active() {
		t := r.types[k]
		best := -1
		for _, p := range t.Patterns {
			if Match(p, address) && len(p) > best {
				best = len(p)
			}
		}
		if best >= 0 {
			cs = append(cs, cand{t, best})
		}
	}
	r.mu.Unlock()
	sort.SliceStable(cs, func(i, j int) bool {
		if cs[i].t.Priority != cs[j].t.Priority {
			return cs[i].t.Priority > cs[j].t.Priority
		}
		return cs[i].score > cs[j].score
	})
	var out []TabType
	for _, c := range cs {
		if c.t.CanOpen == nil || c.t.CanOpen(address) {
			out = append(out, c.t)
		}
	}
	return out
}

func (r *Registry) coexists(slot *kindSlot, p Priority) bool {
	held := r.types[slot.inForce].Priority
	return p != Fallback && held != Fallback && held != p && slot.shadowed == 0
}

func (r *Registry) active() []int {
	keys := make([]int, 0, len(r.kinds))
	for _, slot := range r.kinds {
		keys = append(keys, slot.inForce)
	}
	sort.Ints(keys)
	return keys
}

func (r *Registry) invalidate() {
	if r.inv != nil {
		r.inv()
	}
}

// PageAddress is the address of the page of kind.
func PageAddress(kind string) string { return "attention://" + kind }

// PageKind is the kind a page address names, false for another address.
func PageKind(address string) (string, bool) {
	kind, ok := strings.CutPrefix(address, "attention://")
	return kind, ok && kind != "" && !strings.Contains(kind, "/")
}

// Resourceless reports whether address names no file.
func Resourceless(address string) bool {
	return WebAddress(address) || strings.HasPrefix(address, "attention://")
}

// WebAddress reports whether address is a web page's: http(s) or about.
func WebAddress(address string) bool {
	scheme, _, ok := strings.Cut(address, ":")
	if !ok {
		return false
	}
	switch strings.ToLower(scheme) {
	case "http", "https", "about":
		return true
	}
	return false
}

// Match reports whether pattern matches address.
func Match(pattern, address string) bool {
	if strings.Contains(pattern, ":") {
		return matchSegments(strings.Split(pattern, "/"), strings.Split(address, "/"))
	}
	pattern = strings.ToLower(pattern)
	for _, seg := range pathSegments(address) {
		if ok, _ := path.Match(pattern, strings.ToLower(seg)); ok {
			return true
		}
	}
	return false
}

func pathSegments(address string) []string {
	if a, ok := fsplugin.ParseAddress(address); ok {
		p := a.Rel
		if a.Abs != "" {
			p = strings.TrimPrefix(filepath.ToSlash(a.Abs), "/")
		}
		return strings.Split(p, "/")
	}
	_, rest, ok := strings.Cut(address, "://")
	if !ok {
		return nil
	}
	segs := strings.Split(rest, "/")[1:]
	for i, seg := range segs {
		if s, err := url.PathUnescape(seg); err == nil {
			segs[i] = s
		}
	}
	return segs
}

func matchSegments(pat, segs []string) bool {
	if len(pat) == 0 {
		return len(segs) == 0
	}
	if pat[0] == "**" {
		for i := 0; i <= len(segs); i++ {
			if matchSegments(pat[1:], segs[i:]) {
				return true
			}
		}
		return false
	}
	if len(segs) == 0 {
		return false
	}
	if ok, _ := path.Match(pat[0], segs[0]); !ok {
		return false
	}
	return matchSegments(pat[1:], segs[1:])
}
