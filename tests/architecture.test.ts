// Architecture alarm for docs/architecture/project-layout-consolidation/spec.md.
//
// Every rule below is enforced by a small pure checker function: give it data
// (parsed yaml text, manifest objects, or {path, imports} records) and it
// returns violations. Each `it` exercises a checker twice where the spec asks
// for it — once against data read from the real tree (the alarm), once
// against a synthetic record (the alarm's own self-test).

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, type Dirent } from "node:fs";
import { join, posix } from "node:path";

// vitest's root config lives at the repo root, so tests always run with cwd there.
const ROOT = process.cwd();
const WEB_SRC = "src/apps/web/src";

function abs(...segments: string[]): string {
  return join(ROOT, ...segments);
}

function readText(relPath: string): string {
  return readFileSync(abs(relPath), "utf8");
}

// ---------------------------------------------------------------------------
// Pure checkers
// ---------------------------------------------------------------------------

/** Rule: runtime-walls. Parses the plain-text `packages:` list of a pnpm workspace file. */
function parseWorkspacePackages(yamlText: string): string[] {
  const lines = yamlText.split("\n");
  const start = lines.findIndex((line) => /^packages:\s*$/.test(line.trim()));
  if (start === -1) return [];
  const entries: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const match = lines[i].match(/^\s*-\s*(.+?)\s*$/);
    if (!match) break;
    entries.push(match[1]);
  }
  return entries;
}

interface Manifest {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

/** Rule: runtime-walls. Reports which of `forbidden` show up in a manifest's dependency tables. */
function findLaneViolations(manifest: Manifest, forbidden: string[]): string[] {
  const deps = { ...(manifest.dependencies ?? {}), ...(manifest.devDependencies ?? {}) };
  return forbidden.filter((name) => name in deps);
}

interface SourceFile {
  /** repo-relative, posix-separated, e.g. "src/apps/web/src/vault/Vault.ts" */
  path: string;
  /** raw import specifiers as written in the file */
  imports: string[];
}

/** Resolves a relative import specifier against the file that contains it. */
function resolveRelativeImport(fromFile: string, specifier: string): string {
  return posix.normalize(posix.join(posix.dirname(fromFile), specifier));
}

/** First path segment under `src/apps/web/src/` that `resolvedPath` lands in, else null. */
function topLevelWebSrcDir(resolvedPath: string): string | null {
  const marker = `${WEB_SRC}/`;
  const idx = resolvedPath.indexOf(marker);
  if (idx === -1) return null;
  return resolvedPath.slice(idx + marker.length).split("/")[0] ?? null;
}

/** Rule: kernel-direction. Kernel code may only reach into these directories. */
const KERNEL_ALLOWED_TARGETS = new Set(["vault", "metadata", "storage", "core", "dom", "platform"]);

function findKernelDirectionViolations(files: SourceFile[]): Array<{ path: string; import: string }> {
  const violations: Array<{ path: string; import: string }> = [];
  for (const file of files) {
    for (const spec of file.imports) {
      if (!spec.startsWith(".")) continue; // bare specifiers (npm packages) are never "above the kernel"
      const target = topLevelWebSrcDir(resolveRelativeImport(file.path, spec));
      if (target && !KERNEL_ALLOWED_TARGETS.has(target)) violations.push({ path: file.path, import: spec });
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

function findApiFacadeViolations(files: SourceFile[], allowedCallers: readonly string[] = []): Array<{ path: string; import: string }> {
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

// ---------------------------------------------------------------------------
// fs helpers (kept separate from the pure checkers above)
// ---------------------------------------------------------------------------

const DEFAULT_SKIP_DIRS = new Set(["node_modules", ".git", "dist", "dist-electron", "coverage"]);

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

function listFilesRecursive(dirAbs: string, extensions: string[], skipDirs: Set<string> = DEFAULT_SKIP_DIRS): string[] {
  if (!existsSync(dirAbs)) return [];
  const out: string[] = [];
  walk(dirAbs, skipDirs, out);
  return out.filter((file) => extensions.some((ext) => file.endsWith(ext)));
}

const IMPORT_RE = /\bfrom\s+["'](\.[^"']+)["']/g;

function extractImports(source: string): string[] {
  return [...source.matchAll(IMPORT_RE)].map((match) => match[1]);
}

function sourceFilesUnder(relDirs: string[], extensions: string[], excludeTests: boolean): SourceFile[] {
  const files: SourceFile[] = [];
  for (const relDir of relDirs) {
    for (const fileAbs of listFilesRecursive(abs(relDir), extensions)) {
      if (excludeTests && fileAbs.endsWith(".test.ts")) continue;
      const path = posix.join(relDir, fileAbs.slice(abs(relDir).length + 1).split("\\").join("/"));
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

// ---------------------------------------------------------------------------
// Rule: runtime-walls — the workspace splits by runtime
// ---------------------------------------------------------------------------

describe("Rule: runtime-walls — the workspace splits by runtime", () => {
  it("workspace declares desktop web and server app packages", () => {
    const packages = parseWorkspacePackages(readText("pnpm-workspace.yaml"));

    expect(packages).toContain("src/apps/desktop");
    expect(packages).toContain("src/apps/web");
    expect(packages).toContain("src/apps/server");

    for (const pkgDir of ["src/apps/desktop", "src/apps/web", "src/apps/server"]) {
      expect(existsSync(abs(pkgDir, "package.json")), `${pkgDir}/package.json should exist`).toBe(true);
    }
  });

  it("app package dependencies stay in their runtime lane", () => {
    const root: Manifest = JSON.parse(readText("package.json"));
    const desktop: Manifest = JSON.parse(readText("src/apps/desktop/package.json"));
    const web: Manifest = JSON.parse(readText("src/apps/web/package.json"));

    expect(Object.keys(root.dependencies ?? {})).toEqual([]);
    expect(findLaneViolations(desktop, ["react", "react-dom"])).toEqual([]);
    expect(findLaneViolations(web, ["electron"])).toEqual([]);
  });

  it("flags a dependency outside its runtime lane", () => {
    const synthetic: Manifest = { name: "@app/web", dependencies: { electron: "1.0.0" } };

    expect(findLaneViolations(synthetic, ["electron"])).toEqual(["electron"]);
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
        path: posix.join(WEB_SRC, fileAbs.slice(abs(WEB_SRC).length + 1).split("\\").join("/")),
        imports: extractImports(readFileSync(fileAbs, "utf8")),
      }))
      .filter((file) => topLevelWebSrcDir(file.path) !== "api")
      // index.ts is the public entry point itself (dist/api/index.js) — it IS the facade's composition root.
      .filter((file) => file.path !== `${WEB_SRC}/index.ts`);

    expect(findApiFacadeViolations(allFiles, API_FACADE_ALLOWED_CALLERS)).toEqual([]);
  });

  it("flags an internal import of the api facade", () => {
    const synthetic: SourceFile = { path: `${WEB_SRC}/workspace/X.ts`, imports: ["../api/PublicApi"] };

    expect(findApiFacadeViolations([synthetic])).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Rule: builtin-roof — one core plugin per slice
// ---------------------------------------------------------------------------

describe("Rule: builtin-roof — one core plugin per slice", () => {
  it("builtin roof holds one directory per core plugin", () => {
    const corePlugins = ["canvas", "git", "github", "graph", "webviewer", "theme-market", "terminal", "agent"];
    const builtinDirs = new Set(listTopLevelDirNames(abs(WEB_SRC, "builtin")));
    const topLevelDirs = listTopLevelDirNames(abs(WEB_SRC));

    for (const plugin of corePlugins) {
      expect(builtinDirs.has(plugin), `builtin/${plugin} should exist`).toBe(true);
      expect(topLevelDirs.includes(plugin), `${plugin} should not be a top-level dir`).toBe(false);
    }
    expect(topLevelDirs.length).toBeLessThanOrEqual(16);
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
  it("architecture doc and constitution exist with governs markers", () => {
    expect(existsSync(abs("docs", "architecture.md"))).toBe(true);
    const architectureDoc = readText("docs/architecture.md");
    expect(architectureDoc).toContain("docwright:governs");
    expect(architectureDoc).toMatch(/^#+.*direction table/im);

    expect(existsSync(abs("docs", "project.spec.md"))).toBe(true);
    const projectSpec = readText("docs/project.spec.md");
    // docwright frontmatter has no leading "---": it's key: value lines up to the first "---".
    const frontmatter = projectSpec.split(/^---\s*$/m)[0] ?? "";
    expect(frontmatter).toMatch(/^spec:\s*project\s*$/m);
  });
});

// ---------------------------------------------------------------------------
// Extra: no retired product-name literals remain in code (beyond the 11 spec
// scenarios; docs/ is excluded on purpose — learning records keep the old
// name as history, not a live literal to purge).
// ---------------------------------------------------------------------------

describe("Rule: name-agnostic code — the retired product name is gone", () => {
  it("no retired product-name literals remain in code", () => {
    const textExtensions = [".ts", ".tsx", ".js", ".mjs", ".cjs", ".json", ".md", ".yaml", ".yml", ".html", ".css", ".scss"];
    const scanDirs = ["src/apps", "tests", "scripts", "examples"];
    const rootConfigFiles = [
      "package.json",
      "pnpm-workspace.yaml",
      "tsconfig.json",
      "vitest.config.ts",
      "playwright.config.ts",
      "playwright.desktop.config.ts",
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
// Extra: budget-style surface freeze (beyond the 11 spec scenarios). The
// community-plugin surface is a compatibility contract: exports may only be
// ADDED deliberately — update the baseline in the same commit as the change.
// ---------------------------------------------------------------------------

describe("Rule: public-api surface freeze", () => {
  const exportedNames = (relPath: string): string[] => {
    const source = readFileSync(abs(relPath), "utf8");
    const names = new Set<string>();
    for (const m of source.matchAll(/^export (?:abstract )?(?:class|function|const|interface|type|enum) (\w+)/gm)) names.add(m[1]);
    for (const m of source.matchAll(/^export (?:type )?\{([^}]*)\}/gms)) {
      for (const piece of m[1].split(",")) {
        const name = piece.trim().split(/\s+as\s+/).pop()?.trim();
        if (name) names.add(name);
      }
    }
    return [...names].sort();
  };

  it("public plugin surface stays frozen", () => {
    expect(exportedNames("src/apps/web/src/api/PublicApi.ts")).toEqual([
      "AppearancePublicApi",
      "BasesPublicApi",
      "ObsidianPublicApi",
      "ShellPublicApi",
      "VaultPublicApi",
      "WorkspacePublicApi",
      "createPublicApi",
    ]);
    expect(exportedNames("src/apps/web/src/api/ObsidianPluginModule.ts")).toEqual([
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
