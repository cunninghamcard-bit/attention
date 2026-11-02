package index

import (
	"cmp"
	"context"
	"sort"

	"github.com/cunninghamcard-bit/attention/native/internal/clifmt"
	"github.com/cunninghamcard-bit/attention/native/internal/mdmeta"
)

// The link graph across resource types (RFC 0001 §5.6): notes and web
// pages citing the same URL see each other, the normalized URL the key
// (NormalizeURL), whatever the resources' addresses.

// SubmitPage indexes page, replacing its last submission.
func (s Service) SubmitPage(_ context.Context, page Page) error {
	key, ok := NormalizeURL(page.URL)
	if !ok {
		return nil
	}
	m := mdmeta.Parse(page.Markdown)
	p := &webPage{url: page.URL, title: page.Title, cites: citations(&m)}
	delete(p.cites, key) // a page's links to itself
	x := s.x
	x.mu.Lock()
	x.pages[key] = p
	x.gen++
	x.mu.Unlock()
	x.changed()
	return nil
}

// RemovePages drops the pages of urls, every page for none.
func (s Service) RemovePages(_ context.Context, urls []string) error {
	x := s.x
	x.mu.Lock()
	if len(urls) == 0 {
		x.pages = map[string]*webPage{}
	}
	for _, u := range urls {
		if key, ok := NormalizeURL(u); ok {
			delete(x.pages, key)
		}
	}
	x.gen++
	x.mu.Unlock()
	x.changed()
	return nil
}

// URLBacklinks are the notes and pages citing url.
func (s Service) URLBacklinks(ctx context.Context, url string) ([]Backlink, error) {
	x := s.x
	if err := x.Ready(ctx); err != nil {
		return nil, err
	}
	key, ok := NormalizeURL(url)
	if !ok {
		return nil, nil
	}
	x.mu.RLock()
	var out []Backlink
	for display, cites := range x.noteURLs {
		if ms := cites[key]; len(ms) > 0 {
			abs := ""
			if f := x.files[display]; f != nil {
				abs = f.abs
			}
			out = append(out, Backlink{Path: abs, Display: display, Mentions: append([]Mention(nil), ms...)})
		}
	}
	for _, p := range x.pages {
		if ms := p.cites[key]; len(ms) > 0 {
			display := p.title
			display = cmp.Or(display, p.url)
			out = append(out, Backlink{URL: p.url, Display: display, Mentions: append([]Mention(nil), ms...)})
		}
	}
	x.mu.RUnlock()
	sort.SliceStable(out, func(i, j int) bool { return clifmt.Less(out[i].Display, out[j].Display) })
	return out, nil
}

// citeNote records the URLs the note at display cites. Called with mu
// held.
func (x *Cache) citeNote(display string, m *mdmeta.Metadata) {
	if m == nil || len(m.URLs) == 0 {
		delete(x.noteURLs, display)
		return
	}
	x.noteURLs[display] = citations(m)
}

// webPage is a submitted web page: its article's citations by URL.
type webPage struct {
	url, title string
	cites      map[string][]Mention
}

// citations are m's http(s) addresses by key, each where it is.
func citations(m *mdmeta.Metadata) map[string][]Mention {
	out := map[string][]Mention{}
	for _, l := range m.URLs {
		key, ok := NormalizeURL(l.Link)
		if !ok {
			continue
		}
		out[key] = append(out[key], Mention{Line: l.Position.Start.Line, Col: l.Position.Start.Col,
			Len: l.Position.End.Offset - l.Position.Start.Offset, Text: l.Source.Text})
	}
	return out
}
