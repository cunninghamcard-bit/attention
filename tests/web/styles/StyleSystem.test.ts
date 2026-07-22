import { describe, expect, it } from "vitest";

const fileSystemSpecifier = "node:fs";
const pathSpecifier = "node:path";

/**
 * The style-system contracts (docs/style-system.md):
 *  1. index.css is the single entry point and its import order IS the
 *     cascade — the faithful layers in legacy artifact order, then every
 *     own stylesheet (component styles under ui/, builtin/, views/, app/,
 *     plus the registered deviations under styles/deviations/).
 *  2. Every stylesheet — faithful under styles/ and own next to its
 *     component — is imported exactly once (no orphans, no doubles).
 *  3. The design tokens themes and plugins depend on stay defined.
 *  4. The wall: own CSS never restyles faithful surfaces and never
 *     hijacks faithful tokens (docs/architecture/style-taxonomy/spec.md).
 */

const FAITHFUL_LAYERS = [
  "tokens/",
  "base/",
  "vendor/",
  "components/",
  "workspace/",
  "editor/",
  "features/",
];

// Own styles: component stylesheets living WITH their components, plus the
// registered deviations under styles/deviations/ (one file per deviation,
// each carrying its rationale — docs/architecture/style-deviations).
const OWN_PREFIXES = ["deviations/", "../ui/", "../builtin/", "../views/", "../app/"];

// Component-stylesheet roots, relative to apps/web — walked so an own
// stylesheet that is never imported still fails the exactly-once contract.
const OWN_ROOTS = ["ui", "builtin", "views", "app"];

// Directories whose stylesheets are deliberately OUTSIDE the index.css
// cascade: reveal/ hosts standalone demo styles; app/theme/ holds the
// quarantined, intentionally-empty placeholders and runtime theme
// machinery (see their header comments and the retirement rules).
const CASCADE_SKIP_DIRS = new Set(["apps/web/styles/reveal", "apps/web/app/theme"]);

// Tokens the theme ecosystem and our own views target. Removing one breaks
// installed themes silently — extend freely, trim only with a migration.
const REQUIRED_TOKENS = [
  "--background-primary",
  "--background-secondary",
  "--background-modifier-border",
  "--background-modifier-hover",
  "--text-normal",
  "--text-muted",
  "--text-faint",
  "--text-error",
  "--interactive-accent",
  "--font-monospace",
  "--code-normal",
  "--code-keyword",
  "--code-string",
  "--code-comment",
  "--code-function",
  "--code-value",
  "--code-property",
  "--code-tag",
  "--code-operator",
  "--code-punctuation",
  "--code-important",
  "--code-size",
  "--nav-tag-background",
  "--nav-tag-color",
  "--nav-indentation-guide-color",
  "--nav-indentation-guide-width",
  "--line-height-normal",
  "--size-2-2",
  "--size-4-3",
  "--radius-s",
  "--radius-m",
  "--prompt-border-color",
];

describe("Workbench style system", () => {
  it("imports every stylesheet exactly once from index.css", async () => {
    const { imports, allFiles } = await loadStyleTree();
    const importSet = new Set(imports);
    expect(imports.length, "duplicate imports in index.css").toBe(importSet.size);
    expect([...importSet].sort()).toEqual(allFiles.sort());
  });

  it("keeps own styles last and known layers only", async () => {
    const { imports } = await loadStyleTree();
    const isOwn = (entry: string): boolean =>
      OWN_PREFIXES.some((prefix) => entry.startsWith(prefix));
    for (const entry of imports) {
      expect(
        isOwn(entry) || FAITHFUL_LAYERS.some((layer) => entry.startsWith(layer)),
        `unknown layer for ${entry}`,
      ).toBe(true);
    }
    const firstOwn = imports.findIndex(isOwn);
    expect(firstOwn, "own styles must exist").toBeGreaterThan(-1);
    for (const entry of imports.slice(firstOwn)) {
      expect(isOwn(entry), `faithful layer ${entry} imported after own styles`).toBe(true);
    }
  });

  it("defines the design tokens themes depend on", async () => {
    const fs = (await load(fileSystemSpecifier)) as FsModule;
    const tokens = fs.readFileSync("apps/web/styles/tokens/tokens.css", "utf8");
    for (const token of REQUIRED_TOKENS) {
      expect(tokens, `missing design token ${token}`).toContain(`${token}:`);
    }
  });
});

// ---------------------------------------------------------------------------
// The wall (docs/architecture/style-taxonomy/spec.md): own CSS never
// restyles faithful surfaces and never hijacks faithful tokens.
//
// "Own-scoped" means something in the selector is ours — an own class or
// an attribute qualifier (the community-plugin protocol, e.g.
// `.workspace-leaf-content[data-type="terminal"]`). Own-scoped rules may
// style faithful primitives inside their own containers and parameterize
// faithful tokens locally (`.git-pr-signin-icon { --icon-size: 32px }`) —
// exactly how Obsidian's own plugin ecosystem behaves. What is banned is
// the unscoped case: restyling or redefining a faithful surface globally.
// ---------------------------------------------------------------------------

/**
 * Recorded exceptions, each carrying the deviations ticket's verdict. The goal
 * state is an empty set; a new entry requires a recorded decision.
 */
const RESTYLE_ALLOWLIST = new Set([
  // VERDICT (07-21, owner-delegated): colored semantic type icons lift
  // Obsidian's monochrome icon dimming on the nav icon slot — a recorded
  // product choice; the palette itself is own-namespaced.
  "../ui/file-type-icon.css",
  // VERDICT: inline type-icon layout + tall-row icon sizing are recorded
  // product choices (rationale in the file's comments).
  "../builtin/file-explorer.css",
  // VERDICT: the product brand deliberately replaces Obsidian's
  // splash-brand on the starter screen.
  "../app/starter/starter.css",
  // VERDICT: CSS stand-in for Obsidian's runtime container sizing —
  // measured and documented in the file header; reconstruction necessity.
  "deviations/reading-view.css",
]);

const CLASS_RE = /\.(-?[A-Za-z_][\w-]*)/g;

function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, " ");
}

function isOwnScopedSelector(selector: string, faithfulClasses: Set<string>): boolean {
  if (selector.includes("[")) return true;
  const classes = [...selector.matchAll(CLASS_RE)].map((match) => match[1]);
  return classes.some((name) => !faithfulClasses.has(name));
}

/** Selectors that restyle a faithful surface: classes present, none ours. */
function findRestyleViolations(css: string, faithfulClasses: Set<string>): string[] {
  const violations: string[] = [];
  for (const match of stripCssComments(css).matchAll(/(^|[{}])\s*([^{}@;]+)\{/g)) {
    for (const raw of match[2].split(",")) {
      const selector = raw.trim();
      if (!selector) continue;
      if ([...selector.matchAll(CLASS_RE)].length === 0) continue; // element selectors
      if (!isOwnScopedSelector(selector, faithfulClasses)) violations.push(selector);
    }
  }
  return violations;
}

/** Faithful tokens (re)defined outside an own scope — a global hijack. */
function findTokenHijacks(
  css: string,
  faithfulClasses: Set<string>,
  faithfulTokens: Set<string>,
): string[] {
  const hijacks: string[] = [];
  for (const match of stripCssComments(css).matchAll(/(^|[{}])\s*([^{}@;]+)\{([^{}]*)\}/g)) {
    const unscoped = match[2]
      .split(",")
      .map((raw) => raw.trim())
      .filter(Boolean)
      .some((selector) => !isOwnScopedSelector(selector, faithfulClasses));
    if (!unscoped) continue;
    for (const definition of match[3].matchAll(/(--[\w-]+)\s*:/g)) {
      if (faithfulTokens.has(definition[1])) {
        hijacks.push(`${match[2].trim()} { ${definition[1]} }`);
      }
    }
  }
  return hijacks;
}

describe("Workbench style wall", () => {
  it("refuses own selectors that restyle faithful surfaces", async () => {
    const { faithfulClasses, ownSheets } = await loadWallInputs();
    for (const sheet of ownSheets) {
      if (RESTYLE_ALLOWLIST.has(sheet.rel)) continue;
      expect(
        findRestyleViolations(sheet.css, faithfulClasses),
        `${sheet.rel} restyles faithful surfaces`,
      ).toEqual([]);
    }
    const faithful = new Set(["nav-file", "tree-item"]);
    expect(findRestyleViolations(".nav-file { color: red; }", faithful)).toHaveLength(1);
    expect(findRestyleViolations(".git-x .nav-file { color: red; }", faithful)).toEqual([]);
    expect(findRestyleViolations('.nav-file[data-own="1"] { color: red; }', faithful)).toEqual([]);
  });

  it("keeps faithful tokens consumed, never hijacked globally", async () => {
    const { faithfulClasses, faithfulTokens, ownSheets } = await loadWallInputs();
    for (const sheet of ownSheets) {
      expect(
        findTokenHijacks(sheet.css, faithfulClasses, faithfulTokens),
        `${sheet.rel} hijacks faithful tokens`,
      ).toEqual([]);
    }
    const classes = new Set(["nav-file"]);
    const tokens = new Set(["--icon-size"]);
    expect(findTokenHijacks(":root { --icon-size: 20px; }", classes, tokens)).toHaveLength(1);
    expect(findTokenHijacks(".git-pr-x { --icon-size: 20px; }", classes, tokens)).toEqual([]);
    expect(findTokenHijacks(".git-pr-x { --git-pad: 2px; }", classes, tokens)).toEqual([]);
  });
});

async function loadStyleTree(): Promise<{ imports: string[]; allFiles: string[] }> {
  const fs = (await load(fileSystemSpecifier)) as FsModule;
  const path = (await load(pathSpecifier)) as PathModule;
  const index = fs.readFileSync("apps/web/styles/index.css", "utf8");
  const imports = [...index.matchAll(/@import\s+"(\.\.?\/[^"]+\.css)";/g)].map((match) =>
    match[1].startsWith("./") ? match[1].slice(2) : match[1],
  );
  const allFiles: string[] = [];
  const walk = (dir: string, collect: (full: string) => string | null): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!CASCADE_SKIP_DIRS.has(full)) walk(full, collect);
      } else if (entry.name.endsWith(".css") && entry.name !== "index.css") {
        const mapped = collect(full);
        if (mapped !== null) allFiles.push(mapped);
      }
    }
  };
  walk("apps/web/styles", (full) => path.relative("apps/web/styles", full));
  for (const root of OWN_ROOTS) {
    walk(path.join("apps/web", root), (full) => `../${path.relative("apps/web", full)}`);
  }
  return { imports, allFiles };
}

async function loadWallInputs(): Promise<{
  faithfulClasses: Set<string>;
  faithfulTokens: Set<string>;
  ownSheets: Array<{ rel: string; css: string }>;
}> {
  const fs = (await load(fileSystemSpecifier)) as FsModule;
  const path = (await load(pathSpecifier)) as PathModule;
  const walkCss = (dir: string, onFile: (full: string) => void): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!CASCADE_SKIP_DIRS.has(full)) walkCss(full, onFile);
      } else if (entry.name.endsWith(".css") && entry.name !== "index.css") {
        onFile(full);
      }
    }
  };
  const faithfulClasses = new Set<string>();
  for (const layer of FAITHFUL_LAYERS) {
    walkCss(path.join("apps/web/styles", layer.replace("/", "")), (full) => {
      const source = stripCssComments(fs.readFileSync(full, "utf8"));
      for (const match of source.matchAll(CLASS_RE)) faithfulClasses.add(match[1]);
    });
  }
  const faithfulTokens = new Set<string>();
  walkCss("apps/web/styles/tokens", (full) => {
    const source = stripCssComments(fs.readFileSync(full, "utf8"));
    for (const match of source.matchAll(/(--[\w-]+)\s*:/g)) faithfulTokens.add(match[1]);
  });
  const ownSheets: Array<{ rel: string; css: string }> = [];
  for (const root of OWN_ROOTS) {
    walkCss(path.join("apps/web", root), (full) => {
      ownSheets.push({
        rel: `../${path.relative("apps/web", full)}`,
        css: fs.readFileSync(full, "utf8"),
      });
    });
  }
  walkCss("apps/web/styles/deviations", (full) => {
    ownSheets.push({
      rel: path.relative("apps/web/styles", full),
      css: fs.readFileSync(full, "utf8"),
    });
  });
  return { faithfulClasses, faithfulTokens, ownSheets };
}

async function load(specifier: string): Promise<unknown> {
  return await import(specifier);
}

interface FsModule {
  readFileSync(path: string, encoding: "utf8"): string;
  readdirSync(
    path: string,
    options: { withFileTypes: true },
  ): Array<{ name: string; isDirectory(): boolean }>;
}

interface PathModule {
  join(...parts: string[]): string;
  relative(from: string, to: string): string;
}
