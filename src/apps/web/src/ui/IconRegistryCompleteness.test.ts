import { describe, expect, it } from "vitest";
import { getIconIds } from "./Icon";

// Every icon name referenced in source must exist in the registry — setIcon
// fails SILENTLY for unknown names, which has twice shipped invisible buttons
// (dataset.icon webviewer chrome; lucide-glasses/rotate-cw/globe-2 header
// actions). This scan turns that class of bug into a test failure.

declare global {
  interface ImportMeta {
    glob(pattern: string, options: { query: string; import: string; eager: true }): Record<string, string>;
  }
}

// Vite statically inlines every non-test source file as raw text.
const sources = import.meta.glob("../**/*.ts", { query: "?raw", import: "default", eager: true });

describe("icon registry completeness", () => {
  it("registers every lucide-* name referenced anywhere in src", () => {
    const registered = new Set(getIconIds());
    const missing = new Map<string, string[]>();
    for (const [file, source] of Object.entries(sources)) {
      if (file.endsWith(".test.ts")) continue;
      for (const match of source.matchAll(/"(lucide-[a-z0-9][a-z0-9-]*)"/g)) {
        const name = match[1];
        if (registered.has(name)) continue;
        const files = missing.get(name) ?? [];
        if (!files.includes(file)) files.push(file);
        missing.set(name, files);
      }
    }
    const report = [...missing.entries()].map(([name, files]) => `${name} (${files.join(", ")})`).join("\n");
    expect(missing.size, `Unregistered icons render as blank elements:\n${report}`).toBe(0);
  });
});
