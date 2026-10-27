package project

import (
	"fmt"
	"path/filepath"
	"strings"

	fscontract "github.com/cunninghamcard-bit/attention/native/contract/fs"
)

// MountOf is the mount path is under, the longest one, and path relative
// to it, "/"-separated.
func MountOf(ms []Mount, path string) (Mount, string, bool) {
	best := -1
	for i, m := range ms {
		if path == m.Path || strings.HasPrefix(path, m.Path+string(filepath.Separator)) {
			if best < 0 || len(m.Path) > len(ms[best].Path) {
				best = i
			}
		}
	}
	if best < 0 {
		return Mount{}, "", false
	}
	rel, _ := filepath.Rel(ms[best].Path, path)
	return ms[best], filepath.ToSlash(rel), true
}

// AddressOf is path's file address: under its mount, else absolute (a
// mount's root itself too).
func AddressOf(ms []Mount, path string) string {
	if m, rel, ok := MountOf(ms, path); ok && rel != "." {
		return fscontract.AddressFor(m.ID, rel)
	}
	return fscontract.AbsoluteAddress(path)
}

// PathOf is the file a file address names. An address that is no file
// address, names no mount in ms, or leaves its mount, is an error.
func PathOf(ms []Mount, address string) (string, error) {
	a, ok := fscontract.ParseAddress(address)
	if !ok {
		return "", fmt.Errorf("%q is not a file address", address)
	}
	if a.Abs != "" {
		return filepath.Clean(a.Abs), nil
	}
	for _, m := range ms {
		if m.ID != a.Mount {
			continue
		}
		p := filepath.Join(m.Path, filepath.FromSlash(a.Rel))
		if p != m.Path && !strings.HasPrefix(p, m.Path+string(filepath.Separator)) {
			return "", fmt.Errorf("%q is outside its mount", address)
		}
		return p, nil
	}
	return "", fmt.Errorf("%q names no mount", address)
}
