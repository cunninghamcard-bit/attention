package fileicon

import (
	"embed"
	"path/filepath"
	"strings"
	"sync"

	"github.com/egoist/mygo/ui"
	"github.com/smallnest/uix/components/lucide"
)

var (
	//go:embed icons/files/*.svg
	pierreFiles embed.FS
	pierreMu    sync.RWMutex
	pierreCache = map[string]*ui.SVG{}

	// builtInFileNameTokens matches @pierre/trees BUILT_IN_FILE_NAME_TOKENS.
	builtInFileNameTokens = map[string]string{
		".babelrc":                    "babel",
		".babelrc.json":               "babel",
		".bash_profile":               "bash",
		".bashrc":                     "bash",
		".browserslistrc":             "browserslist",
		".dockerignore":               "docker",
		".eslintignore":               "eslint",
		".eslintrc":                   "eslint",
		".eslintrc.cjs":               "eslint",
		".eslintrc.js":                "eslint",
		".eslintrc.json":              "eslint",
		".eslintrc.yaml":              "eslint",
		".eslintrc.yml":               "eslint",
		".gitattributes":              "git",
		".gitignore":                  "git",
		".gitkeep":                    "git",
		".gitmodules":                 "git",
		".npmignore":                  "npm",
		".npmrc":                      "npm",
		".oxlintrc.json":              "oxc",
		".postcssrc":                  "postcss",
		".postcssrc.json":             "postcss",
		".postcssrc.yaml":             "postcss",
		".postcssrc.yml":              "postcss",
		".prettierignore":             "prettier",
		".prettierrc":                 "prettier",
		".prettierrc.cjs":             "prettier",
		".prettierrc.js":              "prettier",
		".prettierrc.json":            "prettier",
		".prettierrc.mjs":             "prettier",
		".prettierrc.toml":            "prettier",
		".prettierrc.yaml":            "prettier",
		".prettierrc.yml":             "prettier",
		".stylelintignore":            "stylelint",
		".stylelintrc":                "stylelint",
		".stylelintrc.cjs":            "stylelint",
		".stylelintrc.js":             "stylelint",
		".stylelintrc.json":           "stylelint",
		".stylelintrc.mjs":            "stylelint",
		".stylelintrc.yaml":           "stylelint",
		".stylelintrc.yml":            "stylelint",
		".terraform.lock.hcl":         "terraform",
		".zprofile":                   "bash",
		".zshenv":                     "bash",
		".zshrc":                      "bash",
		"agents.md":                   "claude",
		"babel.config.cjs":            "babel",
		"babel.config.js":             "babel",
		"babel.config.json":           "babel",
		"babel.config.mjs":            "babel",
		"biome.json":                  "biome",
		"biome.jsonc":                 "biome",
		"bootstrap.bundle.js":         "bootstrap",
		"bootstrap.bundle.min.js":     "bootstrap",
		"bootstrap.css":               "bootstrap",
		"bootstrap.js":                "bootstrap",
		"bootstrap.min.css":           "bootstrap",
		"bootstrap.min.js":            "bootstrap",
		"bun.lock":                    "bun",
		"bun.lockb":                   "bun",
		"bunfig.toml":                 "bun",
		"cargo.lock":                  "rust",
		"cargo.toml":                  "rust",
		"claude.md":                   "claude",
		"compose.yaml":                "docker",
		"compose.yml":                 "docker",
		"containerfile":               "docker",
		"docker-compose.override.yml": "docker",
		"docker-compose.yaml":         "docker",
		"docker-compose.yml":          "docker",
		"dockerfile":                  "docker",
		"eslint.config.cjs":           "eslint",
		"eslint.config.js":            "eslint",
		"eslint.config.mjs":           "eslint",
		"eslint.config.mts":           "eslint",
		"eslint.config.ts":            "eslint",
		"gemfile":                     "ruby",
		"go.mod":                      "go",
		"go.sum":                      "go",
		"go.work":                     "go",
		"justfile":                    "bash",
		"makefile":                    "bash",
		"next.config.js":              "nextjs",
		"next.config.mjs":             "nextjs",
		"next.config.mts":             "nextjs",
		"next.config.ts":              "nextjs",
		"package-lock.json":           "npm",
		"package.json":                "npm",
		"postcss.config.cjs":          "postcss",
		"postcss.config.js":           "postcss",
		"postcss.config.mjs":          "postcss",
		"postcss.config.ts":           "postcss",
		"prettier.config.cjs":         "prettier",
		"prettier.config.js":          "prettier",
		"prettier.config.mjs":         "prettier",
		"rakefile":                    "ruby",
		"readme.md":                   "markdown",
		"stylelint.config.cjs":        "stylelint",
		"stylelint.config.js":         "stylelint",
		"stylelint.config.mjs":        "stylelint",
		"svgo.config.cjs":             "svgo",
		"svgo.config.js":              "svgo",
		"svgo.config.mjs":             "svgo",
		"svgo.config.ts":              "svgo",
		"tailwind.config.cjs":         "tailwind",
		"tailwind.config.js":          "tailwind",
		"tailwind.config.mjs":         "tailwind",
		"tailwind.config.ts":          "tailwind",
		"vite.config.js":              "vite",
		"vite.config.mjs":             "vite",
		"vite.config.mts":             "vite",
		"vite.config.ts":              "vite",
		"webpack.config.babel.js":     "webpack",
		"webpack.config.cjs":          "webpack",
		"webpack.config.js":           "webpack",
		"webpack.config.mjs":          "webpack",
		"webpack.config.ts":           "webpack",
	}

	// builtInFileExtensionTokens matches @pierre/trees BUILT_IN_FILE_EXTENSION_TOKENS
	// with COMPLETE_EXTENSION_OVERRIDES applied ("complete" set).
	builtInFileExtensionTokens = map[string]string{
		"7z":              "zip",
		"astro":           "astro",
		"authors":         "text",
		"avif":            "image",
		"bash":            "bash",
		"bmp":             "image",
		"bz2":             "zip",
		"c":               "c",
		"cc":              "cpp",
		"cfg":             "text",
		"changelog":       "text",
		"cjs":             "javascript",
		"code-workspace":  "vscode",
		"conf":            "text",
		"contributors":    "text",
		"cpp":             "cpp",
		"csh":             "bash",
		"css":             "css",
		"csv":             "table",
		"cts":             "typescript",
		"cxx":             "cpp",
		"db":              "database",
		"editorconfig":    "text",
		"env":             "text",
		"env.development": "text",
		"env.local":       "text",
		"env.production":  "text",
		"eot":             "font",
		"erb":             "ruby",
		"fish":            "bash",
		"gemspec":         "ruby",
		"gif":             "image",
		"go":              "go",
		"gql":             "graphql",
		"graphql":         "graphql",
		"gz":              "zip",
		"h":               "c",
		"hh":              "cpp",
		"hpp":             "cpp",
		"htm":             "html",
		"html":            "html",
		"hxx":             "cpp",
		"icns":            "image",
		"ico":             "image",
		"ini":             "text",
		"inl":             "cpp",
		"jar":             "zip",
		"jpeg":            "image",
		"jpg":             "image",
		"js":              "javascript",
		"json":            "json",
		"json5":           "json",
		"jsonc":           "json",
		"jsonl":           "json",
		"jsx":             "react",
		"ksh":             "bash",
		"less":            "css",
		"license":         "text",
		"log":             "text",
		"markdown":        "markdown",
		"mcp":             "mcp",
		"md":              "markdown",
		"mdx":             "markdown",
		"mdx.tsx":         "markdown",
		"mjs":             "javascript",
		"mm":              "cpp",
		"mts":             "typescript",
		"ods":             "table",
		"otf":             "font",
		"png":             "image",
		"postcss":         "css",
		"py":              "python",
		"pyi":             "python",
		"pyw":             "python",
		"pyx":             "python",
		"rake":            "ruby",
		"rar":             "zip",
		"rb":              "ruby",
		"rs":              "rust",
		"rst":             "text",
		"rtf":             "text",
		"sass":            "sass",
		"scss":            "sass",
		"sh":              "bash",
		"sql":             "database",
		"sqlite":          "database",
		"sqlite3":         "database",
		"styl":            "css",
		"svelte":          "svelte",
		"svg":             "svg",
		"swift":           "swift",
		"tar":             "zip",
		"tf":              "terraform",
		"tfstate":         "terraform",
		"tfvars":          "terraform",
		"tgz":             "zip",
		"tif":             "image",
		"tiff":            "image",
		"toml":            "yml",
		"ts":              "typescript",
		"tsv":             "table",
		"tsx":             "react",
		"ttf":             "font",
		"txt":             "text",
		"vue":             "vue",
		"war":             "zip",
		"wasm":            "wasm",
		"wast":            "wasm",
		"wat":             "wasm",
		"webp":            "image",
		"woff":            "font",
		"woff2":           "font",
		"xhtml":           "html",
		"xls":             "table",
		"xlsx":            "table",
		"xz":              "zip",
		"yaml":            "yml",
		"yml":             "yml",
		"zig":             "zig",
		"zip":             "zip",
		"zsh":             "bash",
	}
)

// Pierre returns the @pierre/trees SVG icon for a file or folder.
func Pierre(name string, dir, open, _ bool) *ui.SVG {
	if dir {
		if open {
			return lucide.FolderOpen()
		}
		return lucide.FolderClosed()
	}
	return PierreSVG(name)
}

// PierreSVG returns the @pierre/trees "complete" SVG symbol for a file named name.
func PierreSVG(name string) *ui.SVG {
	tok := pierreFileToken(filepath.Base(name))
	pierreMu.RLock()
	svg := pierreCache[tok]
	pierreMu.RUnlock()
	if svg != nil {
		return svg
	}
	b, err := pierreFiles.ReadFile("icons/files/" + tok + ".svg")
	if err != nil {
		b, _ = pierreFiles.ReadFile("icons/files/default.svg")
	}
	svg = ui.MustParseSVG(b)
	pierreMu.Lock()
	pierreCache[tok] = svg
	pierreMu.Unlock()
	return svg
}

// PierreColor returns the semantic hue for a @pierre/trees icon token from
// apps/web/ui/file-type-icon.css.
func PierreColor(name string, dark bool) ui.Color {
	pick := func(light, darkHex string) ui.Color {
		if dark {
			return ui.Hex(darkHex)
		}
		return ui.Hex(light)
	}
	switch pierreFileToken(filepath.Base(name)) {
	case "astro", "database", "vite":
		return pick("#a631be", "#d568ea")
	case "babel", "browserslist", "javascript":
		return pick("#d5a910", "#ffd452")
	case "bash", "markdown", "svgo", "vue":
		return pick("#199f43", "#5ecc71")
	case "biome", "c", "cpp", "docker", "python", "typescript", "vscode", "webpack":
		return pick("#1a85d4", "#69b1ff")
	case "bootstrap", "css", "eslint", "stylelint", "terraform", "wasm":
		return pick("#693acf", "#9d6afb")
	case "bun", "nextjs":
		return pick("#594c5b", "#79697b")
	case "claude", "html", "json", "rust", "svg", "swift", "zig", "zip":
		return pick("#d47628", "#ffa359")
	case "git":
		return pick("#ff8c5b", "#d5512f")
	case "go", "oxc", "react", "tailwind":
		return pick("#1ca1c7", "#68cdf2")
	case "font", "graphql", "image", "sass":
		return pick("#d32a61", "#ff678d")
	case "mcp", "prettier", "table":
		return pick("#17a5af", "#64d1db")
	case "npm", "postcss", "ruby", "svelte", "yml":
		return pick("#d52c36", "#ff6762")
	default:
		return pick("#84848a", "#adadb1")
	}
}

func pierreFileToken(name string) string {
	lower := strings.ToLower(name)
	if tok, ok := builtInFileNameTokens[lower]; ok {
		return tok
	}
	for i := strings.IndexByte(lower, '.'); i >= 0; {
		ext := lower[i+1:]
		if tok, ok := builtInFileExtensionTokens[ext]; ok {
			return tok
		}
		j := strings.IndexByte(ext, '.')
		if j < 0 {
			break
		}
		i += 1 + j
	}
	if tok, ok := builtInFileExtensionTokens[lower]; ok {
		return tok
	}
	return "default"
}
