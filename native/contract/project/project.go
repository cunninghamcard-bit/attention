// Package project is the contract of the project service (RFC 0001 §5.7):
// the mounted roots — Zed's worktrees — that replace the vault.
package project

import "context"

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

// Display is how the CLI and quick open show a file: "<mount name>/<rel>".
func Display(m Mount, rel string) string { return m.Name + "/" + rel }

// Listing is a walk of every mount's files.
type Listing struct {
	Files []FileRef `json:"files"`
	// Truncated says the walk stopped at its file or time limit.
	Truncated bool `json:"truncated"`
}

// Query is a project search.
type Query struct {
	Text          string `json:"text"`
	Regex         bool   `json:"regex"`
	CaseSensitive bool   `json:"caseSensitive"`
	Limit         int    `json:"limit"`
}

// Match is one matching line.
type Match struct {
	Mount string `json:"mount"`
	Rel   string `json:"rel"`
	Path  string `json:"path"`
	Line  int    `json:"line"` // 1-based
	Col   int    `json:"col"`  // 1-based, in bytes
	Len   int    `json:"len"`  // bytes matched
	Text  string `json:"text"` // the line, trimmed to 400 bytes
}

// SearchResult is a search's matches.
type SearchResult struct {
	Matches   []Match `json:"matches"`
	Files     int     `json:"files"` // files searched
	Truncated bool    `json:"truncated"`
}

// MountsChangedEvent is emitted when a mount is added or removed.
const MountsChangedEvent = "project/mounts-changed"

// Project is the client side of the service.
type Project struct {
	Mounts      func(ctx context.Context) ([]Mount, error)
	AddMount    func(ctx context.Context, path string) (Mount, error)
	RemoveMount func(ctx context.Context, id string) error
	Files       func(ctx context.Context) (Listing, error)
	Search      func(ctx context.Context, q Query) (SearchResult, error)
}
