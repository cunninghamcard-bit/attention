// Architecture alarm for docs/architecture/monorepo-restore/spec.md (and
// the project constitution it inherits).
//
// Every rule below is enforced by a small pure checker function: give it data
// (parsed yaml text, manifest objects, or {path, imports} records) and it
// returns violations. Each `it` exercises a checker twice where the spec asks
// for it — once against data read from the real tree (the alarm), once against
// a synthetic record (the alarm's own self-test).

import { describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, type Dirent } from "node:fs";
import { join, posix } from "node:path";

// vitest's root config lives at the repo root, so tests always run with cwd there.
const ROOT = process.cwd();
// The renderer lane: the apps/web package (formerly src/renderer).
const WEB_SRC = "apps/web";

function abs(...segments: string[]): string {
  return join(ROOT, ...segments);
}

function readText(relPath: string): string {
  return readFileSync(abs(relPath), "utf8");
}

// ---------------------------------------------------------------------------
// Pure checkers
// ---------------------------------------------------------------------------

/** Parses the plain-text `packages:` list of a pnpm workspace file. */
function parseWorkspacePackages(yamlText: string): string[] {
  const lines = yamlText.split("\n");
  const start = lines.findIndex((line) => /^packages:\s*$/.test(line.trim()));
  if (start === -1) return [];
  const entries: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*#/.test(line)) continue; // comments interleave the list
    const match = line.match(/^\s*-\s*(.+?)\s*$/);
    if (!match) {
      if (line.trim() === "") continue;
      break;
    }
    entries.push(match[1]);
  }
  return entries;
}

interface Manifest {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

/** Reports which of `forbidden` show up in a manifest's dependency tables. */
function findLaneViolations(manifest: Manifest, forbidden: string[]): string[] {
  const deps = { ...(manifest.dependencies ?? {}), ...(manifest.devDependencies ?? {}) };
  return forbidden.filter((name) => name in deps);
}

interface SourceFile {
  /** repo-relative, posix-separated, e.g. "apps/web/vault/Vault.ts" */
  path: string;
  /** raw import specifiers as written in the file */
  imports: string[];
}

/** Resolves a relative import specifier against the file that contains it. */
function resolveRelativeImport(fromFile: string, specifier: string): string {
  return posix.normalize(posix.join(posix.dirname(fromFile), specifier));
}

/** First path segment under `apps/web/` that `resolvedPath` lands in, else null. */
function topLevelWebSrcDir(resolvedPath: string): string | null {
  const marker = `${WEB_SRC}/`;
  const idx = resolvedPath.indexOf(marker);
  if (idx === -1) return null;
  return resolvedPath.slice(idx + marker.length).split("/")[0] ?? null;
}

/** Rule: kernel-direction. Kernel code may only reach into these directories. */
const KERNEL_ALLOWED_TARGETS = new Set(["vault", "metadata", "storage", "core", "dom", "platform"]);

function findKernelDirectionViolations(
  files: SourceFile[],
): Array<{ path: string; import: string }> {
  const violations: Array<{ path: string; import: string }> = [];
  for (const file of files) {
    for (const spec of file.imports) {
      if (!spec.startsWith(".")) continue; // bare specifiers (npm packages) are never "above the kernel"
      const target = topLevelWebSrcDir(resolveRelativeImport(file.path, spec));
      if (target && !KERNEL_ALLOWED_TARGETS.has(target))
        violations.push({ path: file.path, import: spec });
    }
  }
  return violations;
}

/**
 * Rule: dual-track-api. Files outside api/ must not import it, except the one
 * documented facade-construction seam: the plugin `require("obsidian")` shim
 * has to build and hand out the facade object somewhere, and that call is
 * necessarily made from outside api/ (record 0005 dual-track design).
 */
const API_FACADE_ALLOWED_CALLERS = [`${WEB_SRC}/plugin/PluginRequire.ts`];

function findApiFacadeViolations(
  files: SourceFile[],
  allowedCallers: readonly string[] = [],
): Array<{ path: string; import: string }> {
  const violations: Array<{ path: string; import: string }> = [];
  for (const file of files) {
    if (allowedCallers.includes(file.path)) continue;
    for (const spec of file.imports) {
      if (!spec.startsWith(".")) continue;
      const target = topLevelWebSrcDir(resolveRelativeImport(file.path, spec));
      if (target === "api") violations.push({ path: file.path, import: spec });
    }
  }
  return violations;
}

/**
 * Rule: single-package. The renderer may not import the shell. A shell import
 * is a bare `electron` / `@electron/remote`, a `@desktop`/`@main`/`@preload`
 * alias, or a relative import that escapes into apps/desktop/{main,preload}.
 */
const SHELL_BARE = ["electron", "@electron/remote"];
const SHELL_ALIASES = ["@desktop", "@main", "@preload"];

function findRendererShellImports(files: SourceFile[]): Array<{ path: string; import: string }> {
  const violations: Array<{ path: string; import: string }> = [];
  for (const file of files) {
    for (const spec of file.imports) {
      const bare = SHELL_BARE.some((name) => spec === name || spec.startsWith(`${name}/`));
      const aliased = SHELL_ALIASES.some((name) => spec === name || spec.startsWith(`${name}/`));
      let relative = false;
      if (spec.startsWith(".")) {
        const resolved = resolveRelativeImport(file.path, spec);
        relative =
          resolved === "apps/desktop/main" ||
          resolved === "apps/desktop/preload" ||
          resolved.startsWith("apps/desktop/main/") ||
          resolved.startsWith("apps/desktop/preload/");
      }
      if (bare || aliased || relative) violations.push({ path: file.path, import: spec });
    }
  }
  return violations;
}

/**
 * Rule: shell-wall. The boundary points both ways: the shell may not import
 * renderer SOURCE either — its shared symbols come from @app/shared, and it
 * consumes the renderer only as build output. A renderer import is a
 * `@app/web`/`@web` alias or a relative import that escapes into apps/web
 * (docs/architecture/web-desktop-boundary/spec.md).
 */
const RENDERER_ALIASES = ["@app/web", "@web"];

function findShellRendererImports(files: SourceFile[]): Array<{ path: string; import: string }> {
  const violations: Array<{ path: string; import: string }> = [];
  for (const file of files) {
    for (const spec of file.imports) {
      const aliased = RENDERER_ALIASES.some((name) => spec === name || spec.startsWith(`${name}/`));
      let relative = false;
      if (spec.startsWith(".")) {
        const resolved = resolveRelativeImport(file.path, spec);
        relative = resolved === "apps/web" || resolved.startsWith("apps/web/");
      }
      if (aliased || relative) violations.push({ path: file.path, import: spec });
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------
// fs helpers (kept separate from the pure checkers above)
// ---------------------------------------------------------------------------

const DEFAULT_SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "out",
  "dist",
  "dist-electron",
  "coverage",
]);

function walk(dirAbs: string, skipDirs: Set<string>, out: string[]): void {
  let entries: Dirent[];
  try {
    entries = readdirSync(dirAbs, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (skipDirs.has(entry.name)) continue;
      walk(join(dirAbs, entry.name), skipDirs, out);
    } else if (entry.isFile()) {
      out.push(join(dirAbs, entry.name));
    }
  }
}

function listFilesRecursive(
  dirAbs: string,
  extensions: string[],
  skipDirs: Set<string> = DEFAULT_SKIP_DIRS,
): string[] {
  if (!existsSync(dirAbs)) return [];
  const out: string[] = [];
  walk(dirAbs, skipDirs, out);
  return out.filter((file) => extensions.some((ext) => file.endsWith(ext)));
}

const IMPORT_RE = /\b(?:from\s+|import\s*\(\s*|import\s+|require\(\s*)["']([^"']+)["']/g;

function extractImports(source: string): string[] {
  return [...source.matchAll(IMPORT_RE)].map((match) => match[1]);
}

function findForbiddenImportViolations(files: SourceFile[], forbidden: string[]): SourceFile[] {
  return files.filter((file) =>
    file.imports.some((specifier) =>
      forbidden.some((name) => specifier === name || specifier.startsWith(`${name}/`)),
    ),
  );
}

function sourceFilesUnder(
  relDirs: string[],
  extensions: string[],
  excludeTests: boolean,
): SourceFile[] {
  const files: SourceFile[] = [];
  for (const relDir of relDirs) {
    for (const fileAbs of listFilesRecursive(abs(relDir), extensions)) {
      if (excludeTests && fileAbs.endsWith(".test.ts")) continue;
      const path = posix.join(
        relDir,
        fileAbs
          .slice(abs(relDir).length + 1)
          .split("\\")
          .join("/"),
      );
      files.push({ path, imports: extractImports(readFileSync(fileAbs, "utf8")) });
    }
  }
  return files;
}

function listTopLevelDirNames(dirAbs: string): string[] {
  return readdirSync(dirAbs, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

/**
 * A native-seam file consumes a port from @app/shared when it imports the port
 * name from a `shared/…` specifier and does NOT re-declare the interface itself.
 */
function importsPortFromShared(relFile: string, port: string): boolean {
  const source = readText(relFile);
  const hasLocalDecl = new RegExp(`\\binterface\\s+${port}\\b`).test(source);
  const importsPort = [
    ...source.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/g),
  ].some(
    ([, names, specifier]) =>
      specifier.includes("shared/") &&
      names
        .split(",")
        .map((piece) => piece.replace(/\btype\b/, "").trim())
        .includes(port),
  );
  return importsPort && !hasLocalDecl;
}

// ---------------------------------------------------------------------------
// Rule: monorepo-shape — one repo, three lanes
// ---------------------------------------------------------------------------

describe("Rule: monorepo-shape — one repo, three lanes", () => {
  it("declares the monorepo layout with the kernel seated", () => {
    const packages = parseWorkspacePackages(readText("pnpm-workspace.yaml"));

    // The workspace lanes: app packages, shared packages, the tests lane.
    expect(packages).toContain("apps/*");
    expect(packages).toContain("packages/*");
    expect(packages).toContain("tests");
    for (const lane of ["apps/web", "apps/desktop", "packages/shared", "packages/sdk"]) {
      expect(existsSync(abs(lane, "package.json")), `${lane}/package.json should exist`).toBe(true);
    }

    // No top-level src remains: the single-package layout is gone.
    expect(existsSync(abs("src"))).toBe(false);

    // The Go kernel lane sits at the repo root, outside the pnpm workspace.
    for (const kernelLane of ["cmd", "internal", "go.mod"]) {
      expect(existsSync(abs(kernelLane)), `${kernelLane} should sit at the repo root`).toBe(true);
    }
  });

  it("keeps the renderer free of shell imports", () => {
    const files = sourceFilesUnder([WEB_SRC], [".ts", ".tsx"], true);

    expect(findRendererShellImports(files)).toEqual([]);

    const synthetic: SourceFile = {
      path: `${WEB_SRC}/vault/X.ts`,
      imports: ["electron", "@desktop/ipc", "../../desktop/main/state"],
    };
    expect(findRendererShellImports([synthetic])).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// Rule: shell-wall — the boundary points both ways
// (docs/architecture/web-desktop-boundary/spec.md)
// ---------------------------------------------------------------------------

describe("Rule: shell-wall — the boundary points both ways", () => {
  it("keeps the shell free of renderer-source imports", () => {
    const files = sourceFilesUnder(["apps/desktop"], [".ts", ".tsx"], true);

    expect(findShellRendererImports(files)).toEqual([]);

    const synthetic: SourceFile = {
      path: "apps/desktop/main/X.ts",
      imports: [
        "@app/web/app/protocol/scheme",
        "../../web/platform/Platform",
        "@app/shared/scheme",
      ],
    };
    expect(findShellRendererImports([synthetic])).toHaveLength(2);
  });

  it("imports the wire contracts from @app/shared on both sides", () => {
    // URL scheme: renderer URI router + main URL parser share one constant
    expect(importsPortFromShared("apps/web/app/protocol/UriRouter.ts", "URL_SCHEME")).toBe(true);
    expect(importsPortFromShared("apps/desktop/main/obsidian-url.ts", "URL_SCHEME")).toBe(true);
    // system-menu template: renderer builder + main consumer share one shape
    expect(
      importsPortFromShared("apps/web/platform/desktop/DesktopMenu.ts", "SystemMenuItem"),
    ).toBe(true);
    expect(importsPortFromShared("apps/desktop/main/menu.ts", "SystemMenuItem")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Rule: shared-contracts — the native seam is one typed contract
// ---------------------------------------------------------------------------

describe("Rule: shared-contracts — the native seam is one typed contract", () => {
  it("declares the native port contracts in shared", () => {
    const git = readText("packages/shared/gitApi.ts");
    const terminal = readText("packages/shared/terminalApi.ts");
    const data = readText("packages/shared/dataAdapter.ts");
    const ipc = readText("packages/shared/ipc.ts");

    expect(git).toMatch(/export interface ElectronGitApi\b/);
    expect(terminal).toMatch(/export interface ElectronTerminalApi\b/);
    expect(data).toMatch(/export interface DataAdapter\b/);
    // a typed IPC channel table: channel name → request/response types
    expect(ipc).toMatch(/export interface SyncChannels\b/);
    expect(ipc).toMatch(/export type IpcChannelName\b/);
  });

  it("imports the shared contracts from both main and renderer", () => {
    // git port: renderer caller + main handler both compile against @app/shared
    expect(importsPortFromShared("apps/web/builtin/git/GitService.ts", "ElectronGitApi")).toBe(
      true,
    );
    expect(importsPortFromShared("apps/desktop/preload/git-bridge.ts", "ElectronGitApi")).toBe(
      true,
    );
    // terminal port: same on both sides
    expect(
      importsPortFromShared("apps/web/builtin/terminal/TerminalAdapter.ts", "ElectronTerminalApi"),
    ).toBe(true);
    expect(
      importsPortFromShared("apps/desktop/preload/terminal-bridge.ts", "ElectronTerminalApi"),
    ).toBe(true);
  });

  it("keeps zod presenters and UI frameworks out of the dependency table", () => {
    const root: Manifest = JSON.parse(readText("package.json"));
    const tests: Manifest = JSON.parse(readText("tests/package.json"));
    const forbidden = ["zod", "react", "react-dom", "vue"];

    expect(findLaneViolations(root, forbidden)).toEqual([]);
    expect(findLaneViolations(tests, forbidden)).toEqual([]);
    expect(readText("pnpm-lock.yaml")).not.toMatch(/^\s{2}(?:react|react-dom|vue|zod)@/m);

    // self-test
    expect(findLaneViolations({ dependencies: { react: "1" } }, forbidden)).toEqual(["react"]);
  });
});

// ---------------------------------------------------------------------------
// Rule: perf-red-line — vault reads stay in-process (structural guard; the
// openFile-median measurement itself is the e2e:perf gate, human-signed-off).
// ---------------------------------------------------------------------------

describe("Rule: perf-red-line — vault reads stay in-process", () => {
  it("keeps vault reads in-process (the perf red line)", () => {
    const adapter = readText("apps/web/vault/FileSystemAdapter.ts");
    // the vault fs adapter loads node fs in-process — not an IPC/kernel backend
    expect(adapter).toMatch(/node:fs\/promises/);
    expect(adapter).toContain("loadDesktopModules");
    // the read/write path never routes over IPC — the measured-and-rejected design
    const readSection = adapter.slice(
      adapter.indexOf("async read("),
      adapter.indexOf("async delete("),
    );
    expect(readSection).not.toMatch(/ipcRenderer|\.invoke\(|sendSync/);
    // bootstrap installs FileSystemAdapter as the vault adapter through the seam
    const bootstrap = readText("apps/web/bootstrap.ts");
    expect(bootstrap).toContain("FileSystemAdapter");
    expect(bootstrap).toContain("provideAppAdapter");
  });
});

// ---------------------------------------------------------------------------
// Rule: kernel-seam — the port is gone, the seat stays empty
// ---------------------------------------------------------------------------

describe("Rule: kernel-seam — the port is gone, the seat stays empty", () => {
  it("removes the kernel port and every reference", () => {
    // The KernelApi port is deleted this ticket (owner override); its generated
    // successor sits in @app/sdk, which stays an empty seat until the
    // kernel-integration ticket.
    const files = sourceFilesUnder(["apps", "packages"], [".ts", ".tsx"], false);
    const offenders = files.filter(
      (file) =>
        /\bKernelApi\b/.test(readText(file.path)) ||
        file.imports.some((spec) => /kernelApi/i.test(spec)),
    );
    expect(offenders.map((file) => file.path)).toEqual([]);

    // No kernel binary is a workspace member.
    const packages = parseWorkspacePackages(readText("pnpm-workspace.yaml"));
    expect(packages.some((pkg) => /kernel/i.test(pkg))).toBe(false);

    // @app/sdk is an empty seat: a manifest only, no runtime code, no deps.
    const sdk = JSON.parse(readText("packages/sdk/package.json")) as {
      dependencies?: Record<string, string>;
    };
    expect(sdk.dependencies ?? {}).toEqual({});
    const sdkSource = sourceFilesUnder(["packages/sdk"], [".ts", ".tsx", ".js"], false);
    expect(sdkSource.map((file) => file.path)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Rule: kernel-history — the subtree keeps its past
// ---------------------------------------------------------------------------

describe("Rule: kernel-history — the subtree keeps its past", () => {
  it("keeps the kernel commit history reachable and blame honest", () => {
    // log --follow on a kernel path reaches back past the merge: the kernel
    // repository's own commits are on this branch, under their original hashes.
    const log = execSync("git log --format=%s --follow -- cmd/along/main.go", {
      cwd: ROOT,
      encoding: "utf8",
    });
    const subjects = log.split("\n").filter(Boolean);
    expect(subjects.length).toBeGreaterThan(1);

    // The pure-relocation commit that would swamp blame is recorded for
    // --ignore-revs (looked up by subject so a rebase does not stale it).
    const renameHash = execSync('git log --format=%H --grep="split src into apps/web" -1', {
      cwd: ROOT,
      encoding: "utf8",
    }).trim();
    expect(renameHash).toMatch(/^[0-9a-f]{40}$/);
    expect(readText(".git-blame-ignore-revs")).toContain(renameHash);
  });
});

// ---------------------------------------------------------------------------
// Rule: zero-react — the source tree has one UI paradigm
// ---------------------------------------------------------------------------

describe("Rule: zero-react — the source tree has one UI paradigm", () => {
  it("keeps the source tree free of react imports", () => {
    const files = sourceFilesUnder(
      ["apps", "packages", "tests"],
      [".ts", ".tsx", ".js", ".jsx"],
      false,
    );
    const forbidden = ["react", "react-dom", "@pierre/diffs/react"];
    const syntheticSource = `import "${["rea", "ct"].join("")}"; import("${[
      "react",
      "dom/client",
    ].join("-")}")`;

    expect(findForbiddenImportViolations(files, forbidden)).toEqual([]);
    expect(
      findForbiddenImportViolations(
        [
          {
            path: "apps/web/example.ts",
            imports: extractImports(syntheticSource),
          },
        ],
        forbidden,
      ),
    ).toHaveLength(1);
  });

  it("keeps react and moment out of the dependency table", () => {
    const root: Manifest = JSON.parse(readText("package.json"));
    const tests: Manifest = JSON.parse(readText("tests/package.json"));
    const forbidden = ["react", "react-dom", "@types/react", "@types/react-dom", "moment"];

    expect(findLaneViolations(root, forbidden)).toEqual([]);
    expect(findLaneViolations(tests, forbidden)).toEqual([]);
    expect(readText("pnpm-workspace.yaml")).toContain("autoInstallPeers: false");
    expect(readText("pnpm-lock.yaml")).not.toMatch(/^\s{2}(?:react|react-dom|moment)@/m);
    expect(findLaneViolations({ dependencies: { react: "1" } }, forbidden)).toEqual(["react"]);
  });
});

// ---------------------------------------------------------------------------
// Rule: kernel-direction — the kernel stays headless-ready
// ---------------------------------------------------------------------------

describe("Rule: kernel-direction — the kernel stays headless-ready", () => {
  it("kernel directories import nothing above the kernel", () => {
    const files = sourceFilesUnder(
      [`${WEB_SRC}/vault`, `${WEB_SRC}/metadata`, `${WEB_SRC}/storage`],
      [".ts"],
      true, // ponytail: test fixtures legitimately reach for App/ViewRegistry; only production direction matters here
    );

    expect(findKernelDirectionViolations(files)).toEqual([]);
  });

  it("flags an upward import from kernel", () => {
    const synthetic: SourceFile = { path: `${WEB_SRC}/vault/X.ts`, imports: ["../ui/Modal"] };

    expect(findKernelDirectionViolations([synthetic])).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Rule: dual-track-api — the public facade serves only community plugins
// ---------------------------------------------------------------------------

describe("Rule: dual-track-api — the public facade serves only community plugins", () => {
  it("internal code never imports the public api facade", () => {
    const allFiles = listFilesRecursive(abs(WEB_SRC), [".ts"])
      .filter((fileAbs) => !fileAbs.endsWith(".test.ts")) // ponytail: parity tests legitimately verify the facade's own shape
      .map((fileAbs) => ({
        path: posix.join(
          WEB_SRC,
          fileAbs
            .slice(abs(WEB_SRC).length + 1)
            .split("\\")
            .join("/"),
        ),
        imports: extractImports(readFileSync(fileAbs, "utf8")),
      }))
      .filter((file) => topLevelWebSrcDir(file.path) !== "api")
      // index.ts is the public entry point itself (out/api/index.js) — it IS the facade's composition root.
      .filter((file) => file.path !== `${WEB_SRC}/index.ts`);

    expect(findApiFacadeViolations(allFiles, API_FACADE_ALLOWED_CALLERS)).toEqual([]);
  });

  it("flags an internal import of the api facade", () => {
    const synthetic: SourceFile = {
      path: `${WEB_SRC}/workspace/X.ts`,
      imports: ["../api/PublicApi"],
    };

    expect(findApiFacadeViolations([synthetic])).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Rule: builtin-roof — one core plugin per slice
// ---------------------------------------------------------------------------

describe("Rule: builtin-roof — one core plugin per slice", () => {
  it("builtin roof holds one directory per core plugin", () => {
    const corePlugins = [
      "canvas",
      "git",
      "github",
      "graph",
      "webviewer",
      "theme-market",
      "terminal",
    ];
    const builtinDirs = new Set(listTopLevelDirNames(abs(WEB_SRC, "builtin")));
    // `public/` holds static assets served verbatim (readability.js, fonts) — a
    // sibling of the source directories, not one of them. node_modules/ and out/
    // are workspace tooling artifacts (dependency links, the api build), also
    // not source directories.
    const sourceDirs = listTopLevelDirNames(abs(WEB_SRC)).filter(
      (name) => name !== "public" && name !== "node_modules" && name !== "out",
    );

    for (const plugin of corePlugins) {
      expect(builtinDirs.has(plugin), `builtin/${plugin} should exist`).toBe(true);
      expect(sourceDirs.includes(plugin), `${plugin} should not be a top-level dir`).toBe(false);
    }
    expect(sourceDirs.length).toBeLessThanOrEqual(16);
  });
});

// ---------------------------------------------------------------------------
// Rule: retirement — museum code and legacy docs are gone
// ---------------------------------------------------------------------------

describe("Rule: retirement — museum code and legacy docs are gone", () => {
  it("museum modules and their app wiring are retired", () => {
    for (const dir of ["meta", "scenarios", "docs", "query"]) {
      expect(existsSync(abs(WEB_SRC, dir)), `${WEB_SRC}/${dir} should not exist`).toBe(false);
    }

    const staleFiles = listFilesRecursive(abs(WEB_SRC), [".ts", ".tsx"]).filter((file) =>
      /(^|[/\\])(ApiDocGenerator|QueryEngine)\.tsx?$/.test(file),
    );
    expect(staleFiles).toEqual([]);

    const appTs = readText(`${WEB_SRC}/app/App.ts`);
    expect(appTs).not.toContain("ApiDocGenerator");
    expect(appTs).not.toContain("QueryEngine");
  });

  it("legacy docs and stray spec are retired", () => {
    const retiredDocs = [
      "architecture-map.md",
      "reading-order.md",
      "reverse-evidence.md",
      "completeness-matrix.md",
      "coverage-audit.md",
      "final-handoff.md",
      "module-index.md",
      "extension-points.md",
      "scope-boundary.md",
      "start-here.md",
      "style-system.md",
      "plugin-api.md",
      "cli-reconstruction-spec.md",
      "electron-reconstruction-plan.md",
      "chat-agent-mapping.md",
      "chat-view-design.md",
      "composer-roadmap.md",
      "dagu-notes.md",
      "kernel-notes.md",
      "ownership-flip.md",
    ];

    for (const doc of retiredDocs) {
      expect(existsSync(abs("docs", doc)), `docs/${doc} should not exist`).toBe(false);
    }
    expect(existsSync(abs("docs", "scenarios"))).toBe(false);
    expect(existsSync(abs("docs", "specs", "terminal-view.spec.md"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Rule: architecture-docs — the new documentation set exists
// ---------------------------------------------------------------------------

describe("Rule: architecture-docs — the new documentation set exists", () => {
  it("architecture doc and constitution declare their governed structure", () => {
    expect(existsSync(abs("docs", "architecture.md"))).toBe(true);
    const architectureDoc = readText("docs/architecture.md");
    expect(architectureDoc).toMatch(
      /governs `apps\/\*\*`, `packages\/\*\*`, and the Go kernel lanes\s+`cmd\/\*\*` \+ `internal\/\*\*`/,
    );
    expect(architectureDoc).toMatch(/^#+.*direction table/im);

    expect(existsSync(abs("docs", "project.spec.md"))).toBe(true);
    const projectSpec = readText("docs/project.spec.md");
    // Project-spec frontmatter has no leading "---": it ends at the first delimiter.
    const frontmatter = projectSpec.split(/^---\s*$/m)[0] ?? "";
    expect(frontmatter).toMatch(/^spec:\s*project\s*$/m);
  });
});

// ---------------------------------------------------------------------------
// Extra: no retired product-name literals remain in code (beyond the spec
// scenarios; docs/ is excluded on purpose — learning records keep the old
// name as history, not a live literal to purge).
// ---------------------------------------------------------------------------

describe("Rule: name-agnostic code — the retired product name is gone", () => {
  it("no retired product-name literals remain in code", () => {
    const textExtensions = [
      ".ts",
      ".tsx",
      ".js",
      ".mjs",
      ".cjs",
      ".json",
      ".md",
      ".yaml",
      ".yml",
      ".html",
      ".css",
      ".scss",
    ];
    const scanDirs = ["apps", "packages", "tests", "scripts"];
    const rootConfigFiles = [
      "package.json",
      "pnpm-workspace.yaml",
      "tsconfig.json",
      "vitest.config.ts",
      "README.md",
      "oxlint.json",
    ];

    const candidates = [
      ...scanDirs.flatMap((dir) => listFilesRecursive(abs(dir), textExtensions)),
      ...rootConfigFiles.map((file) => abs(file)).filter((file) => existsSync(file)),
      // The scanner itself carries the banned literal inside its own regex.
    ].filter((file) => !file.endsWith("architecture.test.ts"));

    const hits: string[] = [];
    for (const fileAbs of candidates) {
      if (/arkloop/i.test(readFileSync(fileAbs, "utf8"))) hits.push(fileAbs.slice(ROOT.length));
    }
    expect(hits).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Extra: budget-style surface freeze (beyond the spec scenarios). The
// community-plugin surface is a compatibility contract: exports may only be
// ADDED deliberately — update the baseline in the same commit as the change.
// ---------------------------------------------------------------------------

describe("Rule: public-api surface freeze", () => {
  const exportedNames = (relPath: string): string[] => {
    const source = readFileSync(abs(relPath), "utf8");
    const names = new Set<string>();
    for (const m of source.matchAll(
      /^export (?:abstract )?(?:class|function|const|interface|type|enum) (\w+)/gm,
    ))
      names.add(m[1]);
    for (const m of source.matchAll(/^export (?:type )?\{([^}]*)\}/gms)) {
      for (const piece of m[1].split(",")) {
        const name = piece
          .trim()
          .split(/\s+as\s+/)
          .pop()
          ?.trim();
        if (name) names.add(name);
      }
    }
    return [...names].sort();
  };

  it("public plugin surface stays frozen", () => {
    expect(exportedNames("apps/web/api/PublicApi.ts")).toEqual([
      "AppearancePublicApi",
      "BasesPublicApi",
      "ObsidianPublicApi",
      "ShellPublicApi",
      "VaultPublicApi",
      "WorkspacePublicApi",
      "createPublicApi",
    ]);
    expect(exportedNames("apps/web/api/ObsidianPluginModule.ts")).toEqual([
      "DebouncedFunction",
      "Debouncer",
      "ObsidianPluginModule",
      "RequestUrlError",
      "RequestUrlParam",
      "RequestUrlResponse",
      "RequestUrlResponsePromise",
      "createObsidianPluginModule",
      "setIcon",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Extra: IPC channel table freeze (budget guard). The main<->renderer IPC
// surface is a protocol: channels may only be ADDED deliberately — update the
// baseline in the same commit as the change.
// ---------------------------------------------------------------------------

import { createIpcHandlers } from "@desktop/ipc";

describe("Rule: ipc surface freeze", () => {
  it("ipc channel table stays frozen", () => {
    // Handlers only dereference deps when invoked, so a lazy proxy is enough
    // to materialize the channel map without a live Electron.
    const stub: unknown = new Proxy(() => stub, { get: () => stub, apply: () => stub });
    const mapChannels = Object.keys(createIpcHandlers(stub as never));
    const direct = [
      "apps/desktop/main/main.ts",
      "apps/desktop/main/foundation-ipc.ts",
      "apps/desktop/main/desktop-bridge.ts",
    ].flatMap((file) =>
      [...readText(file).matchAll(/ipcMain\s*\.\s*(?:handle|on)\s*\(\s*"([^"]+)"/g)].map(
        (m) => m[1],
      ),
    );
    expect([...new Set([...mapChannels, ...direct])].sort()).toEqual([
      "desktop-dir",
      "dialog:open",
      "dialog:save",
      "disable-gpu",
      "documents-dir",
      "file-url",
      "frame",
      "get-default-vault-path",
      "get-documents-path",
      "get-fonts",
      "get-icon",
      "get-sandbox-vault-path",
      "is-quitting",
      "open-url",
      "relaunch",
      "request-url",
      "resources",
      "set-icon",
      "set-menu",
      "starter",
      "trash",
      "update-menu-items",
      "vault",
      "vault-list",
      "vault-move",
      "vault-open",
      "vault-remove",
      "version",
      "window:set-fullscreen",
    ]);
  });
});
