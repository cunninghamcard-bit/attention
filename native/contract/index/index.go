// Package index is the index service's contract (RFC 0001 §5.6): what the
// backlinks and outline panels, and other plugins, ask of the metadata
// cache. Paths are absolute; a note's display path is the CLI's.
package index

import (
	"context"
	"net/url"
	"strings"
)

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

// ChangedEvent is emitted after the index changed (built, or files came,
// went or changed), with no arguments.
const ChangedEvent = "index/changed"

// Index is the client side of the service.
type Index struct {
	// Backlinks are the notes linking to path, sorted by display path.
	Backlinks func(ctx context.Context, path string) ([]Backlink, error)
	// URLBacklinks are the notes and web pages citing url (NormalizeURL),
	// sorted by display: the link graph across resource types (RFC §5.6).
	URLBacklinks func(ctx context.Context, url string) ([]Backlink, error)
	// SubmitPage indexes a web page's article, replacing what it had for
	// the same URL (the web-index plugin's).
	SubmitPage func(ctx context.Context, page Page) error
	// RemovePages drops the web pages of urls, every page for none.
	RemovePages func(ctx context.Context, urls []string) error
	// Headings are path's headings in order; none for a file not a note.
	Headings func(ctx context.Context, path string) ([]Heading, error)
	// Generation changes whenever the index does.
	Generation func(ctx context.Context) (int, error)
}

// Page is a web page's article as the index takes it.
type Page struct {
	URL      string `json:"url"`
	Title    string `json:"title"`
	Markdown string `json:"markdown"`
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
	if u.Path == "" {
		u.Path = "/"
	}
	return u.String(), true
}
