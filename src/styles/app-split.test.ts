import { describe, expect, it } from "vitest";

const fileSystemSpecifier = "node:fs";
const cryptoSpecifier = "node:crypto";

/**
 * SHA-256 of the vendored Obsidian app.css artifact. The barrel
 * (src/styles/app.css) decomposes it into ./app/ partials; concatenating them
 * in @import order MUST reproduce the artifact byte-for-byte. This is the
 * fidelity guarantee: the split is a pure re-partition, never a rewrite.
 * Update only when re-vendoring a new app.css (see scripts/split-app-css.ts).
 */
const GOLDEN_SHA256 = "6245db88b65b1728ef136cc79b3ce3ef85ab860944abbe5198e9d6bd9abe9bea";
const EXPECTED_PARTIALS = 57;

describe("app.css design-framework split", () => {
  it("reassembles the partials byte-for-byte into the vendored artifact", async () => {
    const fs = await loadFs();
    const barrel = fs.readFileSync("src/styles/app.css", "utf8");
    const imports = [...barrel.matchAll(/@import\s+"\.\/(app\/[^"]+\.css)";/g)].map((m) => m[1]);

    expect(imports).toHaveLength(EXPECTED_PARTIALS);

    const concatenated = imports.map((rel) => fs.readFileSync(`src/styles/${rel}`, "utf8")).join("");
    const { createHash } = await loadCrypto();
    const sha = createHash("sha256").update(concatenated, "utf8").digest("hex");
    expect(sha, "partials must concatenate back to the vendored app.css bytes").toBe(GOLDEN_SHA256);
  });

  it("keeps the barrel free of style rules — every rule lives in a partial", async () => {
    const fs = await loadFs();
    const barrel = fs.readFileSync("src/styles/app.css", "utf8");
    const withoutComments = barrel.replace(/\/\*[\s\S]*?\*\//g, "");
    const nonImport = withoutComments
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("@import "));
    expect(nonImport, "barrel must contain only @import statements").toEqual([]);
  });
});

async function loadFs(): Promise<{ readFileSync(path: string, encoding: "utf8"): string }> {
  return (await import(fileSystemSpecifier)) as { readFileSync(path: string, encoding: "utf8"): string };
}

interface Hasher { update(data: string, encoding: "utf8"): Hasher; digest(encoding: "hex"): string }
async function loadCrypto(): Promise<{ createHash(algorithm: "sha256"): Hasher }> {
  return (await import(cryptoSpecifier)) as { createHash(algorithm: "sha256"): Hasher };
}
