import { describe, expect, it } from "vitest";
import { parseObsidianUri } from "./UriRouter";

describe("parseObsidianUri", () => {
  it("matches Obsidian by parsing obsidian://vault URLs as open actions", () => {
    expect(parseObsidianUri("obsidian://vault/My%20Vault/Folder%2FNested/Note%20A.md")).toEqual({
      action: "open",
      vault: "My Vault",
      file: "Folder/Nested/Note A.md",
    });
  });
});
