import { describe, expect, it } from "vitest";
import {
  MarkdownBlockCache,
  computeBlockIdInsertion,
  createBlockId,
} from "@web/metadata/BlockCache";
import { Vault, type VaultAdapter } from "@web/vault/Vault";

describe("BlockCache", () => {
  it("builds markdown block records from content and caches by file object plus mtime", async () => {
    const adapter = new TimestampedAdapter();
    const vault = new Vault(adapter);
    const file = await vault.create(
      "Note.md",
      "---\ntags: [skip]\n---\n# Heading ^head-id\n\nParagraph text\n^para-id\n\n- First item ^item-id\n- Second item",
    );
    const blockCache = new MarkdownBlockCache(vault);

    const first = await blockCache.getForFile(null, file);
    const second = await blockCache.getForFile(null, file);

    expect(second).toBe(first);
    expect(first?.blocks.map((block) => [block.display, block.node.type, block.node.id])).toEqual([
      ["# Heading", "heading", "head-id"],
      ["Paragraph text", "paragraph", "para-id"],
      ["First item", "listItem", "item-id"],
      ["Second item", "listItem", undefined],
    ]);
    expect(first?.blocks[0]?.node.position.start.line).toBe(3);

    await vault.modify(file, "# Changed");
    const updated = await blockCache.getForFile(null, file);

    expect(updated).not.toBe(first);
    expect(updated?.blocks[0]?.display).toBe("# Changed");
  });

  it("returns null for non-markdown files and yields markdown records from getAll", async () => {
    const vault = new Vault(new TimestampedAdapter());
    const blockCache = new MarkdownBlockCache(vault);
    const md = await vault.create("Note.md", "Body");
    const pdf = await vault.createBinary("Attachment.pdf", new Uint8Array([1]).buffer);

    await expect(blockCache.getForFile(null, pdf)).resolves.toBeNull();

    const records = [];
    for await (const record of blockCache.getAll(null)) records.push(record);

    expect(records).toHaveLength(1);
    expect(records[0]?.file).toBe(md);
  });

  it("computes KA-style block id insertion for paragraph, heading, and nested list item blocks", async () => {
    const vault = new Vault(new TimestampedAdapter());
    const blockCache = new MarkdownBlockCache(vault);
    const file = await vault.create("Note.md", "# Heading\n\nParagraph\n\n- Parent\n  - Child");
    const record = await blockCache.getForFile(null, file);
    const heading = record?.blocks.find((block) => block.node.type === "heading");
    const paragraph = record?.blocks.find((block) => block.node.type === "paragraph");
    const parent = record?.blocks.find((block) => block.display === "Parent");

    expect(
      paragraph &&
        computeBlockIdInsertion({ content: record?.content ?? "", node: paragraph.node }, "abc123"),
    ).toMatchObject({
      addition: " ^abc123",
      newlines: 0,
    });
    expect(
      heading &&
        computeBlockIdInsertion({ content: record?.content ?? "", node: heading.node }, "def456"),
    ).toMatchObject({
      addition: "\n\n^def456",
      newlines: 2,
    });

    const parentInsertion =
      parent &&
      computeBlockIdInsertion({ content: record?.content ?? "", node: parent.node }, "fedcba");
    expect(parentInsertion?.addition).toBe(" ^fedcba");
    expect(record?.content.slice(parentInsertion?.blockEnd, parentInsertion?.blockEnd + 10)).toBe(
      "\n  - Child",
    );
  });

  it("generates lowercase hexadecimal block ids", () => {
    expect(createBlockId(6)).toMatch(/^[0-9a-f]{6}$/);
  });
});

class TimestampedAdapter implements VaultAdapter {
  private files = new Map<string, { data: string; mtime: number; size: number }>();
  private clock = 0;

  async read(path: string): Promise<string> {
    return this.files.get(path)?.data ?? "";
  }

  async write(path: string, data: string): Promise<void> {
    this.clock += 1;
    this.files.set(path, { data, mtime: this.clock, size: data.length });
  }

  async writeBinary(path: string, data: ArrayBuffer): Promise<void> {
    this.clock += 1;
    this.files.set(path, {
      data: `[binary:${data.byteLength}]`,
      mtime: this.clock,
      size: data.byteLength,
    });
  }

  async delete(path: string): Promise<void> {
    this.files.delete(path);
  }

  async list(): Promise<string[]> {
    return [...this.files.keys()];
  }

  async stat(path: string): Promise<{ mtime: number; size: number } | null> {
    const file = this.files.get(path);
    return file ? { mtime: file.mtime, size: file.size } : null;
  }
}
