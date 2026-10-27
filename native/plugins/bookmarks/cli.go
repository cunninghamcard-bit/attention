package bookmarks

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strconv"
	"strings"

	"github.com/cunninghamcard-bit/attention/native/actionsapi"
	"github.com/cunninghamcard-bit/attention/native/internal/clifmt"
	"github.com/cunninghamcard-bit/attention/native/internal/clipath"
	"github.com/cunninghamcard-bit/attention/native/shellapi"
)

const addUsage = "Usage: bookmark file=<path> [subpath=] | folder=<path> | search=<query> | url=<url>  [title=]"

// cliList is `bookmarks [total] [verbose] [format=json|tsv|csv]`. TS has
// none; the shape is Obsidian's CLI.
func (b *Bookmarks) cliList(ctx context.Context, a actionsapi.Args) (string, error) {
	return shellapi.OnMain(ctx, func() (string, error) {
		if a.Has("total") {
			return strconv.Itoa(countItems(b.items)), nil
		}
		format := a.Params["format"]
		if format == "json" {
			data, err := json.MarshalIndent(b.items, "", "  ")
			if err != nil {
				return "", err
			}
			return string(data), nil
		}
		if len(b.items) == 0 {
			return "No bookmarks found.", nil
		}
		if format == "tsv" || format == "csv" {
			rows := tableRows(b.items)
			return clifmt.Table([]string{"type", "title"}, rows, format), nil
		}
		return strings.Join(listLines(b.items, 0, a.Has("verbose")), "\n"), nil
	})
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

func listLines(items []*Item, depth int, verbose bool) []string {
	indent := strings.Repeat("\t", depth)
	var lines []string
	for _, it := range items {
		line := indent
		if verbose {
			line += it.Type + ": "
		}
		line += it.displayTitle()
		lines = append(lines, line)
		if it.Type == "group" {
			lines = append(lines, listLines(it.Items, depth+1, verbose)...)
		}
	}
	return lines
}

func tableRows(items []*Item) [][]string {
	var rows [][]string
	var walk func([]*Item)
	walk = func(items []*Item) {
		for _, it := range items {
			rows = append(rows, []string{it.Type, it.displayTitle()})
			if it.Type == "group" {
				walk(it.Items)
			}
		}
	}
	walk(items)
	return rows
}

// cliAdd is `bookmark file=<path> [subpath=] | folder=<path> | search=<query> | url=<url>  [title=]`.
func (b *Bookmarks) cliAdd(ctx context.Context, a actionsapi.Args) (string, error) {
	file, folder := a.Params["file"], a.Params["folder"]
	search, url := a.Params["search"], a.Params["url"]
	n := 0
	for _, s := range []string{file, folder, search, url} {
		if s != "" {
			n++
		}
	}
	if n != 1 {
		return "", fmt.Errorf("%s", addUsage)
	}
	title := a.Params["title"]
	item := &Item{Ctime: nowCtime(), Title: title}
	switch {
	case file != "":
		abs, err := b.resolveFile(ctx, file, a.Cwd)
		if err != nil {
			return "", err
		}
		item.Type, item.Path, item.Subpath = "file", abs, a.Params["subpath"]
	case folder != "":
		abs, err := b.resolveFolder(ctx, folder, a.Cwd)
		if err != nil {
			return "", err
		}
		item.Type, item.Path = "folder", abs
	case search != "":
		item.Type, item.Query = "search", search
	default:
		item.Type, item.URL = "url", url
	}
	return shellapi.OnMain(ctx, func() (string, error) {
		b.add(item)
		return "Bookmarked: " + item.displayTitle(), nil
	})
}

func (b *Bookmarks) resolveFile(ctx context.Context, file, cwd string) (string, error) {
	mounts, err := b.project.Mounts(ctx)
	if err != nil {
		return "", err
	}
	return clipath.Link(ctx, b.project.Files, mounts, file, cwd)
}

// resolveFolder is path= resolution for a directory. clipath.Path rejects
// folders, so this walks clipath.Candidates the same way and keeps dirs.
func (b *Bookmarks) resolveFolder(ctx context.Context, target, cwd string) (string, error) {
	mounts, err := b.project.Mounts(ctx)
	if err != nil {
		return "", err
	}
	target = strings.TrimSuffix(target, "/")
	for _, m := range mounts {
		if m.Name == target {
			return m.Path, nil
		}
	}
	for _, p := range clipath.Candidates(mounts, target, cwd) {
		st, err := os.Stat(p)
		if err != nil {
			continue
		}
		if !st.IsDir() {
			return "", fmt.Errorf("%q is a file, not a folder.", target)
		}
		return p, nil
	}
	return "", fmt.Errorf("Folder %q not found.", target)
}
