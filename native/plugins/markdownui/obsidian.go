package markdownui

import (
	"cmp"
	"context"
	"net/url"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/egoist/mygo/ui"
	"github.com/egoist/mygo/ui/markdown"

	"github.com/cunninghamcard-bit/attention/native/shellapi"
	"github.com/cunninghamcard-bit/attention/native/workspaceapi"
)

// The note syntax ui/markdown does not read (RFC risk R6), written as the
// Markdown it does before the view reads it: [[wikilinks]] become links,
// ![[embeds]] images (or, for a note, a link: the reader shows no
// transclusion), callouts a quote under their bold title. Code is left
// alone.

// The schemes the rewritten links and images carry: their targets are
// names to resolve, not paths (getFirstLinkpathDest).
const (
	linkScheme  = "attention-link:"
	embedScheme = "attention-embed:"
)

var (
	wikilink = regexp.MustCompile(`(!?)\[\[([^\[\]\n]+)\]\]`)
	callout  = regexp.MustCompile(`^(\s*>\s*)\[!([A-Za-z-]+)\]([+-]?)\s*(.*)$`)
	imageExt = map[string]bool{".png": true, ".jpg": true, ".jpeg": true, ".gif": true, ".webp": true, ".bmp": true, ".svg": true, ".avif": true}
)

// rewrite is the note's text as ui/markdown should read it.
func rewrite(src string) string {
	if !strings.Contains(src, "[[") && !strings.Contains(src, "[!") {
		return src
	}
	lines := strings.Split(src, "\n")
	fence := ""
	for i, line := range lines {
		trimmed := strings.TrimLeft(line, " ")
		if fence != "" {
			if strings.HasPrefix(trimmed, fence) {
				fence = ""
			}
			continue
		}
		if strings.HasPrefix(trimmed, "```") || strings.HasPrefix(trimmed, "~~~") {
			fence = trimmed[:3]
			continue
		}
		if m := callout.FindStringSubmatch(line); m != nil {
			// The title is a paragraph of its own: an empty quote line ends it.
			lines[i] = m[1] + rewriteInline(calloutTitle(m[2], m[4])) + "\n" + strings.TrimRight(m[1], " ")
			continue
		}
		lines[i] = rewriteInline(line)
	}
	return strings.Join(lines, "\n")
}

// calloutTitle is a callout's first line as a quote's: its type's name and
// its title, bold.
func calloutTitle(kind, title string) string {
	name := strings.ToUpper(kind[:1]) + strings.ToLower(kind[1:])
	if title == "" {
		return "**" + name + "**"
	}
	return "**" + name + " · " + title + "**"
}

// rewriteInline rewrites the wikilinks of a line outside its code spans.
func rewriteInline(line string) string {
	if !strings.Contains(line, "[[") {
		return line
	}
	parts := strings.Split(line, "`")
	for i := 0; i < len(parts); i += 2 { // even parts are outside backticks
		parts[i] = wikilink.ReplaceAllStringFunc(parts[i], func(m string) string {
			sub := wikilink.FindStringSubmatch(m)
			embed, inner := sub[1] == "!", sub[2]
			target, alias, _ := strings.Cut(inner, "|")
			file, _, _ := strings.Cut(target, "#")
			text := alias
			text = cmp.Or(text, target)
			if embed && imageExt[strings.ToLower(filepath.Ext(file))] {
				// ![[pic.png|300]]: the number is a width the view cannot take.
				return "![" + file + "](" + embedScheme + url.PathEscape(file) + ")"
			}
			return "[" + escapeText(text) + "](" + linkScheme + url.PathEscape(file) + ")"
		})
	}
	return strings.Join(parts, "`")
}

func escapeText(s string) string {
	return strings.NewReplacer("[", `\[`, "]", `\]`).Replace(s)
}

// openLink opens a rewritten wikilink's target, found off the main thread
// from the note's folder.
func openLink(from, name string) {
	ws := workspaceapi.Get()
	if ws == nil {
		return
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		path, err := ws.ResolveLink(ctx, name, filepath.Dir(from))
		if err != nil {
			return
		}
		shellapi.Update(func() {
			if ws := workspaceapi.Get(); ws != nil {
				ws.Open(path, nil, false)
			}
		})
	}()
}

// loadImage loads an image: a rewritten embed by its name, found as a
// link is, else a path from the note's folder.
func loadImage(from string) func(string) (ui.ImageSource, error) {
	byPath := markdown.FileImages(filepath.Dir(from))
	return func(u string) (ui.ImageSource, error) {
		name, ok := strings.CutPrefix(u, embedScheme)
		if !ok {
			return byPath(u)
		}
		if n, err := url.PathUnescape(name); err == nil {
			name = n
		}
		ws := workspaceapi.Get()
		if ws == nil {
			return byPath(name)
		}
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		path, err := ws.ResolveLink(ctx, name, filepath.Dir(from))
		if err != nil {
			return byPath(name)
		}
		return markdown.FileImages(filepath.Dir(path))(filepath.Base(path))
	}
}
