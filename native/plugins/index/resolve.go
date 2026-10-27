package index

import (
	"sort"
	"strings"
)

// Link resolution, attention's MetadataCache.getLinkpathDest
// (apps/web/metadata/MetadataCache.ts). Paths are the reader's display
// paths, "<mount>/<rel>", which play the vault-relative paths' part.

// lookup is the unique-file lookup: every file by its lowercased name
// (MetadataCache.uniqueFileLookup).
type lookup map[string][]string

func (l lookup) add(path string) {
	k := strings.ToLower(basename(path))
	for _, p := range l[k] {
		if p == path {
			return
		}
	}
	l[k] = append(l[k], path)
}

func (l lookup) remove(path string) {
	k := strings.ToLower(basename(path))
	ps := l[k]
	for i, p := range ps {
		if p == path {
			l[k] = append(ps[:i], ps[i+1:]...)
			break
		}
	}
	if len(l[k]) == 0 {
		delete(l, k)
	}
}

// dest is getLinkpathDest: the files linkpath names from source, best
// first; isMD reports whether a path is a markdown file.
func (l lookup) dest(linkpath, source string, isMD func(string) bool) []string {
	link := strings.TrimSpace(linkpath)
	if link == "" {
		if isMD(source) {
			return []string{source}
		}
		return nil
	}
	lower := strings.ToLower(link)
	match, name := lower, basename(lower)
	var cands []string
	if strings.Contains(name, ".") {
		cands = append(cands, l[name]...)
	}
	if len(cands) == 0 {
		match = lower + ".md"
		name = basename(match)
		cands = append(cands, l[name]...)
	}
	if len(cands) == 0 {
		return nil
	}
	if name == match && len(cands) == 1 {
		return cands
	}
	folder := strings.ToLower(dirname(source))
	if strings.HasPrefix(lower, "./") || strings.HasPrefix(lower, "../") {
		if rel := relativeLinkpath(match, source); rel != "" {
			rel = strings.ToLower(rel)
			for _, c := range cands {
				if strings.ToLower(c) == rel {
					return []string{c}
				}
			}
		}
	}
	if strings.HasPrefix(lower, "/") {
		abs := match[1:]
		for _, c := range cands {
			if strings.ToLower(c) == abs {
				return []string{c}
			}
		}
		return nil
	}
	var near, far []string
	for _, c := range cands {
		lc := strings.ToLower(c)
		if !strings.HasSuffix(lc, match) {
			continue
		}
		if folder == "" || strings.HasPrefix(lc, folder+"/") {
			near = append(near, c)
		} else {
			far = append(far, c)
		}
	}
	byLen := func(s []string) {
		sort.SliceStable(s, func(i, j int) bool { return len(s[i]) < len(s[j]) })
	}
	byLen(near)
	byLen(far)
	return append(near, far...)
}

// first is getFirstLinkpathDest.
func (l lookup) first(linkpath, source string, isMD func(string) bool) (string, bool) {
	if d := l.dest(linkpath, source, isMD); len(d) > 0 {
		return d[0], true
	}
	return "", false
}

func basename(p string) string {
	if i := strings.LastIndexByte(p, '/'); i >= 0 {
		return p[i+1:]
	}
	return p
}

func dirname(p string) string {
	if i := strings.LastIndexByte(p, '/'); i >= 0 {
		return p[:i]
	}
	return ""
}

// stripSubpath drops "#heading" (stripSubpath).
func stripSubpath(link string) string {
	before, _, _ := strings.Cut(link, "#")
	return strings.TrimSpace(before)
}

// unresolvedKey is normalizeUnresolvedLinkpath: the subpath and a .md
// dropped.
func unresolvedKey(link string) string {
	n := stripSubpath(link)
	if strings.HasSuffix(strings.ToLower(basename(n)), ".md") {
		return n[:len(n)-3]
	}
	return n
}

// relativeLinkpath is resolveRelativeLinkpath: linkpath from source's
// folder, "" when it is not relative.
func relativeLinkpath(linkpath, source string) string {
	if source == "" || linkpath == "" || strings.HasPrefix(linkpath, "/") {
		return ""
	}
	if !strings.Contains(linkpath, "/") && !strings.HasPrefix(linkpath, ".") {
		return ""
	}
	var parts []string
	for _, p := range append(strings.Split(dirname(source), "/"), strings.Split(linkpath, "/")...) {
		switch p {
		case "", ".":
		case "..":
			if len(parts) > 0 {
				parts = parts[:len(parts)-1]
			}
		default:
			parts = append(parts, p)
		}
	}
	return strings.Join(parts, "/")
}
