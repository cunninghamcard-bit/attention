package fs

import (
	"net/url"
	"path/filepath"
	"strings"
)

// The file protocol's resource addresses (RFC 0001 §5.6, dsh's
// fileAddressFor): attention-resource://file/mount/<mount id>/<rel> for a
// file under a mount, attention-resource://file/absolute/<path> for any
// other; each segment escaped as a URL path segment.
const addressPrefix = "attention-resource://file/"

// Address is a parsed file address: Mount and Rel, or Abs.
type Address struct {
	Mount string
	Rel   string // "/"-separated
	Abs   string
}

// AddressFor is the address of rel ("/"-separated) under the mount.
func AddressFor(mountID, rel string) string {
	return addressPrefix + "mount/" + url.PathEscape(mountID) + "/" + escape(rel)
}

// AbsoluteAddress is the address of an absolute path.
func AbsoluteAddress(path string) string {
	return addressPrefix + "absolute/" + escape(strings.TrimPrefix(filepath.ToSlash(path), "/"))
}

// ParseAddress parses a file address.
func ParseAddress(address string) (Address, bool) {
	rest, ok := strings.CutPrefix(address, addressPrefix)
	if !ok {
		return Address{}, false
	}
	scope, rest, _ := strings.Cut(rest, "/")
	switch scope {
	case "mount":
		id, rel, _ := strings.Cut(rest, "/")
		id, err := url.PathUnescape(id)
		if err != nil || id == "" {
			return Address{}, false
		}
		rel, ok := unescape(rel)
		if !ok {
			return Address{}, false
		}
		return Address{Mount: id, Rel: rel}, true
	case "absolute":
		p, ok := unescape(rest)
		if !ok {
			return Address{}, false
		}
		return Address{Abs: filepath.FromSlash("/" + p)}, true
	}
	return Address{}, false
}

func escape(p string) string {
	segs := strings.Split(p, "/")
	for i, s := range segs {
		segs[i] = url.PathEscape(s)
	}
	return strings.Join(segs, "/")
}

func unescape(p string) (string, bool) {
	segs := strings.Split(p, "/")
	for i, s := range segs {
		u, err := url.PathUnescape(s)
		if err != nil {
			return "", false
		}
		segs[i] = u
	}
	return strings.Join(segs, "/"), true
}
