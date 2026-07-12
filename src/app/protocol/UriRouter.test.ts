import { describe, expect, it } from "vitest";
import { parseObsidianUri } from "./UriRouter";

describe("parseObsidianUri", () => {
  it("matches Obsidian by rejecting non-obsidian URLs", () => {
    expect(parseObsidianUri("https://open?vault=x")).toBeNull();
  });

  it("matches Obsidian by preserving hashes and plus signs", () => {
    expect(parseObsidianUri("workbench://open?file=A+B&empty#Heading")).toEqual({
      action: "open",
      file: "A+B",
      empty: "true",
      hash: "Heading",
    });
  });

  it("matches Obsidian by adding an empty query key when no query exists", () => {
    expect(parseObsidianUri("workbench://open")).toEqual({ action: "open", "": "true" });
    expect(parseObsidianUri("workbench://open#Heading")).toEqual({ action: "open", hash: "Heading", "": "true" });
  });

  it("matches Obsidian by parsing workbench://vault URLs as open actions", () => {
    expect(parseObsidianUri("workbench://vault/My%20Vault/Folder%2FNested/Note%20A.md")).toEqual({
      action: "open",
      vault: "My Vault",
      file: "Folder/Nested/Note A.md",
    });
  });
});
