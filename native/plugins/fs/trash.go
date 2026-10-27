package fs

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"syscall"
	"time"
)

// Trash moves path into the freedesktop trash: $XDG_DATA_HOME/Trash/files
// (default ~/.local/share/Trash/files) and a matching .trashinfo under
// Trash/info. On EXDEV it copies, then removes the source.
func (s *Service) Trash(ctx context.Context, path string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	abs, err := filepath.Abs(path)
	if err != nil {
		return err
	}
	if _, err := os.Stat(abs); err != nil {
		return err
	}
	dataHome := os.Getenv("XDG_DATA_HOME")
	if dataHome == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return err
		}
		dataHome = filepath.Join(home, ".local", "share")
	}
	trash := filepath.Join(dataHome, "Trash")
	filesDir := filepath.Join(trash, "files")
	infoDir := filepath.Join(trash, "info")
	if err := os.MkdirAll(filesDir, 0o700); err != nil {
		return err
	}
	if err := os.MkdirAll(infoDir, 0o700); err != nil {
		return err
	}

	base := filepath.Base(abs)
	var dest, infoPath string
	var info *os.File
	for n := 0; n < 10_000; n++ {
		name := base
		if n > 0 {
			name = base + "." + strconv.Itoa(n+1)
		}
		infoPath = filepath.Join(infoDir, name+".trashinfo")
		dest = filepath.Join(filesDir, name)
		info, err = os.OpenFile(infoPath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
		if err == nil {
			break
		}
		if !errors.Is(err, os.ErrExist) {
			return err
		}
	}
	if info == nil {
		return fmt.Errorf("trash: too many collisions for %s", base)
	}
	committed := false
	defer func() {
		if !committed {
			info.Close()
			os.Remove(infoPath)
			os.RemoveAll(dest)
		}
	}()

	body := "[Trash Info]\nPath=" + trashEscape(abs) + "\nDeletionDate=" + time.Now().Format("2006-01-02T15:04:05") + "\n"
	if _, err := io.WriteString(info, body); err != nil {
		return err
	}
	if err := info.Close(); err != nil {
		return err
	}

	if err := os.Rename(abs, dest); err != nil {
		if !errors.Is(err, syscall.EXDEV) {
			return err
		}
		if err := copyAll(abs, dest); err != nil {
			return err
		}
		if err := os.RemoveAll(abs); err != nil {
			return err
		}
	}
	committed = true
	return nil
}

// trashEscape percent-encodes path bytes that are not unreserved in a URI,
// leaving '/'.
func trashEscape(path string) string {
	const hex = "0123456789ABCDEF"
	out := make([]byte, 0, len(path))
	for i := 0; i < len(path); i++ {
		c := path[i]
		if c == '/' || c == '-' || c == '.' || c == '_' || c == '~' ||
			(c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') {
			out = append(out, c)
			continue
		}
		out = append(out, '%', hex[c>>4], hex[c&0x0F])
	}
	return string(out)
}

func copyAll(src, dst string) error {
	st, err := os.Lstat(src)
	if err != nil {
		return err
	}
	if st.IsDir() {
		return copyDir(src, dst)
	}
	return copyFile(src, dst, st.Mode())
}

func copyDir(src, dst string) error {
	st, err := os.Stat(src)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(dst, st.Mode()); err != nil {
		return err
	}
	entries, err := os.ReadDir(src)
	if err != nil {
		return err
	}
	for _, e := range entries {
		from, to := filepath.Join(src, e.Name()), filepath.Join(dst, e.Name())
		info, err := e.Info()
		if err != nil {
			if errors.Is(err, os.ErrNotExist) {
				continue
			}
			return err
		}
		if e.IsDir() {
			if err := copyDir(from, to); err != nil {
				return err
			}
			continue
		}
		if err := copyFile(from, to, info.Mode()); err != nil {
			return err
		}
	}
	return nil
}

func copyFile(src, dst string, mode os.FileMode) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(dst, os.O_WRONLY|os.O_CREATE|os.O_EXCL, mode.Perm())
	if err != nil {
		return err
	}
	_, err = io.Copy(out, in)
	if cerr := out.Close(); err == nil {
		err = cerr
	}
	return err
}
