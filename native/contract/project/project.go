// Package project is the contract of the project service (RFC 0001 §5.7):
// the mounted roots — Zed's worktrees — that replace the vault.
package project

import "context"

// MountsChangedEvent is emitted when a mount is added or removed.
const MountsChangedEvent = "project/mounts-changed"

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

// Display is how the CLI and quick open show a file: "<mount name>/<rel>".
func Display(m Mount, rel string) string { return m.Name + "/" + rel }
