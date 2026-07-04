import { describe, expect, it } from "vitest";

const fileSystemSpecifier = "node:fs";
const pathSpecifier = "node:path";

/**
 * The style-system contracts (docs/style-system.md):
 *  1. index.css is the single entry point and its import order IS the
 *     cascade — the legacy artifact order followed by product overrides.
 *  2. Every stylesheet under src/styles is imported exactly once (no
 *     orphans, no double-imports).
 *  3. The design tokens themes and plugins depend on stay defined.
 */

const LAYER_ORDER = ["tokens/", "base/", "vendor/", "components/", "workspace/", "editor/", "features/", "product/"];

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

describe("ArkLoop style system", () => {
  it("imports every stylesheet exactly once from index.css", async () => {
    const { imports, allFiles } = await loadStyleTree();
    const importSet = new Set(imports);
    expect(imports.length, "duplicate imports in index.css").toBe(importSet.size);
    expect([...importSet].sort()).toEqual(allFiles.sort());
  });

  it("keeps product overrides last and known layers only", async () => {
    const { imports } = await loadStyleTree();
    for (const entry of imports) {
      expect(LAYER_ORDER.some((layer) => entry.startsWith(layer)), `unknown layer for ${entry}`).toBe(true);
    }
    const firstProduct = imports.findIndex((entry) => entry.startsWith("product/"));
    expect(firstProduct, "product/ must exist").toBeGreaterThan(-1);
    for (const entry of imports.slice(firstProduct)) {
      expect(entry.startsWith("product/"), `${entry} imported after product overrides`).toBe(true);
    }
  });

  it("defines the design tokens themes depend on", async () => {
    const fs = await load(fileSystemSpecifier) as FsModule;
    const tokens = fs.readFileSync("src/styles/tokens/tokens.css", "utf8");
    for (const token of REQUIRED_TOKENS) {
      expect(tokens, `missing design token ${token}`).toContain(`${token}:`);
    }
  });
});

async function loadStyleTree(): Promise<{ imports: string[]; allFiles: string[] }> {
  const fs = await load(fileSystemSpecifier) as FsModule;
  const path = await load(pathSpecifier) as PathModule;
  const index = fs.readFileSync("src/styles/index.css", "utf8");
  const imports = [...index.matchAll(/@import\s+"\.\/([^"]+\.css)";/g)].map((match) => match[1]);
  const allFiles: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // reveal/ hosts standalone demo styles outside the app cascade.
        if (entry.name !== "reveal") walk(full);
      } else if (entry.name.endsWith(".css") && entry.name !== "index.css") {
        allFiles.push(path.relative("src/styles", full));
      }
    }
  };
  walk("src/styles");
  return { imports, allFiles };
}

async function load(specifier: string): Promise<unknown> {
  return await import(specifier);
}

interface FsModule {
  readFileSync(path: string, encoding: "utf8"): string;
  readdirSync(path: string, options: { withFileTypes: true }): Array<{ name: string; isDirectory(): boolean }>;
}

interface PathModule {
  join(...parts: string[]): string;
  relative(from: string, to: string): string;
}
