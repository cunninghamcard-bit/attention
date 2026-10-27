package fs

import (
	"context"
	"os"
	"path/filepath"
)

// Write creates or replaces path atomically: a temp file beside it, then a
// rename. A symlink's target is written, not the link, and a replaced
// file keeps its permissions (a new one is 0644); parent directories are
// created.
func (s *Service) Write(ctx context.Context, path string, data []byte) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	asked, op := path, "write"
	mode := os.FileMode(0o644)
	if _, err := os.Lstat(path); err != nil {
		op = "create"
	}
	if target, err := filepath.EvalSymlinks(path); err == nil {
		path = target
		if st, err := os.Stat(path); err == nil {
			mode = st.Mode().Perm()
		}
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	f, err := os.CreateTemp(filepath.Dir(path), "."+filepath.Base(path)+".*")
	if err != nil {
		return err
	}
	tmp := f.Name()
	_, err = f.Write(data)
	if err == nil {
		err = f.Chmod(mode)
	}
	if err == nil {
		err = f.Sync()
	}
	if cerr := f.Close(); err == nil {
		err = cerr
	}
	if err == nil {
		err = os.Rename(tmp, path)
	}
	if err != nil {
		os.Remove(tmp)
		return err
	}
	s.noteOp(asked, op)
	return nil
}

// Append writes data at the end of an existing file.
func (s *Service) Append(ctx context.Context, path string, data []byte) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return err
	}
	_, err = f.Write(data)
	if cerr := f.Close(); err == nil {
		err = cerr
	}
	if err == nil {
		s.noteOp(path, "write")
	}
	return err
}

// Mkdir creates path and any missing parents.
func (s *Service) Mkdir(ctx context.Context, path string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := os.MkdirAll(path, 0o755); err != nil {
		return err
	}
	s.noteOp(path, "create")
	return nil
}

// Rename moves oldpath to newpath.
func (s *Service) Rename(ctx context.Context, oldpath, newpath string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := os.Rename(oldpath, newpath); err != nil {
		return err
	}
	s.noteOp(oldpath, "rename")
	s.noteOp(newpath, "create")
	return nil
}

// Remove permanently deletes path.
func (s *Service) Remove(ctx context.Context, path string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := os.Remove(path); err != nil {
		return err
	}
	s.noteOp(path, "remove")
	return nil
}
