// Package fileicon picks a file's icon and semantic color by its name or
// extension, for the tree, tabs, quick switcher and search.
package fileicon

import (
	"path/filepath"
	"strings"

	"github.com/cunninghamcard-bit/acard-ui/icon"
	"github.com/egoist/mygo/ui"

	auiicon "github.com/cunninghamcard-bit/attention/native/ui/icon"
)

// Theme is which icons files get: none unless Show, else the Name set ("pierre" or "zed").
type Theme struct {
	Show bool
	Name string
}

// Render draws a file or folder icon at size (in DIPs) when file icons are enabled.
func (t Theme) Render(c *ui.Context, name string, dir, open, dark bool, size float32) {
	if !t.Show {
		return
	}
	if t.Name == "zed" {
		if dir {
			ui.Icon(c, Folder(name, open)).Size(size, size).TextColor(FolderColor(open, dark)).Shrink(0)
			return
		}
		ui.Icon(c, zedFor(name)).Size(size, size).TextColor(zedColor(name, dark)).Shrink(0)
		return
	}
	if dir {
		svg := auiicon.Must("folder-closed")
		if open {
			svg = icon.FolderOpen.SVG()
		}
		ui.Icon(c, svg).Size(size, size).TextColor(c.Theme().TextMuted).Shrink(0)
		return
	}
	ui.Icon(c, PierreSVG(name)).Size(size, size).TextColor(PierreColor(name, dark)).Shrink(0)
}

// For is the icon of a file named name.
func (t Theme) For(name string) *ui.SVG {
	if t.Name == "zed" {
		return zedFor(name)
	}
	return PierreSVG(name)
}

// Color returns the icon tint for a file named name.
func (t Theme) Color(name string, dark bool) ui.Color {
	if t.Name == "zed" {
		return zedColor(name, dark)
	}
	return PierreColor(name, dark)
}

// Folder returns the icon for a directory named name.
func Folder(name string, open bool) *ui.SVG {
	if open {
		return icon.FolderOpen.SVG()
	}
	switch strings.ToLower(filepath.Base(name)) {
	case ".git", ".github":
		return auiicon.Must("folder-git-2")
	case ".claude", ".vscode", ".idea", "config", "configs":
		return auiicon.Must("folder-cog")
	}
	return icon.Folder.SVG()
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
		return auiicon.Must("file-box")
	case "makefile", "justfile", "taskfile.yml", "taskfile.yaml":
		return auiicon.Must("file-terminal")
	case "license", "license.md", "license.txt", "copying":
		return auiicon.Must("file-badge")
	case "go.sum", "cargo.lock", "package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lock", "bun.lockb":
		return auiicon.Must("file-lock")
	case ".gitignore", ".gitattributes", ".gitmodules":
		return auiicon.Must("file-diff")
	}
	switch strings.ToLower(filepath.Ext(base)) {
	case ".md", ".markdown", ".mdx", ".txt", ".rst", ".adoc":
		return icon.FileText.SVG()
	case ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp", ".svg", ".ico", ".avif":
		return icon.Image.SVG()
	case ".json", ".jsonc", ".json5", ".graphql", ".gql":
		return auiicon.Must("file-braces")
	case ".toml", ".yaml", ".yml", ".ini", ".conf", ".cfg", ".env", ".properties":
		return auiicon.Must("file-sliders")
	case ".sh", ".bash", ".zsh", ".fish", ".ps1", ".bat", ".cmd":
		return auiicon.Must("file-terminal")
	case ".lock", ".sum":
		return auiicon.Must("file-lock")
	case ".sql", ".sqlite", ".db":
		return icon.Database.SVG()
	case ".csv", ".tsv", ".xlsx", ".xls":
		return icon.FileSpreadsheet.SVG()
	case ".zip", ".tar", ".gz", ".tgz", ".bz2", ".xz", ".7z", ".zst":
		return icon.FileArchive.SVG()
	case ".go", ".rs", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
		".py", ".rb", ".java", ".kt", ".swift", ".c", ".h", ".cc", ".cpp", ".hpp",
		".cs", ".php", ".lua", ".zig", ".elixir", ".ex", ".exs", ".erl", ".hs",
		".ml", ".scala", ".dart", ".R", ".vue", ".svelte", ".astro",
		".html", ".htm", ".css", ".scss", ".less", ".xml", ".proto":
		return auiicon.Must("file-code")
	}
	if strings.HasPrefix(base, ".env") || strings.HasSuffix(base, "rc") {
		return auiicon.Must("file-sliders")
	}
	return icon.File.SVG()
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
