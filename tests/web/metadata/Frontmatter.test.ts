import { describe, expect, it } from "vitest";
import {
  insertFrontmatterProperty,
  parseFrontmatter,
  renameFrontmatterProperty,
  reorderFrontmatterProperty,
  setFrontmatterProperty,
  sortFrontmatterProperties,
} from "@web/metadata/Frontmatter";

describe("Frontmatter property rename", () => {
  it("keeps the original key position when the target key does not exist", () => {
    const source = ["---", "before: one", "old: value", "after: two", "---", "Body"].join("\n");

    expect(renameFrontmatterProperty(source, "old", "new")).toBe(
      ["---", "before: one", "new: value", "after: two", "---", "Body"].join("\n"),
    );
  });

  it("merges into an existing target key with Obsidian's old-value incoming semantics", () => {
    const source = [
      "---",
      "tags:",
      "  - existing",
      "old:",
      "  - existing",
      "  - incoming",
      "title: Current",
      "legacy: Previous",
      "---",
      "Body",
    ].join("\n");

    expect(parseFrontmatter(renameFrontmatterProperty(source, "old", "tags")).values).toMatchObject(
      {
        tags: ["existing", "incoming"],
        title: "Current",
        legacy: "Previous",
      },
    );
  });

  it("recursively merges object values and lets non-null old scalar values override target scalars", () => {
    const source = [
      "---",
      "target:",
      "  keep: yes",
      "  replace: target",
      "old:",
      "  replace: old",
      "  add: value",
      "---",
      "Body",
    ].join("\n");

    expect(
      parseFrontmatter(renameFrontmatterProperty(source, "old", "target")).values,
    ).toMatchObject({
      target: {
        keep: true,
        replace: "old",
        add: "value",
      },
    });
  });

  it("inserts Obsidian-style empty properties as null frontmatter values", () => {
    const source = "Body";

    expect(insertFrontmatterProperty(source, "newKey")).toBe(
      ["---", "newKey:", "---", "Body"].join("\n"),
    );
  });

  it("reorders a property by deleting it and inserting it at the target index", () => {
    const source = ["---", "first: 1", "second: 2", "third: 3", "---", "Body"].join("\n");

    expect(reorderFrontmatterProperty(source, "third", 1)).toBe(
      ["---", "first: 1", "third: 3", "second: 2", "---", "Body"].join("\n"),
    );
  });

  it("sorts properties with Obsidian's base-sensitive numeric collator", () => {
    const source = ["---", "z10: ten", "A2: two", "a1: one", "---", "Body"].join("\n");

    expect(sortFrontmatterProperties(source)).toBe(
      ["---", "a1: one", "A2: two", "z10: ten", "---", "Body"].join("\n"),
    );

    expect(sortFrontmatterProperties(source, true)).toBe(
      ["---", "z10: ten", "A2: two", "a1: one", "---", "Body"].join("\n"),
    );
  });

  it("marks invalid frontmatter and preserves it during property updates", () => {
    const source = "---\n: bad\n---\nBody";
    const parsed = parseFrontmatter(source);

    expect(parsed).toMatchObject({
      hasFrontmatter: true,
      valid: false,
      values: {},
    });
    expect(setFrontmatterProperty(source, "safe", "value")).toBe(source);
  });
});
