import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getBuiltInSpriteSheet } from "@pierre/trees";

const PALETTE = readFileSync(join(process.cwd(), "apps/web/styles/product/explorer.css"), "utf8");

/** Catch-all buckets: `default` is any unrecognised extension, `text` is
 * .txt/.log/.env. An unknown file type has no brand hue, so both stay on the
 * neutral `.file-type-icon` fallback by design. */
const NEUTRAL_BY_DESIGN = ["default", "text"];

function spriteTokens(): string[] {
  const sheet = getBuiltInSpriteSheet("complete");
  return [...sheet.matchAll(/id="file-tree-builtin-([^"]+)"/g)].map((m) => m[1]!);
}

describe("file-type icon palette", () => {
  it("colors every icon token the sprite can resolve to", () => {
    // Pierre owns the icon set; a version bump can add tokens. Without this
    // guard the new ones fall through to the grey fallback and nobody notices.
    const uncolored = spriteTokens()
      .filter((token) => !NEUTRAL_BY_DESIGN.includes(token))
      .filter((token) => !PALETTE.includes(`[data-icon-token="${token}"]`));
    expect(uncolored).toEqual([]);
  });

  it("keeps the palette anchored to the theme class, not color-scheme", () => {
    // light-dark() resolves against `color-scheme`, which any theme may
    // redeclare; the app's real light/dark truth is the .theme-* body class.
    expect(PALETTE).toContain(".theme-dark .file-type-icon");
    expect(PALETTE).toContain(".theme-light .file-type-icon");
  });
});
