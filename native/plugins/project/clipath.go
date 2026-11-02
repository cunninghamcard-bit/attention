package project

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// Candidates are the places a CLI path may name: absolute, "<mount>/<rel>",
// relative to the caller's directory, relative to each mount.
func Candidates(mounts []Mount, target, cwd string) []string {
	if filepath.IsAbs(target) {
		return []string{filepath.Clean(target)}
	}
	var out []string
	if name, rel, ok := strings.Cut(target, "/"); ok {
		for _, m := range mounts {
			if m.Name == name {
				out = append(out, filepath.Join(m.Path, filepath.FromSlash(rel)))
			}
		}
	}
	if cwd != "" {
		out = append(out, filepath.Join(cwd, target))
	}
	for _, m := range mounts {
		out = append(out, filepath.Join(m.Path, filepath.FromSlash(target)))
	}
	return out
}

// ResolvePath is path=: exact, as the TS CLI's.
func ResolvePath(mounts []Mount, target, cwd string) (string, error) {
	for _, p := range Candidates(mounts, target, cwd) {
		st, err := os.Stat(p)
		if err != nil {
			continue
		}
		if st.IsDir() {
			return "", fmt.Errorf("%q is a folder, not a file.", target)
		}
		return p, nil
	}
	return "", fmt.Errorf("File %q not found.", target)
}

// ResolveLink is file=: a path with or without ".md" first, then the first
// file anywhere in the mounts whose path ends with it, without case; files
// is the project's listing.
func ResolveLink(ctx context.Context, files func(context.Context) (Listing, error), mounts []Mount, link, cwd string) (string, error) {
	tries := []string{link}
	if filepath.Ext(link) == "" {
		tries = append(tries, link+".md")
	}
	for _, t := range tries {
		for _, p := range Candidates(mounts, t, cwd) {
			if st, err := os.Stat(p); err == nil && !st.IsDir() {
				return p, nil
			}
		}
	}
	listing, err := files(ctx)
	if err != nil {
		return "", err
	}
	for _, t := range tries {
		want := "/" + strings.ToLower(filepath.ToSlash(t))
		for _, f := range listing.Files {
			if strings.HasSuffix("/"+strings.ToLower(f.Rel), want) {
				return f.Path, nil
			}
		}
	}
	return "", fmt.Errorf("File %q not found.", link)
}
