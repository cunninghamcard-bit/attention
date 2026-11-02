package project

import (
	"context"
	"fmt"
	"os"
	"path"
	"regexp"
	"sort"
	"strings"
	"sync"

	"github.com/cunninghamcard-bit/attention/native/internal/natural"
)

// This file is apps/web/search/SearchEngine.ts, ported: Obsidian's search
// operators (path:, file:, tag:, line:, section:, [property], ext:, plugin
// operators), plain and quoted words, every text file.

var (
	// searchableExtensions is SEARCHABLE_EXTENSIONS: md and canvas plus
	// CODE_EXTENSIONS (apps/web/views/CodeFileView.ts); "" is a file without an
	// extension (Dockerfile, Makefile, dotfiles).
	searchableExtensions = func() map[string]bool {
		m := map[string]bool{}
		for _, e := range []string{"md", "canvas",
			"ts", "tsx", "js", "jsx", "mjs", "cjs", "go", "py", "rs", "java", "kt", "swift", "rb", "php", "lua",
			"c", "h", "cc", "cpp", "hpp", "cs", "sh", "bash", "zsh", "fish", "json", "jsonc", "yaml", "yml",
			"toml", "xml", "css", "scss", "less", "html", "vue", "svelte", "sql", "graphql", "proto",
			"dockerfile", "txt", "log", "csv", "ini", "conf", "base", ""} {
			m[e] = true
		}
		return m
	}()

	builtinOperators = map[string]bool{"path": true, "file": true, "tag": true, "line": true, "section": true}

	tokenPattern = regexp.MustCompile(`\[([^\]]+)\]|(\w+):(?:\(([^)]*)\)|"([^"]*)"|(\S*))|"([^"]*)"|(\S+)`)
)

// Meta is what the metadata cache knows of a file: its tags (without "#"),
// frontmatter and heading lines. The metadata index is roadmap P2; until it
// exists metaFor returns none, so tag:, [property] and section: behave as
// for a file without metadata.
type Meta struct {
	Tags        []string
	Frontmatter map[string]any
	Headings    []int // 0-based lines
}

// Operator is SearchOperatorDefinition: a plugin's own file filter.
type Operator struct {
	Name, Token, Description string
	Filter                   func(f FileRef, value string) bool
}

// Engine is SearchEngine.
type Engine struct {
	mu        sync.Mutex
	operators map[string]Operator
	metaFor   func(f FileRef) Meta
}

// NewEngine registers ext:, as the TS constructor does.
func NewEngine(meta func(FileRef) Meta) *Engine {
	if meta == nil {
		meta = func(FileRef) Meta { return Meta{} }
	}
	e := &Engine{operators: map[string]Operator{}, metaFor: meta}
	_ = e.RegisterOperator(Operator{Name: "ext", Token: "ext:", Description: "match file extension",
		Filter: func(f FileRef, value string) bool {
			return extension(path.Base(f.Rel)) == strings.TrimPrefix(value, ".")
		}})
	return e
}

// RegisterOperator adds a plugin operator; a built-in or taken name fails.
func (e *Engine) RegisterOperator(op Operator) error {
	e.mu.Lock()
	defer e.mu.Unlock()
	if builtinOperators[op.Name] || e.operators[op.Name].Filter != nil {
		return fmt.Errorf("Search operator %q is already registered", op.Name)
	}
	e.operators[op.Name] = op
	return nil
}

// UnregisterOperator removes a plugin operator.
func (e *Engine) UnregisterOperator(name string) {
	e.mu.Lock()
	defer e.mu.Unlock()
	delete(e.operators, name)
}

// Search is SearchEngine.search over a file listing: the files passing the
// filters, with their matches when the query has content terms. Results
// are sorted by display path naturally.
func (e *Engine) Search(ctx context.Context, files []FileRef, display func(FileRef) string, q Query) ([]FileResult, error) {
	raw := strings.TrimSpace(q.Text)
	if raw == "" {
		return nil, nil
	}
	fold := func(s string) string {
		if q.CaseSensitive {
			return s
		}
		return strings.ToLower(s)
	}
	parsed := e.parse(fold(raw))
	if parsed.empty() {
		return nil, nil
	}
	hasContent := len(parsed.words)+len(parsed.lineGroups)+len(parsed.sectionGroups) > 0
	var results []FileResult
	for _, f := range files {
		if ctx.Err() != nil {
			return results, ctx.Err()
		}
		name := path.Base(f.Rel)
		if !searchableExtensions[extension(name)] {
			continue
		}
		shown := display(f)
		if q.PathPrefix != "" && !strings.HasPrefix(shown, q.PathPrefix) {
			continue
		}
		if !e.passesFileFilters(f, shown, name, parsed, fold) {
			continue
		}
		st, err := os.Stat(f.Path)
		if err != nil {
			continue
		}
		mtime := st.ModTime().UnixNano()
		if !hasContent {
			results = append(results, FileResult{Mount: f.Mount, Rel: f.Rel, Path: f.Path, ModTime: mtime})
			if q.Limit > 0 && len(results) >= q.Limit {
				break
			}
			continue
		}
		if st.Size() > maxSearchSize {
			continue
		}
		data, err := os.ReadFile(f.Path)
		if err != nil {
			continue
		}
		lines := splitLines(string(data))
		haystacks := make([]string, len(lines))
		for i, l := range lines {
			haystacks[i] = fold(l)
		}
		if matches, ok := e.matchContent(f, lines, haystacks, parsed); ok {
			results = append(results, FileResult{Mount: f.Mount, Rel: f.Rel, Path: f.Path, ModTime: mtime, Matches: matches})
		}
		if q.Limit > 0 && len(results) >= q.Limit {
			break
		}
	}
	sort.SliceStable(results, func(i, j int) bool {
		return natural.Less(display(FileRef{Mount: results[i].Mount, Rel: results[i].Rel}),
			display(FileRef{Mount: results[j].Mount, Rel: results[j].Rel}))
	})
	return results, nil
}

// parse is parseSearchQuery.
func (e *Engine) parse(query string) parsedQuery {
	e.mu.Lock()
	registered := func(name string) bool { _, ok := e.operators[name]; return ok }
	defer e.mu.Unlock()
	var p parsedQuery
	for _, m := range tokenPattern.FindAllStringSubmatchIndex(query, -1) {
		group := func(i int) (string, bool) {
			if m[2*i] < 0 {
				return "", false
			}
			return query[m[2*i]:m[2*i+1]], true
		}
		full, _ := group(0)
		if property, ok := group(1); ok {
			if k, v, has := strings.Cut(property, ":"); has {
				val := strings.TrimSpace(v)
				p.propertyTerms = append(p.propertyTerms, propertyTerm{strings.TrimSpace(k), &val})
			} else {
				p.propertyTerms = append(p.propertyTerms, propertyTerm{strings.TrimSpace(property), nil})
			}
			continue
		}
		if operator, ok := group(2); ok {
			if !builtinOperators[operator] && !registered(operator) {
				// "release:notes" with no such operator is a plain keyword.
				p.words = append(p.words, full)
				continue
			}
			value := ""
			for _, i := range []int{3, 4, 5} {
				if v, ok := group(i); ok {
					value = v
					break
				}
			}
			words := strings.Fields(value)
			if len(words) == 0 {
				continue
			}
			switch operator {
			case "path":
				p.pathTerms = append(p.pathTerms, strings.TrimSpace(value))
			case "file":
				p.fileTerms = append(p.fileTerms, strings.TrimSpace(value))
			case "tag":
				for _, w := range words {
					p.tagTerms = append(p.tagTerms, strings.TrimPrefix(w, "#"))
				}
			case "line":
				p.lineGroups = append(p.lineGroups, words)
			case "section":
				p.sectionGroups = append(p.sectionGroups, words)
			default:
				p.customTerms = append(p.customTerms, customTerm{operator, strings.TrimSpace(value)})
			}
			continue
		}
		if w, ok := group(6); ok && w != "" {
			p.words = append(p.words, w)
		} else if w, ok := group(7); ok && w != "" {
			p.words = append(p.words, w)
		}
	}
	return p
}

func (e *Engine) passesFileFilters(f FileRef, shown, name string, p parsedQuery, fold func(string) string) bool {
	for _, t := range p.pathTerms {
		if !strings.Contains(fold(shown), t) {
			return false
		}
	}
	for _, t := range p.fileTerms {
		if !strings.Contains(fold(name), t) {
			return false
		}
	}
	if len(p.tagTerms) > 0 || len(p.propertyTerms) > 0 {
		meta := e.metaFor(f)
		for _, t := range p.tagTerms {
			found := false
			for _, tag := range meta.Tags {
				tag = fold(strings.TrimPrefix(tag, "#"))
				if tag == t || strings.HasPrefix(tag, t+"/") {
					found = true
					break
				}
			}
			if !found {
				return false
			}
		}
		keys := map[string]string{}
		for k := range meta.Frontmatter {
			keys[fold(k)] = k
		}
		for _, pt := range p.propertyTerms {
			real, ok := keys[pt.key]
			if !ok {
				return false
			}
			if pt.value != nil && !strings.Contains(fold(fmt.Sprint(meta.Frontmatter[real])), *pt.value) {
				return false
			}
		}
	}
	e.mu.Lock()
	ops := e.operators
	e.mu.Unlock()
	for _, ct := range p.customTerms {
		if op, ok := ops[ct.operator]; ok && !op.Filter(f, ct.value) {
			return false
		}
	}
	return true
}

func (e *Engine) matchContent(f FileRef, lines, haystacks []string, p parsedQuery) ([]Match, bool) {
	var matches []Match
	for _, w := range p.words {
		found := collect(lines, haystacks, w, 0, len(haystacks))
		if len(found) == 0 {
			return nil, false
		}
		matches = append(matches, found...)
	}
	for _, group := range p.lineGroups {
		satisfied := false
		for i, h := range haystacks {
			all := true
			for _, w := range group {
				if !strings.Contains(h, w) {
					all = false
					break
				}
			}
			if !all {
				continue
			}
			satisfied = true
			for _, w := range group {
				matches = append(matches, collect(lines, haystacks, w, i, i+1)...)
			}
		}
		if !satisfied {
			return nil, false
		}
	}
	if len(p.sectionGroups) > 0 {
		sections := sectionRanges(e.metaFor(f).Headings, len(haystacks))
		for _, group := range p.sectionGroups {
			satisfied := false
			for _, r := range sections {
				all := true
				for _, w := range group {
					in := false
					for _, h := range haystacks[r[0]:r[1]] {
						if strings.Contains(h, w) {
							in = true
							break
						}
					}
					if !in {
						all = false
						break
					}
				}
				if !all {
					continue
				}
				satisfied = true
				for _, w := range group {
					matches = append(matches, collect(lines, haystacks, w, r[0], r[1])...)
				}
			}
			if !satisfied {
				return nil, false
			}
		}
	}
	sort.SliceStable(matches, func(i, j int) bool {
		if matches[i].Line != matches[j].Line {
			return matches[i].Line < matches[j].Line
		}
		return matches[i].Col < matches[j].Col
	})
	return dedupe(matches), true
}

type propertyTerm struct {
	key   string
	value *string
}

type customTerm struct{ operator, value string }

type parsedQuery struct {
	words, pathTerms, fileTerms, tagTerms []string
	propertyTerms                         []propertyTerm
	lineGroups, sectionGroups             [][]string
	customTerms                           []customTerm
}

func (p parsedQuery) empty() bool {
	return len(p.words)+len(p.pathTerms)+len(p.fileTerms)+len(p.tagTerms)+len(p.propertyTerms)+
		len(p.lineGroups)+len(p.sectionGroups)+len(p.customTerms) == 0
}

// extension is TFile.extension: after the last dot of the name, without a
// leading dot counting (".env" has none).
func extension(name string) string {
	i := strings.LastIndexByte(name, '.')
	if i <= 0 {
		return ""
	}
	return strings.ToLower(name[i+1:])
}

// splitLines is source.split(/\r?\n/).
func splitLines(s string) []string {
	lines := strings.Split(s, "\n")
	for i, l := range lines {
		lines[i] = strings.TrimSuffix(l, "\r")
	}
	return lines
}

// sectionRanges is sectionRangesOf: one range before the first heading and
// one per heading; the whole file without headings.
func sectionRanges(starts []int, lineCount int) [][2]int {
	if len(starts) == 0 {
		return [][2]int{{0, lineCount}}
	}
	var out [][2]int
	if starts[0] > 0 {
		out = append(out, [2]int{0, starts[0]})
	}
	for i, s := range starts {
		end := lineCount
		if i+1 < len(starts) {
			end = starts[i+1]
		}
		out = append(out, [2]int{s, end})
	}
	return out
}

// collect is collectWordMatches. Lines are reported 1-based and columns in
// bytes, as Match has them.
func collect(lines, haystacks []string, word string, from, to int) []Match {
	var out []Match
	for i := from; i < to; i++ {
		h := haystacks[i]
		for cursor := 0; cursor <= len(h); {
			at := strings.Index(h[cursor:], word)
			if at < 0 {
				break
			}
			start := cursor + at
			text := lines[i]
			if len(text) > maxLineBytes {
				text = text[:maxLineBytes]
			}
			out = append(out, Match{Line: i + 1, Col: start + 1, Len: len(word), Text: text})
			cursor = max(start+len(word), start+1)
		}
	}
	return out
}

func dedupe(ms []Match) []Match {
	seen := map[[3]int]bool{}
	out := ms[:0]
	for _, m := range ms {
		k := [3]int{m.Line, m.Col, m.Len}
		if !seen[k] {
			seen[k] = true
			out = append(out, m)
		}
	}
	return out
}
