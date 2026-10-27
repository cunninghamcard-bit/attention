package mdmeta

import "strings"

// GetLinkpath is the path of a wiki link, before '#'.
// It ports getLinkpath from apps/web/core/ApiUtils.ts.
func GetLinkpath(linktext string) string {
	index := strings.Index(linktext, "#")
	if index == -1 {
		return linktext
	}
	return linktext[:index]
}

// SplitLinkpath splits a linkpath on the first '#', keeping '#' on the subpath.
// It ports splitLinkpath from apps/web/metadata/Linkpath.ts.
func SplitLinkpath(linkpath string) SplitPath {
	index := strings.Index(linkpath, "#")
	if index == -1 {
		return SplitPath{Path: linkpath, Subpath: ""}
	}
	return SplitPath{Path: linkpath[:index], Subpath: linkpath[index:]}
}

// ParseLinktext splits path#subpath|alias, trims, and drops a leading '#' on the subpath.
// It ports parseLinktext from apps/web/metadata/Linkpath.ts.
func ParseLinktext(linktext string) Linktext {
	target := linktext
	if pipe := strings.Index(linktext, "|"); pipe != -1 {
		target = linktext[:pipe]
	}
	split := SplitLinkpath(target)
	sub := strings.TrimSpace(split.Subpath)
	if strings.HasPrefix(sub, "#") {
		sub = strings.TrimSpace(sub[1:])
	}
	out := Linktext{Path: strings.TrimSpace(split.Path)}
	if sub != "" {
		out.Subpath = sub
	}
	return out
}
