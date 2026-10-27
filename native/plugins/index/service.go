package index

import (
	"context"
	"sort"
	"strings"

	indexcontract "github.com/cunninghamcard-bit/attention/native/contract/index"
	"github.com/cunninghamcard-bit/attention/native/internal/clifmt"
	"github.com/cunninghamcard-bit/attention/native/internal/mdmeta"
)

// Service is the index service (contract/index).
type Service struct{ x *Index }

// Backlinks are the notes whose links resolve to path, each mention with
// its line (the backlinks pane's linked mentions).
func (s Service) Backlinks(ctx context.Context, path string) ([]indexcontract.Backlink, error) {
	x := s.x
	if err := x.Ready(ctx); err != nil {
		return nil, err
	}
	x.mu.RLock()
	target, ok := x.byAbs[path]
	type src struct {
		display, abs string
		lines        []indexcontract.Mention
	}
	var srcs []src
	if ok {
		for from, targets := range x.resolved {
			if targets[target] == 0 {
				continue
			}
			f := x.files[from]
			var ms []indexcontract.Mention
			for _, l := range linksOf(f) {
				lp := stripSubpath(l.link)
				if dest, ok := x.look.first(lp, from, x.isMD); ok && dest == target {
					ms = append(ms, indexcontract.Mention{Line: l.line, Col: l.col, Len: l.len})
				}
			}
			srcs = append(srcs, src{from, f.abs, ms})
		}
	}
	x.mu.RUnlock()
	sort.SliceStable(srcs, func(i, j int) bool { return clifmt.Less(srcs[i].display, srcs[j].display) })
	out := make([]indexcontract.Backlink, 0, len(srcs))
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
		out = append(out, indexcontract.Backlink{Path: sr.abs, Display: sr.display, Mentions: sr.lines})
	}
	return out, nil
}

// Headings are path's headings.
func (s Service) Headings(ctx context.Context, path string) ([]indexcontract.Heading, error) {
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
	out := make([]indexcontract.Heading, len(f.meta.Headings))
	for i, h := range f.meta.Headings {
		out[i] = indexcontract.Heading{Heading: h.Heading, Level: h.Level, Line: h.Position.Start.Line}
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

// linksOf are f's links and embeds with their places. Called with mu held.
func linksOf(f *file) []linkAt {
	if f == nil || f.meta == nil {
		return nil
	}
	var out []linkAt
	for _, ls := range [][]mdmeta.Link{f.meta.Links, f.meta.Embeds} {
		for _, l := range ls {
			out = append(out, linkAt{link: l.Link, line: l.Position.Start.Line, col: l.Position.Start.Col,
				len: l.Position.End.Offset - l.Position.Start.Offset})
		}
	}
	return out
}
