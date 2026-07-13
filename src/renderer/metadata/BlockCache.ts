import type { TFile } from "../vault/TAbstractFile";
import type { Vault } from "../vault/Vault";

export interface BlockCacheCancelToken {
  isCancelled?: boolean | (() => boolean);
  cancelled?: boolean;
  throwIfCancelled?: () => void;
}

export interface BlockCachePosition {
  start: { line: number; col: number; offset: number };
  end: { line: number; col: number; offset: number };
}

export interface BlockCacheNode {
  type: "paragraph" | "heading" | "listItem";
  id?: string;
  depth?: number;
  position: BlockCachePosition;
  children?: Array<{ type: string; position: BlockCachePosition }>;
}

export interface BlockCacheBlock {
  display: string;
  node: BlockCacheNode;
}

export interface BlockCacheRecord {
  file: TFile;
  content: string;
  mtime: number;
  blocks: BlockCacheBlock[];
}

export interface BlockIdInsertion {
  blockStart: number;
  blockEnd: number;
  addition: string;
  newlines: number;
}

export class MarkdownBlockCache {
  private cache = new Map<string, BlockCacheRecord>();

  constructor(readonly vault: Vault) {}

  clear(): void {
    this.cache.clear();
  }

  async getForFile(
    cancelToken: BlockCacheCancelToken | null,
    file: TFile,
  ): Promise<BlockCacheRecord | null> {
    if (file.extension !== "md") return null;
    const stat = await this.getFileStat(file);
    const cached = this.cache.get(file.path);
    if (cached && cached.file === file && stat && cached.mtime === stat.mtime) return cached;
    const content = await this.vault.read(file);
    if (isCancelled(cancelToken)) return null;
    const mtime = stat?.mtime ?? hashContent(content);
    if (cached && cached.file === file && cached.mtime === mtime && cached.content === content)
      return cached;
    const record = {
      file,
      content,
      mtime,
      blocks: parseMarkdownBlocks(content, cancelToken),
    };
    this.cache.set(file.path, record);
    return record;
  }

  async *getAll(
    cancelToken: BlockCacheCancelToken | null,
  ): AsyncGenerator<BlockCacheRecord | null> {
    for (const file of this.vault.getMarkdownFiles()) {
      if (isCancelled(cancelToken)) return;
      yield await this.getForFile(cancelToken, file);
    }
  }

  private async getFileStat(file: TFile): Promise<{ mtime: number } | null> {
    const adapter = this.vault.adapter as
      | { stat?: (path: string) => Promise<{ mtime?: number } | null> }
      | undefined;
    const stat = await adapter?.stat?.(file.path);
    return typeof stat?.mtime === "number" ? { mtime: stat.mtime } : null;
  }
}

export function createBlockId(length = 6): string {
  const chars: string[] = [];
  for (let index = 0; index < length; index += 1)
    chars.push(((Math.random() * 16) | 0).toString(16));
  return chars.join("");
}

export function computeBlockIdInsertion(
  block: Pick<BlockCacheBlock, "node"> & { content: string },
  blockId: string,
): BlockIdInsertion {
  const node = block.node;
  const blockStart = node.position.start.offset;
  let blockEnd = node.position.end.offset;
  let addition: string;
  let newlines = 0;
  if (node.type === "listItem") {
    const children = node.children;
    if (children && children.length > 1) {
      const last = children[children.length - 1];
      const previous = children[children.length - 2];
      if (last.type === "list") blockEnd = previous.position.end.offset;
    }
  }
  if (node.type === "paragraph" || node.type === "listItem") {
    addition = ` ^${blockId}`;
  } else {
    addition = `\n\n^${blockId}`;
    newlines = 2;
    if (block.content[blockEnd] !== "\n" || block.content[blockEnd + 1] !== "\n") {
      addition += "\n";
      newlines += 1;
    }
  }
  return { blockStart, blockEnd, addition, newlines };
}

export function parseMarkdownBlocks(
  content: string,
  cancelToken: BlockCacheCancelToken | null = null,
): BlockCacheBlock[] {
  const lines = splitLines(content);
  const blocks: BlockCacheBlock[] = [];
  let index = frontmatterEndLine(lines);
  while (index < lines.length) {
    if (isCancelled(cancelToken)) break;
    const line = lines[index];
    if (!line.text.trim()) {
      index += 1;
      continue;
    }
    const standaloneId = parseStandaloneBlockId(line.text);
    if (standaloneId) {
      const previous = blocks[blocks.length - 1];
      if (previous) previous.node.id = standaloneId;
      index += 1;
      continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line.text);
    if (heading) {
      const { text, id } = stripTrailingBlockId(heading[2]);
      const display = `${heading[1]} ${text.trim()}`.trim();
      if (display)
        blocks.push({
          display,
          node: {
            type: "heading",
            id,
            depth: heading[1].length,
            position: linePosition(line, line),
          },
        });
      index += 1;
      continue;
    }
    const listItem = /^(\s*)[-*+]\s+(.+)$/.exec(line.text);
    if (listItem) {
      const { text, id } = stripTrailingBlockId(listItem[2]);
      const display = text.trim();
      const nestedList = nextNestedList(lines, index, listItem[1].length);
      const lineEnd = nestedList ? line : nestedListEnd(lines, index);
      if (display)
        blocks.push({
          display,
          node: {
            type: "listItem",
            id,
            depth: listItem[1].length,
            position: linePosition(line, lineEnd),
            ...(nestedList
              ? {
                  children: [
                    { type: "paragraph", position: linePosition(line, line) },
                    { type: "list", position: linePosition(nestedList.start, nestedList.end) },
                  ],
                }
              : {}),
          },
        });
      index += 1;
      continue;
    }
    const start = index;
    const paragraphLines: typeof lines = [];
    while (index < lines.length && lines[index].text.trim()) {
      if (
        index !== start &&
        (/^(#{1,6})\s+/.test(lines[index].text) || /^(\s*)[-*+]\s+/.test(lines[index].text))
      )
        break;
      const blockId = parseStandaloneBlockId(lines[index].text);
      if (blockId) break;
      paragraphLines.push(lines[index]);
      index += 1;
    }
    const raw = paragraphLines.map((item) => item.text).join("\n");
    const { text, id } = stripTrailingBlockId(raw);
    const display = text.trim();
    const end = paragraphLines[paragraphLines.length - 1] ?? lines[start];
    if (display)
      blocks.push({
        display,
        node: {
          type: "paragraph",
          id,
          position: linePosition(lines[start], end),
        },
      });
  }
  return blocks;
}

function splitLines(content: string): Array<{ text: string; line: number; offset: number }> {
  const result: Array<{ text: string; line: number; offset: number }> = [];
  let offset = 0;
  const lines = content.split(/\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const text = lines[index].replace(/\r$/, "");
    result.push({ text, line: index, offset });
    offset += lines[index].length + 1;
  }
  return result;
}

function frontmatterEndLine(lines: Array<{ text: string }>): number {
  if (lines[0]?.text.trim() !== "---") return 0;
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index].text.trim() === "---") return index + 1;
  }
  return 0;
}

function parseStandaloneBlockId(text: string): string | null {
  return /^\^([a-zA-Z0-9-]+)\s*$/.exec(text.trim())?.[1] ?? null;
}

function stripTrailingBlockId(text: string): { text: string; id?: string } {
  const match = /(?:^|\s)\^([a-zA-Z0-9-]+)\s*$/.exec(text);
  if (!match) return { text };
  return { text: text.slice(0, match.index).trimEnd(), id: match[1] };
}

function nextNestedList(
  lines: Array<{ text: string; line: number; offset: number }>,
  index: number,
  indent: number,
): {
  start: { text: string; line: number; offset: number };
  end: { text: string; line: number; offset: number };
} | null {
  const nested: Array<{ text: string; line: number; offset: number }> = [];
  for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
    const text = lines[cursor].text;
    if (!text.trim()) break;
    const match = /^(\s*)[-*+]\s+/.exec(text);
    if (!match) break;
    if (match[1].length <= indent) break;
    nested.push(lines[cursor]);
  }
  if (nested.length === 0) return null;
  return { start: nested[0], end: nested[nested.length - 1] };
}

function nestedListEnd(
  lines: Array<{ text: string; line: number; offset: number }>,
  index: number,
): { text: string; line: number; offset: number } {
  let end = lines[index];
  for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
    const text = lines[cursor].text;
    if (!text.trim()) break;
    if (/^(\s*)[-*+]\s+/.test(text)) end = lines[cursor];
    else break;
  }
  return end;
}

function linePosition(
  start: { text: string; line: number; offset: number },
  end: { text: string; line: number; offset: number },
): BlockCachePosition {
  return {
    start: { line: start.line, col: 0, offset: start.offset },
    end: { line: end.line, col: end.text.length, offset: end.offset + end.text.length },
  };
}

function isCancelled(cancelToken: BlockCacheCancelToken | null): boolean {
  cancelToken?.throwIfCancelled?.();
  if (typeof cancelToken?.isCancelled === "function") return cancelToken.isCancelled();
  return Boolean(cancelToken?.isCancelled || cancelToken?.cancelled);
}

function hashContent(content: string): number {
  let hash = 2166136261;
  for (let index = 0; index < content.length; index += 1) {
    hash ^= content.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
