// Package index is the index service's contract (RFC 0001 §5.6): what the
// backlinks and outline panels, and other plugins, ask of the metadata
// cache. Paths are absolute; a note's display path is the CLI's.
package index

import "context"

// Mention is one link from a source note to the asked file, with its line
// for context (the backlinks pane's match).
type Mention struct {
	Line int    `json:"line"` // 0-based
	Col  int    `json:"col"`  // bytes, within the line
	Len  int    `json:"len"`
	Text string `json:"text"` // the line
}

// Backlink is a note linking to the asked file.
type Backlink struct {
	Path     string    `json:"path"`    // absolute
	Display  string    `json:"display"` // "<mount>/<rel>"
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
	// Headings are path's headings in order; none for a file not a note.
	Headings func(ctx context.Context, path string) ([]Heading, error)
	// Generation changes whenever the index does.
	Generation func(ctx context.Context) (int, error)
}
