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
)

const (
	linkScheme  = "attention-link:"
	embedScheme = "attention-embed:"
)

var (
	wikilink = regexp.MustCompile(`(!?)\[\[([^\[\]\n]+)\]\]`)
	callout  = regexp.MustCompile(`^(\s*>\s*)\[!([A-Za-z-]+)\]([+-]?)\s*(.*)$`)
	imageExt = map[string]bool{".png": true, ".jpg": true, ".jpeg": true, ".gif": true, ".webp": true, ".bmp": true, ".svg": true, ".avif": true}
)

func (v *Viewer) openLink(from, name string) {
	if v.ws == nil {
		return
	}
	go func() {
		ctx, cancel := context.WithTimeout(v.l.Ctx, 5*time.Second)
		defer cancel()
		path, err := v.ws.ResolveLink(ctx, name, filepath.Dir(from))
		if err != nil {
			return
		}
		v.l.Post(func() {
			if v.ws != nil {
				v.ws.Open(path, nil, false)
			}
		})
	}()
}

func (v *Viewer) loadImage(from string) func(string) (ui.ImageSource, error) {
	byPath := markdown.FileImages(filepath.Dir(from))
	return func(u string) (ui.ImageSource, error) {
		name, ok := strings.CutPrefix(u, embedScheme)
		if !ok {
			return byPath(u)
		}
		if n, err := url.PathUnescape(name); err == nil {
			name = n
		}
		if v.ws == nil {
			return byPath(name)
		}
		ctx, cancel := context.WithTimeout(v.l.Ctx, 5*time.Second)
		defer cancel()
		path, err := v.ws.ResolveLink(ctx, name, filepath.Dir(from))
		if err != nil {
			return byPath(name)
		}
		return markdown.FileImages(filepath.Dir(path))(filepath.Base(path))
	}
}

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
			lines[i] = m[1] + rewriteInline(calloutTitle(m[2], m[4])) + "\n" + strings.TrimRight(m[1], " ")
			continue
		}
		lines[i] = rewriteInline(line)
	}
	return strings.Join(lines, "\n")
}

func calloutTitle(kind, title string) string {
	name := strings.ToUpper(kind[:1]) + strings.ToLower(kind[1:])
	if title == "" {
		return "**" + name + "**"
	}
	return "**" + name + " · " + title + "**"
}

func rewriteInline(line string) string {
	if !strings.Contains(line, "[[") {
		return line
	}
	parts := strings.Split(line, "`")
	for i := 0; i < len(parts); i += 2 {
		parts[i] = wikilink.ReplaceAllStringFunc(parts[i], func(m string) string {
			sub := wikilink.FindStringSubmatch(m)
			embed, inner := sub[1] == "!", sub[2]
			target, alias, _ := strings.Cut(inner, "|")
			file, _, _ := strings.Cut(target, "#")
			text := alias
			text = cmp.Or(text, target)
			if embed && imageExt[strings.ToLower(filepath.Ext(file))] {
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
