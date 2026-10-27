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
	mode := os.FileMode(0o644)
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
	}
	return err
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
	return err
}

// Mkdir creates path and any missing parents.
func (s *Service) Mkdir(ctx context.Context, path string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	return os.MkdirAll(path, 0o755)
}

// Rename moves oldpath to newpath.
func (s *Service) Rename(ctx context.Context, oldpath, newpath string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	return os.Rename(oldpath, newpath)
}

// Remove permanently deletes path.
func (s *Service) Remove(ctx context.Context, path string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	return os.Remove(path)
}
