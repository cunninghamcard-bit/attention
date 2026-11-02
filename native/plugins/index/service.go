package index

import (
	"cmp"
	"context"
	"net/url"
	"sort"
	"strings"

	"github.com/cunninghamcard-bit/attention/native/internal/clifmt"
)

// ChangedEvent is emitted after the index changed (built, or files came,
// went or changed), with no arguments.
const ChangedEvent = "index/changed"

// Mention is one link from a source note to the asked file, with its line
// for context (the backlinks pane's match).
type Mention struct {
	Line int    `json:"line"` // 0-based
	Col  int    `json:"col"`  // bytes, within the line
	Len  int    `json:"len"`
	Text string `json:"text"` // the line
}

// Backlink is a note linking to the asked file, or a note or web page
// citing the asked URL.
type Backlink struct {
	Path     string    `json:"path"`          // absolute; "" for a web page
	URL      string    `json:"url,omitempty"` // a web page's
	Display  string    `json:"display"`       // "<mount>/<rel>"
	Mentions []Mention `json:"mentions"`
}

// Heading is a note's heading.
type Heading struct {
	Heading string `json:"heading"`
	Level   int    `json:"level"`
	Line    int    `json:"line"` // 0-based
}

// Page is a web page's article as the index takes it.
type Page struct {
	URL      string `json:"url"`
	Title    string `json:"title"`
	Markdown string `json:"markdown"`
}

// Index is the client side of the service.
type Index struct {
	Backlinks    func(ctx context.Context, path string) ([]Backlink, error)
	URLBacklinks func(ctx context.Context, url string) ([]Backlink, error)
	SubmitPage   func(ctx context.Context, page Page) error
	RemovePages  func(ctx context.Context, urls []string) error
	Headings     func(ctx context.Context, path string) ([]Heading, error)
	Generation   func(ctx context.Context) (int, error)
}

// Service is the index service.
type Service struct{ x *Cache }

// Backlinks are the notes whose links resolve to path, each mention with
// its line (the backlinks pane's linked mentions).
func (s Service) Backlinks(ctx context.Context, path string) ([]Backlink, error) {
	x := s.x
	if err := x.Ready(ctx); err != nil {
		return nil, err
	}
	x.mu.RLock()
	target, ok := x.byAbs[path]
	type src struct {
		display, abs string
		lines        []Mention
	}
	var srcs []src
	if ok {
		for from, targets := range x.resolved {
			if targets[target] == 0 {
				continue
			}
			f := x.files[from]
			var ms []Mention
			for _, l := range linksOf(f) {
				lp := stripSubpath(l.link)
				if dest, ok := x.look.first(lp, from, x.isMD); ok && dest == target {
					ms = append(ms, Mention{Line: l.line, Col: l.col, Len: l.len})
				}
			}
			srcs = append(srcs, src{from, f.abs, ms})
		}
	}
	x.mu.RUnlock()
	sort.SliceStable(srcs, func(i, j int) bool { return clifmt.Less(srcs[i].display, srcs[j].display) })
	out := make([]Backlink, 0, len(srcs))
	for _, sr := range srcs {
		// The mentions' lines, read from the note now.
		if data, err := x.fs.ReadBytes(ctx, sr.abs, maxNote); err == nil {
			lines := strings.Split(string(data), "\n")
			for i := range sr.lines {
				if l := sr.lines[i].Line; l < len(lines) {
					sr.lines[i].Text = strings.TrimRight(lines[l], "\r")
				}
			}
		}
		out = append(out, Backlink{Path: sr.abs, Display: sr.display, Mentions: sr.lines})
	}
	return out, nil
}

// Headings are path's headings.
func (s Service) Headings(ctx context.Context, path string) ([]Heading, error) {
	x := s.x
	if err := x.Ready(ctx); err != nil {
		return nil, err
	}
	x.mu.RLock()
	defer x.mu.RUnlock()
	f := x.files[x.byAbs[path]]
	if f == nil || f.meta == nil {
		return nil, nil
	}
	out := make([]Heading, len(f.meta.Headings))
	for i, h := range f.meta.Headings {
		out[i] = Heading{Heading: h.Heading, Level: h.Level, Line: h.Position.Start.Line}
	}
	return out, nil
}

// Generation changes whenever the index does.
func (s Service) Generation(context.Context) (int, error) {
	s.x.mu.RLock()
	defer s.x.mu.RUnlock()
	return s.x.gen, nil
}

// linkAt is a link of a note and where it is.
type linkAt struct {
	link           string
	line, col, len int
}

// NormalizeURL is the key a URL has in the link graph: its fragment
// dropped, its scheme and host lowercased, an empty path "/"; false for an
// address that is not http(s).
func NormalizeURL(s string) (string, bool) {
	u, err := url.Parse(strings.TrimSpace(s))
	if err != nil || u.Host == "" {
		return "", false
	}
	u.Scheme, u.Host = strings.ToLower(u.Scheme), strings.ToLower(u.Host)
	if u.Scheme != "http" && u.Scheme != "https" {
		return "", false
	}
	u.Fragment, u.RawFragment = "", ""
	u.Path = cmp.Or(u.Path, "/")
	return u.String(), true
}

// linksOf are f's links and embeds with their places. Called with mu held.
func linksOf(f *file) []linkAt {
	if f == nil || f.meta == nil {
		return nil
	}
	out := make([]linkAt, 0, len(f.meta.Links)+len(f.meta.Embeds))
	for _, l := range f.meta.Links {
		out = append(out, linkAt{l.Link, l.Position.Start.Line, l.Position.Start.Col, l.Position.End.Offset - l.Position.Start.Offset})
	}
	for _, l := range f.meta.Embeds {
		out = append(out, linkAt{l.Link, l.Position.Start.Line, l.Position.Start.Col, l.Position.End.Offset - l.Position.Start.Offset})
	}
	return out
}
