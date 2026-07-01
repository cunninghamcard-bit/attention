import { describe, expect, it } from "vitest";
import { parseObsidianUri } from "./UriRouter";

describe("parseObsidianUri", () => {
  it("matches Obsidian by rejecting non-obsidian URLs", () => {
    expect(parseObsidianUri("https://open?vault=x")).toBeNull();
  });

  it("matches Obsidian by preserving hashes and plus signs", () => {
    expect(parseObsidianUri("obsidian://open?file=A+B&empty#Heading")).toEqual({
      action: "open",
      file: "A+B",
      empty: "true",
      hash: "Heading",
    });
  });

  it("matches Obsidian by adding an empty query key when no query exists", () => {
    expect(parseObsidianUri("obsidian://open")).toEqual({ action: "open", "": "true" });
    expect(parseObsidianUri("obsidian://open#Heading")).toEqual({ action: "open", hash: "Heading", "": "true" });
  });

  it("matches Obsidian by parsing obsidian://vault URLs as open actions", () => {
    expect(parseObsidianUri("obsidian://vault/My%20Vault/Folder%2FNested/Note%20A.md")).toEqual({
      action: "open",
      vault: "My Vault",
      file: "Folder/Nested/Note A.md",
    });
  });
});
