package index

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"unicode/utf16"

	"github.com/cunninghamcard-bit/attention/native/actionsapi"
	"github.com/cunninghamcard-bit/attention/native/internal/clifmt"
	"github.com/cunninghamcard-bit/attention/native/internal/clipath"
	"github.com/cunninghamcard-bit/attention/native/internal/mdmeta"
	"github.com/cunninghamcard-bit/attention/native/shellapi"
	"github.com/cunninghamcard-bit/attention/native/workspaceapi"
)

// commands are the CLI's commands on the index, ported from attention's
// (apps/web/app/cli/commands/): graphLists.ts, metadata.ts (the reading
// ones), linksOutlineCli.ts, wordcountWebCli.ts.
func (x *Index) commands() []actionsapi.Command {
	// Each takes the bare flags its TS registration declares.
	cmd := func(id string, run func(context.Context, actionsapi.Args) (string, error), flags ...string) actionsapi.Command {
		return actionsapi.Command{ID: id, CLI: true, Flags: flags, Run: func(ctx context.Context, a actionsapi.Args) (string, error) {
			if err := x.Ready(ctx); err != nil {
				return "", err
			}
			return run(ctx, a)
		}}
	}
	return []actionsapi.Command{
		cmd("backlinks", x.cliBacklinks, "counts", "total"),
		cmd("unresolved", x.cliUnresolved, "total", "counts", "verbose"),
		cmd("orphans", x.cliOrphans, "total", "all"),
		cmd("deadends", x.cliDeadends, "total", "all"),
		cmd("links", x.cliLinks, "total"),
		cmd("outline", x.cliOutline, "total"),
		cmd("tags", x.cliTags, "total", "counts", "active"),
		cmd("tag", x.cliTag, "total", "verbose"),
		cmd("properties", x.cliProperties, "total", "counts", "active"),
		cmd("property:read", x.cliPropertyRead),
		cmd("aliases", x.cliAliases, "total", "verbose", "active"),
		cmd("wordcount", x.cliWordcount, "words", "characters"),
	}
}

// resolveFile is Cli.tryResolveFile: path= exactly, file= as a link (from
// no source), else the active file; the result is a display path.
func (x *Index) resolveFile(ctx context.Context, a actionsapi.Args, activeFallback bool) (string, error) {
	if p := a.Params["path"]; p != "" {
		x.mu.RLock()
		_, known := x.files[p]
		mounts := x.mounts
		x.mu.RUnlock()
		if known {
			return p, nil
		}
		abs, err := clipath.Path(mounts, p, a.Cwd)
		if err != nil {
			return "", err
		}
		return x.displayOf(abs, p)
	}
	if f := a.Params["file"]; f != "" {
		x.mu.RLock()
		dest, ok := x.look.first(f, "", x.isMD)
		x.mu.RUnlock()
		if !ok {
			return "", fmt.Errorf("File %q not found.", f)
		}
		return dest, nil
	}
	if !activeFallback {
		return "", fmt.Errorf("Missing required parameter: file or path")
	}
	active, _ := shellapi.OnMain(ctx, func() (string, error) {
		if ws := workspaceapi.Get(); ws != nil {
			return ws.ActivePath(), nil
		}
		return "", nil
	})
	if active == "" {
		return "", fmt.Errorf("No active file. Use file=<name> or path=<path> to specify a file.")
	}
	return x.displayOf(active, active)
}

// displayOf is an absolute path's display path, if indexed.
func (x *Index) displayOf(abs, asked string) (string, error) {
	x.mu.RLock()
	defer x.mu.RUnlock()
	if d, ok := x.byAbs[abs]; ok {
		return d, nil
	}
	return "", fmt.Errorf("File %q not found.", asked)
}

// meta is a note's metadata, nil for none.
func (x *Index) meta(path string) *mdmeta.Metadata {
	x.mu.RLock()
	defer x.mu.RUnlock()
	if f, ok := x.files[path]; ok {
		return f.meta
	}
	return nil
}

// cliBacklinks is backlinks: the sources linking to the file, total the
// SUM of their links (graphLists.ts).
func (x *Index) cliBacklinks(ctx context.Context, a actionsapi.Args) (string, error) {
	target, err := x.resolveFile(ctx, a, true)
	if err != nil {
		return "", err
	}
	type entry struct {
		path  string
		count int
	}
	var entries []entry
	x.mu.RLock()
	for src, targets := range x.resolved {
		if n, ok := targets[target]; ok {
			entries = append(entries, entry{src, n})
		}
	}
	x.mu.RUnlock()
	if a.Has("total") {
		sum := 0
		for _, e := range entries {
			sum += e.count
		}
		return strconv.Itoa(sum), nil
	}
	if len(entries) == 0 {
		return "No backlinks found.", nil
	}
	sort.SliceStable(entries, func(i, j int) bool { return clifmt.Less(entries[i].path, entries[j].path) })
	header := []string{"file"}
	if a.Has("counts") {
		header = append(header, "count")
	}
	rows := make([][]string, len(entries))
	for i, e := range entries {
		rows[i] = []string{e.path, strconv.Itoa(e.count)}
	}
	return clifmt.Table(header, rows, a.Params["format"]), nil
}

// cliUnresolved is unresolved: link texts no file answers, total the
// number of DISTINCT texts; verbose wins over counts (graphLists.ts).
func (x *Index) cliUnresolved(_ context.Context, a actionsapi.Args) (string, error) {
	type entry struct {
		sources []string
		count   int
	}
	byLink := map[string]*entry{}
	x.mu.RLock()
	srcs := make([]string, 0, len(x.unresolved))
	for src := range x.unresolved {
		srcs = append(srcs, src)
	}
	clifmt.Sort(srcs) // the TS's insertion order has no Go analogue: a stable one
	for _, src := range srcs {
		for link, n := range x.unresolved[src] {
			e := byLink[link]
			if e == nil {
				e = &entry{}
				byLink[link] = e
			}
			e.sources = append(e.sources, src)
			e.count += n
		}
	}
	x.mu.RUnlock()
	if a.Has("total") {
		return strconv.Itoa(len(byLink)), nil
	}
	if len(byLink) == 0 {
		return "No unresolved links found.", nil
	}
	links := make([]string, 0, len(byLink))
	for l := range byLink {
		links = append(links, l)
	}
	clifmt.Sort(links)
	header := []string{"link"}
	switch {
	case a.Has("verbose"):
		header = []string{"link", "count", "sources"}
	case a.Has("counts"):
		header = []string{"link", "count"}
	}
	rows := make([][]string, len(links))
	for i, l := range links {
		e := byLink[l]
		rows[i] = []string{l, strconv.Itoa(e.count), strings.Join(e.sources, ", ")}
	}
	return clifmt.Table(header, rows, a.Params["format"]), nil
}

// allPaths are the indexed files' paths, sorted.
func (x *Index) allPaths(keep func(path string) bool) []string {
	x.mu.RLock()
	defer x.mu.RUnlock()
	var out []string
	for p := range x.files {
		if keep(p) {
			out = append(out, p)
		}
	}
	clifmt.Sort(out)
	return out
}

// cliOrphans is orphans: every file no note links to (graphLists.ts;
// all is declared and, as there, ignored).
func (x *Index) cliOrphans(_ context.Context, a actionsapi.Args) (string, error) {
	x.mu.RLock()
	targets := map[string]bool{}
	for _, ts := range x.resolved {
		for t := range ts {
			targets[t] = true
		}
	}
	x.mu.RUnlock()
	out := x.allPaths(func(p string) bool { return !targets[p] })
	if a.Has("total") {
		return strconv.Itoa(len(out)), nil
	}
	if len(out) == 0 {
		return "No orphan files found.", nil
	}
	return strings.Join(out, "\n"), nil
}

// cliDeadends is deadends: every file with no RESOLVED outgoing link.
func (x *Index) cliDeadends(_ context.Context, a actionsapi.Args) (string, error) {
	out := x.allPaths(func(p string) bool { return len(x.resolved[p]) == 0 })
	if a.Has("total") {
		return strconv.Itoa(len(out)), nil
	}
	if len(out) == 0 {
		return "No dead-end files found.", nil
	}
	return strings.Join(out, "\n"), nil
}

// cliLinks is links: the file's frontmatter links, links and embeds,
// resolved from it or marked unresolved, distinct, sorted
// (linksOutlineCli.ts).
func (x *Index) cliLinks(ctx context.Context, a actionsapi.Args) (string, error) {
	path, err := x.resolveFile(ctx, a, true)
	if err != nil {
		return "", err
	}
	m := x.meta(path)
	if m == nil {
		return "No links found.", nil
	}
	seen := map[string]bool{}
	x.mu.RLock()
	for _, link := range refs(m) {
		lp := mdmeta.SplitLinkpath(link).Path
		if dest, ok := x.look.first(lp, path, x.isMD); ok {
			seen[dest] = true
		} else {
			seen[lp+" (unresolved)"] = true
		}
	}
	x.mu.RUnlock()
	if a.Has("total") {
		return strconv.Itoa(len(seen)), nil
	}
	if len(seen) == 0 {
		return "No links found.", nil
	}
	out := make([]string, 0, len(seen))
	for s := range seen {
		out = append(out, s)
	}
	sort.Strings(out) // a plain sort, as the TS's Array.sort
	return strings.Join(out, "\n"), nil
}

// cliOutline is outline: the note's headings as a tree, md or json; the
// empty check before total, as there (linksOutlineCli.ts).
func (x *Index) cliOutline(ctx context.Context, a actionsapi.Args) (string, error) {
	path, err := x.resolveFile(ctx, a, true)
	if err != nil {
		return "", err
	}
	if !isNote(path) {
		return "", fmt.Errorf("File is not a markdown file.")
	}
	m := x.meta(path)
	if m == nil || len(m.Headings) == 0 {
		return "No headings found.", nil
	}
	hs := m.Headings
	if a.Has("total") {
		return strconv.Itoa(len(hs)), nil
	}
	switch a.Params["format"] {
	case "json":
		type row struct {
			Level   int    `json:"level"`
			Heading string `json:"heading"`
			Line    int    `json:"line"`
		}
		rows := make([]row, len(hs))
		for i, h := range hs {
			rows[i] = row{h.Level, h.Heading, h.Position.Start.Line + 1}
		}
		return jsonIndent(rows), nil
	case "md":
		lines := make([]string, len(hs))
		for i, h := range hs {
			lines[i] = strings.Repeat("#", h.Level) + " " + h.Heading
		}
		return strings.Join(lines, "\n"), nil
	}
	// The tree: pop while the top's level is at least this one's, then
	// attach. Nodes by index, so appending moves none.
	type tnode struct {
		label    string
		children []int
	}
	var nodes []tnode
	var roots []int
	type frame struct{ node, level int }
	var stack []frame
	for _, h := range hs {
		nodes = append(nodes, tnode{label: h.Heading})
		i := len(nodes) - 1
		for len(stack) > 0 && stack[len(stack)-1].level >= h.Level {
			stack = stack[:len(stack)-1]
		}
		if len(stack) == 0 {
			roots = append(roots, i)
		} else {
			parent := stack[len(stack)-1].node
			nodes[parent].children = append(nodes[parent].children, i)
		}
		stack = append(stack, frame{i, h.Level})
	}
	var build func(ids []int) []clifmt.Node
	build = func(ids []int) []clifmt.Node {
		out := make([]clifmt.Node, len(ids))
		for k, id := range ids {
			out[k] = clifmt.Node{Label: nodes[id].label, Children: build(nodes[id].children)}
		}
		return out
	}
	return clifmt.Tree(build(roots), ""), nil
}

// fileTags are a note's tags (getAllTags).
func fileTags(m *mdmeta.Metadata) []string {
	if m == nil {
		return nil
	}
	return mdmeta.AllTags(*m)
}

// vaultTags is MetadataCache.getTags: every tag's count, a nested tag also
// counting toward its parents, casings merged under the one counted most.
func (x *Index) vaultTags() map[string]int {
	counts := map[string]int{}
	var count func(tag string)
	count = func(tag string) {
		tag = strings.TrimSuffix(tag, "/")
		if !validTag(tag) {
			return
		}
		counts[tag]++
		if i := strings.LastIndexByte(tag, '/'); i > 0 {
			count(tag[:i])
		}
	}
	x.mu.RLock()
	for _, f := range x.files {
		for _, t := range fileTags(f.meta) {
			count(t)
		}
	}
	x.mu.RUnlock()
	type merged struct {
		tag        string
		count, max int
	}
	byKey := map[string]*merged{}
	keys := make([]string, 0, len(counts))
	for t := range counts {
		keys = append(keys, t)
	}
	sort.Strings(keys) // ties go the same way every run
	for _, t := range keys {
		n := counts[t]
		k := strings.ToLower(t)
		e := byKey[k]
		if e == nil {
			byKey[k] = &merged{t, n, n}
			continue
		}
		e.count += n
		if n > e.max {
			e.max, e.tag = n, t
		}
	}
	out := make(map[string]int, len(byKey))
	for _, e := range byKey {
		out[e.tag] = e.count
	}
	return out
}

// validTag is isValidTag: "#" then no punctuation or space, not all
// digits.
func validTag(tag string) bool {
	if len(tag) < 2 || tag[0] != '#' {
		return false
	}
	digits := true
	for _, r := range tag[1:] {
		switch {
		case r >= 0x2000 && r <= 0x206F, r >= 0x2E00 && r <= 0x2E7F,
			strings.ContainsRune("'!\"#$%&()*+,.:;<=>?@^`{|}~[]\\", r), r == ' ' || r == '\t' || r == '\n' || r == '\r' || r == '\f' || r == '\v':
			return false
		}
		if r < '0' || r > '9' {
			digits = false
		}
	}
	return !digits
}

// cliTags is tags: the vault's tags, or one file's, sorted by name or
// count, as a table (metadata.ts).
func (x *Index) cliTags(ctx context.Context, a actionsapi.Args) (string, error) {
	var counts map[string]int
	if a.Has("active") || a.Params["file"] != "" || a.Params["path"] != "" {
		path, err := x.resolveFile(ctx, a, true)
		if err != nil {
			return "", err
		}
		counts = map[string]int{}
		for _, t := range fileTags(x.meta(path)) {
			counts[t]++
		}
	} else {
		counts = x.vaultTags()
	}
	if a.Has("total") {
		return strconv.Itoa(len(counts)), nil
	}
	if len(counts) == 0 {
		return "No tags found.", nil
	}
	tags := make([]string, 0, len(counts))
	for t := range counts {
		tags = append(tags, t)
	}
	if a.Params["sort"] == "count" {
		clifmt.Sort(tags)
		sort.SliceStable(tags, func(i, j int) bool { return counts[tags[i]] > counts[tags[j]] })
	} else {
		clifmt.Sort(tags)
	}
	header := []string{"tag"}
	if a.Has("counts") {
		header = append(header, "count")
	}
	rows := make([][]string, len(tags))
	for i, t := range tags {
		rows[i] = []string{t, strconv.Itoa(counts[t])}
	}
	return clifmt.Table(header, rows, a.Params["format"]), nil
}

// cliTag is tag name=<tag>: its count, or the notes holding it, matched
// without case (metadata.ts).
func (x *Index) cliTag(_ context.Context, a actionsapi.Args) (string, error) {
	name := a.Params["name"]
	if name == "" {
		return "", fmt.Errorf("Missing required parameter: name\nUsage: tag name=<tag>")
	}
	tag := name
	if !strings.HasPrefix(tag, "#") {
		tag = "#" + tag
	}
	count, ok := x.vaultTags()[tag]
	if !ok {
		return "", fmt.Errorf("Tag %q not found.", tag)
	}
	if a.Has("total") {
		return strconv.Itoa(count), nil
	}
	paths := x.allPaths(func(p string) bool {
		f := x.files[p]
		if !f.md {
			return false
		}
		for _, t := range fileTags(f.meta) {
			if strings.EqualFold(t, tag) {
				return true
			}
		}
		return false
	})
	if a.Has("verbose") {
		return tag + "\t" + strconv.Itoa(count) + "\n" + strings.Join(paths, "\n"), nil
	}
	return strings.Join(paths, "\n"), nil
}

// cliProperties is properties: one file's frontmatter (yaml, json, tsv),
// or the vault's property names with their counts (metadata.ts).
func (x *Index) cliProperties(ctx context.Context, a actionsapi.Args) (string, error) {
	if a.Has("active") || a.Params["file"] != "" || a.Params["path"] != "" {
		path, err := x.resolveFile(ctx, a, true)
		if err != nil {
			return "", err
		}
		m := x.meta(path)
		if m == nil || len(m.Frontmatter) == 0 {
			return "No frontmatter found.", nil
		}
		keys, err := x.frontmatterKeys(ctx, path, m)
		if err != nil {
			return "", err
		}
		switch a.Params["format"] {
		case "json":
			return jsonIndentOrdered(keys, m.Frontmatter), nil
		case "tsv":
			var lines []string
			for _, k := range keys {
				v := m.Frontmatter[k]
				if v == nil {
					continue
				}
				lines = append(lines, k+"\t"+valueText(v, ", "))
			}
			return strings.Join(lines, "\n"), nil
		}
		return yamlOf(keys, m.Frontmatter), nil
	}
	// The vault's properties, by lowercased name, first casing kept.
	type prop struct {
		name  string
		count int
	}
	all := map[string]*prop{}
	x.mu.RLock()
	for _, f := range x.files {
		if f.meta == nil {
			continue
		}
		for k := range f.meta.Frontmatter {
			lk := strings.ToLower(k)
			if all[lk] == nil {
				all[lk] = &prop{name: k}
			}
			all[lk].count++
		}
	}
	x.mu.RUnlock()
	if n := a.Params["name"]; n != "" {
		p := all[strings.ToLower(n)]
		if p == nil {
			return "", fmt.Errorf("Property %q not found.", n)
		}
		return strconv.Itoa(p.count), nil
	}
	list := make([]*prop, 0, len(all))
	for _, p := range all {
		list = append(list, p)
	}
	if a.Has("total") {
		return strconv.Itoa(len(list)), nil
	}
	sort.SliceStable(list, func(i, j int) bool { return clifmt.Less(list[i].name, list[j].name) })
	if a.Params["sort"] == "count" {
		sort.SliceStable(list, func(i, j int) bool { return list[i].count > list[j].count })
	}
	if a.Params["format"] == "json" {
		type row struct {
			Name  string `json:"name"`
			Type  string `json:"type"`
			Count int    `json:"count"`
		}
		rows := make([]row, len(list))
		for i, p := range list {
			rows[i] = row{p.name, "text", p.count}
		}
		return jsonIndent(rows), nil
	}
	lines := make([]string, len(list))
	for i, p := range list {
		lines[i] = p.name
		if a.Has("counts") {
			lines[i] += "\t" + strconv.Itoa(p.count)
		}
	}
	return strings.Join(lines, "\n"), nil
}

// cliPropertyRead is property:read: one value, a list a line each,
// "(empty)" for none (metadata.ts).
func (x *Index) cliPropertyRead(ctx context.Context, a actionsapi.Args) (string, error) {
	name := a.Params["name"]
	if name == "" {
		return "", fmt.Errorf("Missing required parameter: name")
	}
	path, err := x.resolveFile(ctx, a, true)
	if err != nil {
		return "", err
	}
	m := x.meta(path)
	if m == nil || m.Frontmatter == nil {
		return "", fmt.Errorf("Property %q not found.", name)
	}
	v, ok := m.Frontmatter[name]
	if !ok {
		return "", fmt.Errorf("Property %q not found.", name)
	}
	if list, ok := v.([]any); ok {
		if len(list) == 0 {
			return "(empty)", nil
		}
		return valueText(list, "\n"), nil
	}
	if v == nil || v == "" {
		return "(empty)", nil
	}
	return valueText(v, ", "), nil
}

// cliAliases is aliases: a file's, or every alias with its notes
// (metadata.ts).
func (x *Index) cliAliases(ctx context.Context, a actionsapi.Args) (string, error) {
	if a.Has("active") || a.Params["file"] != "" || a.Params["path"] != "" {
		path, err := x.resolveFile(ctx, a, true)
		if err != nil {
			return "", err
		}
		var aliases []string
		if m := x.meta(path); m != nil {
			aliases = mdmeta.ParseFrontMatterAliases(m.Frontmatter)
		}
		if a.Has("total") {
			return strconv.Itoa(len(aliases)), nil
		}
		if len(aliases) == 0 {
			return "No aliases found.", nil
		}
		clifmt.Sort(aliases)
		return strings.Join(aliases, "\n"), nil
	}
	byAlias := map[string][]string{}
	for _, p := range x.allPaths(func(string) bool { return true }) {
		m := x.meta(p)
		if m == nil {
			continue
		}
		for _, al := range mdmeta.ParseFrontMatterAliases(m.Frontmatter) {
			byAlias[al] = append(byAlias[al], p)
		}
	}
	if a.Has("total") {
		return strconv.Itoa(len(byAlias)), nil
	}
	if len(byAlias) == 0 {
		return "No aliases found.", nil
	}
	aliases := make([]string, 0, len(byAlias))
	for al := range byAlias {
		aliases = append(aliases, al)
	}
	clifmt.Sort(aliases)
	lines := make([]string, len(aliases))
	for i, al := range aliases {
		lines[i] = al
		if a.Has("verbose") {
			lines[i] += "\t" + strings.Join(byAlias[al], ", ")
		}
	}
	return strings.Join(lines, "\n"), nil
}

// cliWordcount is wordcount: the note's words, and its characters as the
// UTF-16 length of the text past its frontmatter (wordcountWebCli.ts).
func (x *Index) cliWordcount(ctx context.Context, a actionsapi.Args) (string, error) {
	path, err := x.resolveFile(ctx, a, true)
	if err != nil {
		return "", err
	}
	if !isNote(path) {
		return "", fmt.Errorf("Word count is only available for markdown files.")
	}
	x.mu.RLock()
	abs := x.files[path].abs
	x.mu.RUnlock()
	data, err := x.fs.ReadBytes(ctx, abs, maxNote)
	if err != nil {
		return "", err
	}
	text := mdmeta.StripFrontmatter(string(data))
	words := mdmeta.CountWords(text).Words
	chars := len(utf16.Encode([]rune(text)))
	switch {
	case a.Has("words") && !a.Has("characters"):
		return strconv.Itoa(words), nil
	case a.Has("characters") && !a.Has("words"):
		return strconv.Itoa(chars), nil
	}
	return fmt.Sprintf("words: %d\ncharacters: %d", words, chars), nil
}

// frontmatterKeys are the note's frontmatter keys in the order it writes
// them, as the TS's object keeps them: read from the note again.
func (x *Index) frontmatterKeys(ctx context.Context, path string, m *mdmeta.Metadata) ([]string, error) {
	x.mu.RLock()
	abs := x.files[path].abs
	x.mu.RUnlock()
	data, err := x.fs.ReadBytes(ctx, abs, maxNote)
	if err != nil {
		return nil, err
	}
	var keys []string
	for _, k := range mdmeta.ParseFrontmatter(string(data)).Keys() {
		if _, ok := m.Frontmatter[k]; ok {
			keys = append(keys, k)
		}
	}
	return keys, nil
}

// valueText is a frontmatter value as String() prints it, a list joined
// by sep.
func valueText(v any, sep string) string {
	switch t := v.(type) {
	case []any:
		parts := make([]string, len(t))
		for i, e := range t {
			parts[i] = valueText(e, ",")
		}
		return strings.Join(parts, sep)
	case nil:
		return "null"
	case float64:
		return strconv.FormatFloat(t, 'f', -1, 64)
	case string:
		return t
	}
	return fmt.Sprint(v)
}

func jsonIndent(v any) string {
	b, _ := json.MarshalIndent(v, "", "  ")
	return string(b)
}

// jsonIndentOrdered is JSON.stringify of an object, its keys in order.
func jsonIndentOrdered(keys []string, obj map[string]any) string {
	if len(keys) == 0 {
		return "{}"
	}
	parts := make([]string, len(keys))
	for i, k := range keys {
		kb, _ := json.Marshal(k)
		vb, _ := json.MarshalIndent(obj[k], "  ", "  ")
		parts[i] = "  " + string(kb) + ": " + string(vb)
	}
	return "{\n" + strings.Join(parts, ",\n") + "\n}"
}

// yamlOf is the frontmatter as YAML (the yaml package's stringify with
// nulls empty): a scalar a line, a list a "- item" each.
func yamlOf(keys []string, obj map[string]any) string {
	var lines []string
	for _, k := range keys {
		switch v := obj[k].(type) {
		case []any:
			if len(v) == 0 {
				lines = append(lines, k+": []")
				continue
			}
			lines = append(lines, k+":")
			for _, e := range v {
				lines = append(lines, "  - "+yamlScalar(e))
			}
		case nil:
			lines = append(lines, k+":")
		default:
			lines = append(lines, k+": "+yamlScalar(v))
		}
	}
	return strings.Join(lines, "\n")
}

func yamlScalar(v any) string {
	s := valueText(v, ", ")
	if _, isStr := v.(string); isStr && (s == "" || strings.ContainsAny(s[:1], "-?:,[]{}#&*!|>'\"%@`") || strings.Contains(s, ": ") || strings.Contains(s, " #")) {
		b, _ := json.Marshal(s)
		return string(b)
	}
	return s
}
