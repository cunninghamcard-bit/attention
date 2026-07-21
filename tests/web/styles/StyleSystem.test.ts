import { describe, expect, it } from "vitest";

const fileSystemSpecifier = "node:fs";
const pathSpecifier = "node:path";

/**
 * The style-system contracts (docs/style-system.md):
 *  1. index.css is the single entry point and its import order IS the
 *     cascade — the faithful layers in legacy artifact order, then every
 *     own stylesheet (component styles under builtin/, views/, app/, plus
 *     the frozen product/ remainder pending the deviations ticket).
 *  2. Every stylesheet — faithful under styles/ and own next to its
 *     component — is imported exactly once (no orphans, no doubles).
 *  3. The design tokens themes and plugins depend on stay defined.
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
// frozen product/ remainder (explorer, outline, reading view) awaiting the
// deviations ticket. Nothing new may land under product/.
const OWN_PREFIXES = ["product/", "../builtin/", "../views/", "../app/"];

// Component-stylesheet roots, relative to apps/web — walked so an own
// stylesheet that is never imported still fails the exactly-once contract.
const OWN_ROOTS = ["builtin", "views", "app"];

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

async function loadStyleTree(): Promise<{ imports: string[]; allFiles: string[] }> {
  const fs = (await load(fileSystemSpecifier)) as FsModule;
  const path = (await load(pathSpecifier)) as PathModule;
  const index = fs.readFileSync("apps/web/styles/index.css", "utf8");
  const imports = [...index.matchAll(/@import\s+"(\.\.?\/[^"]+\.css)";/g)].map((match) =>
    match[1].startsWith("./") ? match[1].slice(2) : match[1],
  );
  const allFiles: string[] = [];
  // Directories whose stylesheets are deliberately OUTSIDE the index.css
  // cascade: reveal/ hosts standalone demo styles; app/theme/ holds the
  // quarantined, intentionally-empty placeholders and runtime theme
  // machinery (see their header comments and the retirement rules).
  const skipDirs = new Set(["apps/web/styles/reveal", "apps/web/app/theme"]);
  const walk = (dir: string, collect: (full: string) => string | null): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!skipDirs.has(full)) walk(full, collect);
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
