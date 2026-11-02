// Package fileicon picks a file's icon and semantic color by its name or
// extension, for the tree, tabs, quick switcher and search.
package fileicon

import (
	"path/filepath"
	"strings"
	"sync"

	"github.com/egoist/mygo/ui"
	"github.com/smallnest/uix/components/lucide"
)

var (
	modeMu    sync.RWMutex
	showIcons = true
	iconMode  = "pierre"
)

// SetMode updates the global file icon visibility and theme ("pierre" or "zed").
func SetMode(show bool, theme string) {
	modeMu.Lock()
	showIcons = show
	if theme == "zed" || theme == "pierre" {
		iconMode = theme
	} else {
		iconMode = "pierre"
	}
	modeMu.Unlock()
}

// Shown reports whether file icons are currently enabled.
func Shown() bool {
	modeMu.RLock()
	defer modeMu.RUnlock()
	return showIcons
}

// Render draws a file or folder icon at size (in DIPs) when file icons are enabled.
func Render(c *ui.Context, name string, dir, open, dark bool, size float32) {
	modeMu.RLock()
	show, mode := showIcons, iconMode
	modeMu.RUnlock()
	if !show {
		return
	}
	if mode == "zed" {
		if dir {
			ui.Icon(c, Folder(name, open)).Size(size, size).TextColor(FolderColor(open, dark)).Shrink(0)
			return
		}
		ui.Icon(c, zedFor(name)).Size(size, size).TextColor(zedColor(name, dark)).Shrink(0)
		return
	}
	if dir {
		svg := lucide.FolderClosed()
		if open {
			svg = lucide.FolderOpen()
		}
		ui.Icon(c, svg).Size(size, size).TextColor(c.Theme().TextMuted).Shrink(0)
		return
	}
	ui.Icon(c, PierreSVG(name)).Size(size, size).TextColor(PierreColor(name, dark)).Shrink(0)
}

// For is the icon of a file named name under the active icon theme.
func For(name string) *ui.SVG {
	modeMu.RLock()
	mode := iconMode
	modeMu.RUnlock()
	if mode == "zed" {
		return zedFor(name)
	}
	return PierreSVG(name)
}

// Color returns the icon tint for a file named name under the active icon theme.
func Color(name string, dark bool) ui.Color {
	modeMu.RLock()
	mode := iconMode
	modeMu.RUnlock()
	if mode == "zed" {
		return zedColor(name, dark)
	}
	return PierreColor(name, dark)
}

// Folder returns the icon for a directory named name.
func Folder(name string, open bool) *ui.SVG {
	if open {
		return lucide.FolderOpen()
	}
	switch strings.ToLower(filepath.Base(name)) {
	case ".git", ".github":
		return lucide.FolderGit2()
	case ".claude", ".vscode", ".idea", "config", "configs":
		return lucide.FolderCog()
	}
	return lucide.Folder()
}

// FolderColor returns the Zed One Light or One Dark icon tint for a folder.
func FolderColor(open, dark bool) ui.Color {
	if dark {
		if open {
			return ui.Hex("#abb2bf")
		}
		return ui.Hex("#7f848e")
	}
	if open {
		return ui.Hex("#4e515b")
	}
	return ui.Hex("#7c7f8a")
}

func zedFor(name string) *ui.SVG {
	base := strings.ToLower(filepath.Base(name))
	switch base {
	case "dockerfile", "containerfile":
		return lucide.FileBox()
	case "makefile", "justfile", "taskfile.yml", "taskfile.yaml":
		return lucide.FileTerminal()
	case "license", "license.md", "license.txt", "copying":
		return lucide.FileBadge()
	case "go.sum", "cargo.lock", "package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lock", "bun.lockb":
		return lucide.FileLock()
	case ".gitignore", ".gitattributes", ".gitmodules":
		return lucide.FileDiff()
	}
	switch strings.ToLower(filepath.Ext(base)) {
	case ".md", ".markdown", ".mdx", ".txt", ".rst", ".adoc":
		return lucide.FileText()
	case ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp", ".svg", ".ico", ".avif":
		return lucide.Image()
	case ".json", ".jsonc", ".json5", ".graphql", ".gql":
		return lucide.FileBraces()
	case ".toml", ".yaml", ".yml", ".ini", ".conf", ".cfg", ".env", ".properties":
		return lucide.FileSliders()
	case ".sh", ".bash", ".zsh", ".fish", ".ps1", ".bat", ".cmd":
		return lucide.FileTerminal()
	case ".lock", ".sum":
		return lucide.FileLock()
	case ".sql", ".sqlite", ".db":
		return lucide.Database()
	case ".csv", ".tsv", ".xlsx", ".xls":
		return lucide.FileSpreadsheet()
	case ".zip", ".tar", ".gz", ".tgz", ".bz2", ".xz", ".7z", ".zst":
		return lucide.FileArchive()
	case ".go", ".rs", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
		".py", ".rb", ".java", ".kt", ".swift", ".c", ".h", ".cc", ".cpp", ".hpp",
		".cs", ".php", ".lua", ".zig", ".elixir", ".ex", ".exs", ".erl", ".hs",
		".ml", ".scala", ".dart", ".R", ".vue", ".svelte", ".astro",
		".html", ".htm", ".css", ".scss", ".less", ".xml", ".proto":
		return lucide.FileCode()
	}
	if strings.HasPrefix(base, ".env") || strings.HasSuffix(base, "rc") {
		return lucide.FileSliders()
	}
	return lucide.File()
}

func zedColor(name string, dark bool) ui.Color {
	pick := func(light, darkHex string) ui.Color {
		if dark {
			return ui.Hex(darkHex)
		}
		return ui.Hex(light)
	}
	base := strings.ToLower(filepath.Base(name))
	switch base {
	case "go.mod", "go.work":
		return pick("#0184bc", "#56b6c2")
	case "go.sum", "cargo.lock", "package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lock", "bun.lockb":
		return pick("#9d9d9f", "#5c6370")
	case "cargo.toml":
		return pick("#986801", "#d19a66")
	case "dockerfile", "containerfile":
		return pick("#4078f2", "#61afef")
	case "makefile", "justfile":
		return pick("#50a14f", "#98c379")
	case "license", "license.md", "license.txt", "copying":
		return pick("#c18401", "#e5c07b")
	case ".gitignore", ".gitattributes", ".gitmodules":
		return pick("#e45649", "#e06c75")
	}
	switch strings.ToLower(filepath.Ext(base)) {
	case ".go":
		return pick("#0184bc", "#56b6c2")
	case ".rs", ".zig", ".c", ".cc", ".cpp", ".h", ".hpp":
		return pick("#986801", "#d19a66")
	case ".ts", ".tsx", ".py", ".lua", ".dart":
		return pick("#4078f2", "#61afef")
	case ".js", ".jsx", ".mjs", ".cjs", ".json", ".jsonc", ".json5":
		return pick("#c18401", "#e5c07b")
	case ".md", ".markdown", ".mdx":
		return pick("#4078f2", "#61afef")
	case ".html", ".htm", ".vue", ".svelte", ".astro", ".rb":
		return pick("#e45649", "#e06c75")
	case ".css", ".scss", ".less", ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp", ".svg", ".ico":
		return pick("#a626a4", "#c678dd")
	case ".sh", ".bash", ".zsh", ".fish", ".csv", ".tsv":
		return pick("#50a14f", "#98c379")
	case ".toml", ".yaml", ".yml", ".ini", ".conf", ".cfg", ".env", ".sql":
		return pick("#986801", "#e5c07b")
	case ".lock", ".sum":
		return pick("#9d9d9f", "#5c6370")
	}
	return pick("#696c77", "#7f848e")
}
