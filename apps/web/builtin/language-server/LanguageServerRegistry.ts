/**
 * Input: None
 * Output: LanguageServerSpec, LanguageGroup, LANGUAGE_SERVERS, LANGUAGE_GROUPS, getLanguageServer, languageForExtension
 * Pos: Application code
 *
 * 🔄 Self-reference: When this file changes, update this header
 */

/**
 * The language-server table: which servers exist, how each is launched, and
 * which languages each serves.
 *
 * This is the one place a language is added. A server is a row here — a
 * command and its arguments — not code: everything that talks to it
 * (`LanguageServerService`, the code view) is language-agnostic.
 *
 * Only servers that speak LSP over stdio from a single command are listed.
 * Nothing is downloaded: a server is used when its command is installed.
 */

export interface LanguageServerSpec {
  /** Stable id, used in settings. */
  id: string;
  name: string;
  /** The command looked up on the search path. */
  command: string;
  args: string[];
  /** One line telling the user how to get it; shown when it is missing. */
  install: string;
}

export interface LanguageGroup {
  id: string;
  name: string;
  /** File extension (no dot) → the LSP `languageId` sent in `didOpen`. */
  extensions: Record<string, string>;
  /** Server ids in preference order; the first one that starts is used. */
  servers: string[];
}

export const LANGUAGE_SERVERS: readonly LanguageServerSpec[] = [
  {
    id: "ty",
    name: "ty",
    command: "ty",
    args: ["server"],
    install: "uv tool install ty",
  },
  {
    id: "pyrefly",
    name: "Pyrefly",
    command: "pyrefly",
    args: ["lsp"],
    install: "uv tool install pyrefly",
  },
  {
    id: "basedpyright",
    name: "basedpyright",
    command: "basedpyright-langserver",
    args: ["--stdio"],
    install: "uv tool install basedpyright",
  },
  {
    id: "pyright",
    name: "Pyright",
    command: "pyright-langserver",
    args: ["--stdio"],
    install: "npm install -g pyright",
  },
  {
    // TypeScript 7 (the native compiler) ships its language server inside
    // `tsc`. An older `tsc` rejects the flag and exits, which the service
    // treats like any failed start: it moves on to the next server.
    id: "typescript",
    name: "TypeScript",
    command: "tsc",
    args: ["--lsp", "--stdio"],
    install: "npm install -g typescript",
  },
  {
    id: "tsgo",
    name: "TypeScript (native preview)",
    command: "tsgo",
    args: ["--lsp", "--stdio"],
    install: "npm install -g @typescript/native-preview",
  },
  {
    id: "typescript-language-server",
    name: "typescript-language-server",
    command: "typescript-language-server",
    args: ["--stdio"],
    install: "npm install -g typescript-language-server typescript",
  },
  {
    id: "gopls",
    name: "gopls",
    command: "gopls",
    args: [],
    install: "go install golang.org/x/tools/gopls@latest",
  },
  {
    id: "rust-analyzer",
    name: "rust-analyzer",
    command: "rust-analyzer",
    args: [],
    install: "rustup component add rust-analyzer",
  },
  {
    id: "clangd",
    name: "clangd",
    command: "clangd",
    args: [],
    install: "Install LLVM (clangd ships with it)",
  },
];

export const LANGUAGE_GROUPS: readonly LanguageGroup[] = [
  {
    id: "python",
    name: "Python",
    extensions: { py: "python", pyi: "python" },
    servers: ["ty", "pyrefly", "basedpyright", "pyright"],
  },
  {
    id: "typescript",
    name: "TypeScript / JavaScript",
    extensions: {
      ts: "typescript",
      mts: "typescript",
      cts: "typescript",
      tsx: "typescriptreact",
      js: "javascript",
      mjs: "javascript",
      cjs: "javascript",
      jsx: "javascriptreact",
    },
    servers: ["typescript", "tsgo", "typescript-language-server"],
  },
  {
    id: "go",
    name: "Go",
    extensions: { go: "go" },
    servers: ["gopls"],
  },
  {
    id: "rust",
    name: "Rust",
    extensions: { rs: "rust" },
    servers: ["rust-analyzer"],
  },
  {
    id: "cpp",
    name: "C / C++",
    extensions: { c: "c", h: "c", cc: "cpp", cpp: "cpp", hpp: "cpp" },
    servers: ["clangd"],
  },
];

export function getLanguageServer(id: string): LanguageServerSpec | null {
  return LANGUAGE_SERVERS.find((server) => server.id === id) ?? null;
}

/** The group and LSP language id for a file extension; `null` when unserved. */
export function languageForExtension(
  extension: string,
): { group: LanguageGroup; languageId: string } | null {
  const ext = extension.toLowerCase();
  for (const group of LANGUAGE_GROUPS) {
    const languageId = group.extensions[ext];
    if (languageId) return { group, languageId };
  }
  return null;
}
