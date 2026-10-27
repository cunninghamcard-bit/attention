// Package clifmt is the output shapes attention's CLI shares
// (apps/web/app/cli/Cli.ts): tables, ASCII trees, its sort.
package clifmt

import (
	"encoding/json"
	"sort"
	"strings"

	"github.com/cunninghamcard-bit/attention/native/internal/natural"
)

// Less is alphaCompare, the collator every CLI name and path sort uses:
// without case, numbers by value.
func Less(a, b string) bool { return natural.Less(a, b) }

// Sort sorts s with Less.
func Sort(s []string) { sort.SliceStable(s, func(i, j int) bool { return Less(s[i], s[j]) }) }

// Table is formatTable: json, objects keyed by header, indented two spaces
// (a missing cell ""); csv or, for any other format, tsv, with no header
// row, a cell holding a quote, a line break or the separator quoted with
// its quotes doubled.
func Table(header []string, rows [][]string, format string) string {
	cell := func(row []string, i int) string {
		if i < len(row) {
			return row[i]
		}
		return ""
	}
	if format == "json" {
		objs := make([]json.RawMessage, 0, len(rows))
		for _, row := range rows {
			var b strings.Builder
			b.WriteString("{")
			for i, key := range header {
				if i > 0 {
					b.WriteString(",")
				}
				k, _ := json.Marshal(key)
				v, _ := json.Marshal(cell(row, i))
				b.WriteString("\n    " + string(k) + ": " + string(v))
			}
			if len(header) > 0 {
				b.WriteString("\n  ")
			}
			b.WriteString("}")
			objs = append(objs, json.RawMessage(b.String()))
		}
		if len(objs) == 0 {
			return "[]"
		}
		parts := make([]string, len(objs))
		for i, o := range objs {
			parts[i] = "  " + string(o)
		}
		return "[\n" + strings.Join(parts, ",\n") + "\n]"
	}
	sep := "\t"
	if format == "csv" {
		sep = ","
	}
	lines := make([]string, len(rows))
	for r, row := range rows {
		cells := make([]string, len(header))
		for i := range header {
			c := cell(row, i)
			if strings.ContainsAny(c, "\"\n\r"+sep) {
				c = `"` + strings.ReplaceAll(c, `"`, `""`) + `"`
			}
			cells[i] = c
		}
		lines[r] = strings.Join(cells, sep)
	}
	return strings.Join(lines, "\n")
}

// Node is a row of an ASCII tree.
type Node struct {
	Label    string
	Children []Node
}

// Tree is formatAsciiTree: ├── and └── before every row, the top level's
// too.
func Tree(nodes []Node, indent string) string {
	var lines []string
	for i, n := range nodes {
		last := i == len(nodes)-1
		conn, next := "├── ", "│   "
		if last {
			conn, next = "└── ", "    "
		}
		lines = append(lines, indent+conn+n.Label)
		if len(n.Children) > 0 {
			lines = append(lines, Tree(n.Children, indent+next))
		}
	}
	return strings.Join(lines, "\n")
}

// TreeWithRoot is formatAsciiTreeWithRoot: the root's label, then its
// tree.
func TreeWithRoot(root string, nodes []Node) string {
	if len(nodes) == 0 {
		return root
	}
	return root + "\n" + Tree(nodes, "")
}
