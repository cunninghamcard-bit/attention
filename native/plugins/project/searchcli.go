package project

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"

	"github.com/cunninghamcard-bit/attention/native/actionsapi"
	contract "github.com/cunninghamcard-bit/attention/native/contract/project"
	"github.com/cunninghamcard-bit/attention/native/internal/clipath"
)

// cliTokenRe is the tokenizer in searchCli.ts plainWords.
var cliTokenRe = regexp.MustCompile(`(\[[^\]]+\])|(\w+):(?:\([^)]*\)|"[^"]*"|\S*)|"([^"]*)"|(\S+)`)

// The CLI's search and search:context (apps/web/app/cli/commands/searchCli.ts),
// the project's: they run headless too, where no Search panel is loaded.
// search:open, which shows the panel, is the search plugin's.

// searcher is what the commands need of the project.
type searcher interface {
	Mounts(ctx context.Context) ([]contract.Mount, error)
	Search(ctx context.Context, q contract.Query) (contract.SearchResult, error)
	Files(ctx context.Context) (contract.Listing, error)
}

// searchCLI runs the search commands over a project.
type searchCLI struct{ project searcher }

// cliSearch is `search query=<text> [path=<folder>] [limit=<n>] [total] [case] [format=text|json]`.
func (c searchCLI) cliSearch(ctx context.Context, a actionsapi.Args) (string, error) {
	query := a.Params["query"]
	if query == "" {
		return "", fmt.Errorf("Missing required parameter: query")
	}
	results, err := c.searchVault(ctx, query, a.Params["path"], a.Cwd, a.Has("case"))
	if err != nil {
		return "", err
	}
	// total counts matched files and ignores limit.
	if a.Has("total") {
		if a.Params["format"] == "json" {
			return encodeJSON(struct {
				Total int `json:"total"`
			}{len(results)})
		}
		return strconv.Itoa(len(results)), nil
	}
	// The empty check precedes the format check: json also gets this text.
	if len(results) == 0 {
		return "No matches found.", nil
	}
	n := limitN(a)
	if n > 0 && n < len(results) {
		results = results[:n]
	}
	paths := make([]string, len(results))
	for i, r := range results {
		paths[i] = r.File
	}
	if a.Params["format"] == "json" {
		return encodeJSON(paths)
	}
	return strings.Join(paths, "\n"), nil
}

// cliSearchContext is `search:context query=<text> [path=<folder>] [limit=<n>] [case] [format=text|json]`.
func (c searchCLI) cliSearchContext(ctx context.Context, a actionsapi.Args) (string, error) {
	query := a.Params["query"]
	if query == "" {
		return "", fmt.Errorf("Missing required parameter: query")
	}
	results, err := c.searchVault(ctx, query, a.Params["path"], a.Cwd, a.Has("case"))
	if err != nil {
		return "", err
	}
	if len(results) == 0 {
		return "No matches found.", nil
	}
	// limit caps file entries, not match lines.
	n := limitN(a)
	if n > 0 && n < len(results) {
		results = results[:n]
	}
	if a.Params["format"] == "json" {
		return encodeJSON(results)
	}
	var lines []string
	for _, r := range results {
		// A match without content offsets (e.g. filename-only) is a bare path line.
		if len(r.Matches) == 0 {
			lines = append(lines, r.File)
			continue
		}
		for _, m := range r.Matches {
			lines = append(lines, fmt.Sprintf("%s:%d: %s", r.File, m.Line, m.Text))
		}
	}
	return strings.Join(lines, "\n"), nil
}

// searchVault is the TS helper of the same name: the engine's hits, reordered
// by the project listing, plus filename-only rows for plain words in the name.
func (c searchCLI) searchVault(ctx context.Context, query, folder, cwd string, caseSensitive bool) ([]cliResult, error) {
	mounts, err := c.project.Mounts(ctx)
	if err != nil {
		return nil, err
	}
	prefix := folderPrefix(mounts, folder, cwd)
	res, err := c.project.Search(ctx, contract.Query{
		Text: query, CaseSensitive: caseSensitive, PathPrefix: prefix,
	})
	if err != nil {
		return nil, err
	}
	listing, err := c.project.Files(ctx)
	if err != nil {
		return nil, err
	}
	byID := make(map[string]contract.Mount, len(mounts))
	for _, m := range mounts {
		byID[m.ID] = m
	}
	byPath := make(map[string]contract.FileResult, len(res.Files))
	for _, f := range res.Files {
		byPath[f.Path] = f
	}
	fold := func(text string) string {
		if caseSensitive {
			return text
		}
		return strings.ToLower(text)
	}
	words := plainWords(fold(strings.TrimSpace(query)))
	var out []cliResult
	for _, f := range listing.Files {
		shown := f.Rel
		if m, ok := byID[f.Mount]; ok {
			shown = contract.Display(m, f.Rel)
		}
		if !strings.EqualFold(path.Ext(f.Rel), ".md") {
			continue
		}
		if prefix != "" && !strings.HasPrefix(shown, prefix) {
			continue
		}
		if hit, ok := byPath[f.Path]; ok {
			out = append(out, formatHit(shown, hit))
			continue
		}
		if len(words) > 0 && allContain(fold(path.Base(f.Rel)), words) {
			out = append(out, cliResult{File: shown, Matches: []cliMatch{}})
		}
	}
	return out, nil
}

// searchCommands are search and search:context.
func (s *Service) searchCommands() []actionsapi.Command {
	c := searchCLI{s}
	return []actionsapi.Command{
		{ID: "search", CLI: true, Run: c.cliSearch},
		{ID: "search:context", CLI: true, Run: c.cliSearchContext},
	}
}

// cliResult is CliSearchResult: a file and its matches for the CLI.
type cliResult struct {
	File    string     `json:"file"`
	Matches []cliMatch `json:"matches"`
}

func formatHit(shown string, f contract.FileResult) cliResult {
	matches := make([]cliMatch, 0, len(f.Matches))
	for _, m := range f.Matches {
		matches = append(matches, cliMatch{Line: m.Line, Text: strings.TrimSpace(m.Text)})
	}
	return cliResult{File: shown, Matches: matches}
}

// cliMatch is CliSearchMatch: 1-based line, trimmed text.
type cliMatch struct {
	Line int    `json:"line"`
	Text string `json:"text"`
}

func allContain(name string, words []string) bool {
	for _, w := range words {
		if !strings.Contains(name, w) {
			return false
		}
	}
	return true
}

// folderPrefix is path=: a display-path folder prefix with a trailing slash,
// so "Folder" does not match "Folder2". When the folder exists, it is
// resolved through clipath.Candidates; otherwise the token is used as-is.
func folderPrefix(mounts []contract.Mount, target, cwd string) string {
	if target == "" {
		return ""
	}
	for _, p := range clipath.Candidates(mounts, target, cwd) {
		st, err := os.Stat(p)
		if err != nil || !st.IsDir() {
			continue
		}
		p = filepath.Clean(p)
		for _, m := range mounts {
			root := filepath.Clean(m.Path)
			if p == root {
				return m.Name + "/"
			}
			rel, err := filepath.Rel(root, p)
			if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
				continue
			}
			shown := contract.Display(m, filepath.ToSlash(rel))
			if !strings.HasSuffix(shown, "/") {
				shown += "/"
			}
			return shown
		}
	}
	if !strings.HasSuffix(target, "/") {
		return target + "/"
	}
	return target
}

// plainWords is searchCli.ts's helper: `[property]` and known `operator:`
// tokens are not words; an unknown prefix stays a plain word.
func plainWords(query string) []string {
	operators := map[string]bool{
		"path": true, "file": true, "tag": true, "line": true, "section": true, "ext": true,
	}
	var words []string
	for _, m := range cliTokenRe.FindAllStringSubmatch(query, -1) {
		full, property, operator, quoted, plain := m[0], m[1], m[2], m[3], m[4]
		if property != "" {
			continue
		}
		if operator != "" {
			if !operators[operator] {
				words = append(words, full)
			}
			continue
		}
		word := quoted
		if word == "" {
			word = plain
		}
		if word != "" {
			words = append(words, word)
		}
	}
	return words
}

func limitN(a actionsapi.Args) int {
	v := a.Params["limit"]
	if v == "" {
		return 0
	}
	n, _ := strconv.Atoi(v)
	return n
}

func encodeJSON(v any) (string, error) {
	var b strings.Builder
	enc := json.NewEncoder(&b)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		return "", err
	}
	return strings.TrimSuffix(b.String(), "\n"), nil
}
