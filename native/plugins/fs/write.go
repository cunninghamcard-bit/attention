package fs

import (
	"context"
	"os"

	"github.com/cunninghamcard-bit/attention/native/internal/paths"
)

// Write creates or replaces path atomically, as internal/paths.WriteFileAtomic
// does (a sibling temp file, then rename). Parent directories are created.
func (s *Service) Write(ctx context.Context, path string, data []byte) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	return paths.WriteFileAtomic(path, data)
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
