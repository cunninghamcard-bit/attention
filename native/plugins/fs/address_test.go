package fs

import "testing"

func TestAddressRoundTrips(t *testing.T) {
	a := AddressFor("home", "notes/a b#1.md")
	if a != "attention-resource://file/mount/home/notes/a%20b%231.md" {
		t.Fatalf("AddressFor = %q", a)
	}
	if p, ok := ParseAddress(a); !ok || p.Mount != "home" || p.Rel != "notes/a b#1.md" {
		t.Fatalf("ParseAddress = %+v %v", p, ok)
	}
	b := AbsoluteAddress("/etc/hosts")
	if b != "attention-resource://file/absolute/etc/hosts" {
		t.Fatalf("AbsoluteAddress = %q", b)
	}
	if p, ok := ParseAddress(b); !ok || p.Abs != "/etc/hosts" {
		t.Fatalf("ParseAddress = %+v %v", p, ok)
	}
	for _, bad := range []string{"attention-resource://git/x", "attention-resource://file/other/x", "attention-resource://file/mount//x", "/etc/hosts"} {
		if _, ok := ParseAddress(bad); ok {
			t.Errorf("ParseAddress(%q) should fail", bad)
		}
	}
}
