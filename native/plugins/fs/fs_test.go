package fs

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/arcships/rutis/go/rutis/rutistest"

	contract "github.com/cunninghamcard-bit/attention/native/contract/fs"
)

func loadFS(t *testing.T) *rutistest.Loaded {
	t.Helper()
	return rutistest.Load(t, Plugin, nil, nil)
}

func call(t *testing.T, loaded *rutistest.Loaded, method string, result any, args ...any) {
	t.Helper()
	if err := loaded.Service("fs").Call(t.Context(), method, result, args...); err != nil {
		t.Fatalf("%s: %v", method, err)
	}
}

func TestListSortsDirsFirstInNaturalOrder(t *testing.T) {
	dir := t.TempDir()
	for _, name := range []string{"d10", "D2", "sub"} {
		if err := os.Mkdir(filepath.Join(dir, name), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	for _, name := range []string{"z.txt", "a.txt", "file10", "file2"} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.Mkdir(filepath.Join(dir, ".git"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, ".DS_Store"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}

	loaded := loadFS(t)
	var entries []contract.Entry
	call(t, loaded, "list", &entries, dir)

	var names []string
	var dirs []bool
	for _, e := range entries {
		names = append(names, e.Name)
		dirs = append(dirs, e.Dir)
		if e.Path != filepath.Join(dir, e.Name) {
			t.Fatalf("%s path = %s", e.Name, e.Path)
		}
	}
	want := []string{"D2", "d10", "sub", "a.txt", "file2", "file10", "z.txt"}
	if strings.Join(names, ",") != strings.Join(want, ",") {
		t.Fatalf("list = %v, want %v", names, want)
	}
	for i, name := range want {
		wantDir := i < 3
		if dirs[i] != wantDir {
			t.Fatalf("%s Dir = %v, want %v", name, dirs[i], wantDir)
		}
	}
}

func TestReadTextBinaryAndTooLarge(t *testing.T) {
	dir := t.TempDir()
	textPath := filepath.Join(dir, "note.md")
	if err := os.WriteFile(textPath, []byte("hello\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	binPath := filepath.Join(dir, "blob.bin")
	if err := os.WriteFile(binPath, []byte{'a', 0, 'b'}, 0o644); err != nil {
		t.Fatal(err)
	}
	bigPath := filepath.Join(dir, "big.txt")
	if err := os.WriteFile(bigPath, bytes.Repeat([]byte("x"), 100), 0o644); err != nil {
		t.Fatal(err)
	}

	loaded := loadFS(t)

	var text contract.File
	call(t, loaded, "read", &text, textPath, int64(1024))
	if text.Text != "hello\n" || text.Binary || text.TooLarge || text.Size != 6 {
		t.Fatalf("text = %+v", text)
	}

	var bin contract.File
	call(t, loaded, "read", &bin, binPath, int64(1024))
	if !bin.Binary || bin.Text != "" || bin.TooLarge {
		t.Fatalf("binary = %+v", bin)
	}

	var large contract.File
	call(t, loaded, "read", &large, bigPath, int64(10))
	if !large.TooLarge || large.Text != "" || large.Binary || large.Size != 100 {
		t.Fatalf("too large = %+v", large)
	}
}

func TestReadBytesLimit(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "data.bin")
	if err := os.WriteFile(path, bytes.Repeat([]byte("y"), 50), 0o644); err != nil {
		t.Fatal(err)
	}
	loaded := loadFS(t)

	var got []byte
	call(t, loaded, "readBytes", &got, path, int64(50))
	if len(got) != 50 {
		t.Fatalf("readBytes within limit: len=%d", len(got))
	}

	err := loaded.Service("fs").Call(t.Context(), "readBytes", &got, path, int64(10))
	if err == nil || !strings.Contains(err.Error(), "larger than 10 bytes") {
		t.Fatalf("readBytes over limit: %v", err)
	}
}

func TestStat(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "note.md")
	if err := os.WriteFile(path, []byte("ab"), 0o644); err != nil {
		t.Fatal(err)
	}
	loaded := loadFS(t)

	var file contract.Entry
	call(t, loaded, "stat", &file, path)
	if file.Name != "note.md" || file.Path != path || file.Dir || file.Size != 2 {
		t.Fatalf("file stat = %+v", file)
	}

	var folder contract.Entry
	call(t, loaded, "stat", &folder, dir)
	if folder.Name != filepath.Base(dir) || folder.Path != dir || !folder.Dir {
		t.Fatalf("dir stat = %+v", folder)
	}
}

func TestWatchEmitsChangedThenUnwatch(t *testing.T) {
	dir := t.TempDir()
	loaded := loadFS(t)

	got := make(chan contract.Batch, 4)
	off := loaded.On(contract.ChangedEvent, func(_ context.Context, args ...any) (any, error) {
		if len(args) == 0 {
			return nil, nil
		}
		b, err := contract.DecodeBatch(args[0])
		if err != nil {
			return nil, err
		}
		select {
		case got <- b:
		default:
		}
		return nil, nil
	})
	t.Cleanup(off)

	call(t, loaded, "watch", nil, dir)
	path := filepath.Join(dir, "new.md")
	if err := os.WriteFile(path, []byte("hi"), 0o644); err != nil {
		t.Fatal(err)
	}

	deadline := time.After(3 * time.Second)
	for {
		select {
		case b := <-got:
			for _, c := range b.Changes {
				if c.Path == path && (c.Op == "create" || c.Op == "write") {
					call(t, loaded, "unwatch", nil, dir)
					return
				}
			}
		case <-deadline:
			t.Fatal("timed out waiting for fs/changed")
		}
	}
}
