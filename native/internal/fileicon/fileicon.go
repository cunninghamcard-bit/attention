// Package fileicon picks a file's icon by its extension, for the tree,
// the tabs, the quick switcher and search.
package fileicon

import (
	"path/filepath"
	"strings"

	"github.com/egoist/mygo/ui"
	"github.com/smallnest/uix/components/lucide"
)

// For is the icon of a file named name.
func For(name string) *ui.SVG {
	switch strings.ToLower(filepath.Ext(name)) {
	case ".md", ".markdown", ".mdx":
		return lucide.FileText()
	case ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp", ".svg":
		return lucide.Image()
	}
	return lucide.File()
}
