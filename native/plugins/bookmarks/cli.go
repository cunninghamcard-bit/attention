package bookmarks

import (
	"context"
	"encoding/json"
	"fmt"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/cunninghamcard-bit/attention/native/internal/clifmt"
	"github.com/cunninghamcard-bit/attention/native/plugins/actions"
	projectplugin "github.com/cunninghamcard-bit/attention/native/plugins/project"
	"github.com/cunninghamcard-bit/attention/native/plugins/shell"
	"github.com/cunninghamcard-bit/attention/native/plugins/workspace"
)

const addUsage = "Usage: bookmark file=<path> | url=<url>  [title=] [folder=]"

// cliList is `bookmarks [total] [verbose] [format=json|tsv|csv]`: the
// pinned area. TS has none; the shape is Obsidian's CLI.
func (b *Bookmarks) cliList(ctx context.Context, a actions.Args) (string, error) {
	return shell.OnMain(ctx, b.sh, func() (string, error) {
		items := b.items()
		if a.Has("total") {
			return strconv.Itoa(countItems(items)), nil
		}
		format := a.Params["format"]
		if format == "json" {
			data, err := json.MarshalIndent(items, "", "  ")
			if err != nil {
				return "", err
			}
			return string(data), nil
		}
		if len(items) == 0 {
			return "No bookmarks found.", nil
		}
		if format == "tsv" || format == "csv" {
			return clifmt.Table([]string{"type", "title"}, tableRows(items, b.ws), format), nil
		}
		return strings.Join(listLines(items, 0, a.Has("verbose"), b.ws), "\n"), nil
	})
}

// cliAdd is `bookmark file=<path> | url=<url>  [title=]`: it pins the file
// or the page, in the folder named folder= when given. A pin holds a tab,
// so folder= and search= bookmarks are gone (docs/cli-deviations.md).
func (b *Bookmarks) cliAdd(ctx context.Context, a actions.Args) (string, error) {
	if a.Params["search"] != "" || a.Has("search") {
		return "", fmt.Errorf("Search bookmarks are no longer kept: a bookmark is a pinned tab.")
	}
	file, url := a.Params["file"], a.Params["url"]
	if (file == "") == (url == "") {
		return "", fmt.Errorf("%s", addUsage)
	}
	entry, title := url, a.Params["title"]
	if file != "" {
		abs, err := b.resolveFile(ctx, file, a.Cwd)
		if err != nil {
			return "", err
		}
		entry = abs
	}
	return shell.OnMain(ctx, b.sh, func() (string, error) {
		name := title
		if name == "" {
			name = entry
			if file != "" {
				name = b.ws.Display(entry)
			}
		}
		if !b.ws.PinEntry(entry, title, a.Params["folder"]) {
			return "Already bookmarked: " + name, nil
		}
		return "Bookmarked: " + name, nil
	})
}

func (b *Bookmarks) resolveFile(ctx context.Context, file, cwd string) (string, error) {
	mounts, err := b.project.Mounts(ctx)
	if err != nil {
		return "", err
	}
	return projectplugin.ResolveLink(ctx, b.project.Files, mounts, file, cwd)
}

func countItems(items []*Item) int {
	n := 0
	for _, it := range items {
		n++
		if it.Type == "group" {
			n += countItems(it.Items)
		}
	}
	return n
}

func listLines(items []*Item, depth int, verbose bool, ws *workspace.Workspace) []string {
	indent := strings.Repeat("\t", depth)
	var lines []string
	for _, it := range items {
		line := indent
		if verbose {
			line += it.Type + ": "
		}
		line += it.displayTitle(ws)
		lines = append(lines, line)
		if it.Type == "group" {
			lines = append(lines, listLines(it.Items, depth+1, verbose, ws)...)
		}
	}
	return lines
}

func tableRows(items []*Item, ws *workspace.Workspace) [][]string {
	var rows [][]string
	var walk func([]*Item)
	walk = func(items []*Item) {
		for _, it := range items {
			rows = append(rows, []string{it.Type, it.displayTitle(ws)})
			if it.Type == "group" {
				walk(it.Items)
			}
		}
	}
	walk(items)
	return rows
}

// displayTitle is how the CLI names a bookmark (getBookmarkTitle): its
// title, else a file's display path or a page's URL.
func (it *Item) displayTitle(ws *workspace.Workspace) string {
	switch {
	case it.Title != "":
		return it.Title
	case it.Type == "file" && ws != nil:
		return ws.Display(it.Path)
	case it.Type == "file":
		return filepath.Base(it.Path)
	}
	return it.URL
}
