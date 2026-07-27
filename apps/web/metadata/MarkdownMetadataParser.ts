/**
 * Input: ./BlockCache, ./Frontmatter, ./MetadataCache (types only)
 * Output: parseMarkdownMetadata
 * Pos: Application code
 *
 * 🔄 Self-reference: When this file changes, update this header
 */

import { parseMarkdownBlocks, type BlockCacheBlock } from "./BlockCache";
import { getFrontmatterValues } from "./Frontmatter";
import type {
  BlockCache,
  CachedMetadata,
  ListItemCache,
  SourceMatchPosition,
  SourceOffsetPosition,
  SourceRangePosition,
} from "./MetadataCache";

/**
 * The pure markdown → CachedMetadata parse, extracted from MetadataCache so it
 * can run inside the metadata web worker (real Obsidian parses there too; the
 * cache's onReceiveMessageFromWorker protocol is that worker's message shape).
 * Everything here must stay DOM-free and dependency-pure — the worker bundle
 * pulls this module and nothing else of the cache (its type imports erase).
 */
export function parseMarkdownMetadata(source: string): CachedMetadata {
  const lines = source.split(/\r?\n/);
  const lineOffsets = getLineOffsets(source, lines);
  const blockEntries = parseMarkdownBlocks(source);
  const wikiLinks = collectWikiLinks(lines, lineOffsets);
  const markdownLinks = collectMarkdownLinks(lines, lineOffsets);
  const frontmatterPosition = getFrontmatterPosition(source);
  const frontmatter = extractFrontmatter(source);
  const contentReferences = [...wikiLinks, ...markdownLinks].filter((match) =>
    isContentReference(match.position, frontmatterPosition),
  );
  return {
    frontmatter,
    ...(frontmatterPosition ? { frontmatterPosition } : {}),
    frontmatterLinks: collectFrontmatterLinks(frontmatter),
    sections: collectSections(lines, lineOffsets, frontmatterPosition),
    blocks: collectBlocks(blockEntries),
    listItems: collectListItems(blockEntries),
    headings: lines.flatMap((line, index) => {
      const match = /^(#{1,6})\s+(.+)$/.exec(line);
      return match
        ? [
            {
              heading: match[2],
              level: match[1].length,
              position: {
                line: index,
                start: { line: index, col: 0, offset: lineOffsets[index] ?? 0 },
                end: {
                  line: index,
                  col: line.length,
                  offset: (lineOffsets[index] ?? 0) + line.length,
                },
              },
            },
          ]
        : [];
    }),
    links: contentReferences
      .filter((match) => !match.embed)
      .map((match) => ({
        link: normalizeLinkpath(match.link),
        original: match.original,
        ...(match.displayText ? { displayText: match.displayText } : {}),
        position: match.position,
        source: match.source,
      })),
    embeds: contentReferences
      .filter((match) => match.embed)
      .map((match) => ({
        link: normalizeLinkpath(match.link),
        original: match.original,
        ...(match.displayText ? { displayText: match.displayText } : {}),
        position: match.position,
        source: match.source,
      })),
    referenceLinks: collectReferenceLinks(lines, lineOffsets),
    footnotes: collectFootnotes(source),
    footnoteRefs: collectFootnoteRefs(source),
    tags: collectTags(lines, lineOffsets),
  };
}

function normalizeLinkpath(linkpath: string): string {
  return linkpath.trim();
}

function extractFrontmatter(source: string): Record<string, unknown> | undefined {
  const frontmatter = getFrontmatterValues(source);
  return Object.keys(frontmatter).length > 0 ? frontmatter : undefined;
}

function collectTags(
  lines: string[],
  lineOffsets: number[],
): Array<{ tag: string; position: SourceRangePosition; source: SourceMatchPosition }> {
  const tags: Array<{ tag: string; position: SourceRangePosition; source: SourceMatchPosition }> =
    [];
  lines.forEach((line, lineNumber) => {
    for (const match of line.matchAll(/(^|\s)#([\p{L}\p{N}/_-]+)/gu)) {
      const prefix = match[1] ?? "";
      const start = (match.index ?? 0) + prefix.length;
      const tag = `#${match[2]}`;
      tags.push({
        tag,
        position: inlineRangeToPosition(lineOffsets, lineNumber, start, start + tag.length),
        source: {
          line: lineNumber,
          start,
          end: start + tag.length,
          text: line,
        },
      });
    }
  });
  return tags;
}

function collectWikiLinks(
  lines: string[],
  lineOffsets: number[],
): Array<{
  original: string;
  link: string;
  displayText?: string;
  embed: boolean;
  position: SourceRangePosition;
  source: SourceMatchPosition;
}> {
  const links: Array<{
    original: string;
    link: string;
    displayText?: string;
    embed: boolean;
    position: SourceRangePosition;
    source: SourceMatchPosition;
  }> = [];
  lines.forEach((line, lineNumber) => {
    for (const match of line.matchAll(/!?\[\[([^\]]+)\]\]/g)) {
      const linkInfo = parseWikiReference(match[1]);
      const start = match.index ?? 0;
      const end = start + match[0].length;
      links.push({
        original: match[0],
        link: linkInfo.link,
        ...(linkInfo.displayText ? { displayText: linkInfo.displayText } : {}),
        embed: match[0].startsWith("!"),
        position: inlineRangeToPosition(lineOffsets, lineNumber, start, end),
        source: {
          line: lineNumber,
          start,
          end,
          text: line,
        },
      });
    }
  });
  return links;
}

function getLineOffsets(source: string, lines: string[]): number[] {
  const offsets: number[] = [];
  let offset = 0;
  for (let index = 0; index < lines.length; index += 1) {
    offsets.push(offset);
    offset += lines[index].length;
    if (source[offset] === "\r") offset += 1;
    if (source[offset] === "\n") offset += 1;
  }
  return offsets;
}

function collectBlocks(blocks: BlockCacheBlock[]): Record<string, BlockCache> | undefined {
  const result: Record<string, { id: string; position: SourceRangePosition }> = {};
  for (const block of blocks) {
    const id = block.node.id;
    if (!id) continue;
    result[id] = { id, position: block.node.position };
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function collectListItems(blocks: BlockCacheBlock[]): ListItemCache[] | undefined {
  const result: ListItemCache[] = [];
  const stack: Array<{ depth: number; line: number }> = [];
  let rootParentLine = 0;
  let previousEndLine = -Infinity;
  for (const block of blocks) {
    const node = block.node;
    if (node.type !== "listItem") continue;
    const depth = node.depth ?? 0;
    const line = node.position.start.line;
    if (depth === 0 && line > previousEndLine + 1) rootParentLine = line;
    while (stack.length > 0 && stack[stack.length - 1].depth >= depth) stack.pop();
    const parent = stack.at(-1)?.line ?? -rootParentLine;
    result.push({
      ...(node.id ? { id: node.id } : {}),
      parent,
      position: node.position,
    });
    stack.push({ depth, line });
    previousEndLine = node.position.end.line;
  }
  return result.length > 0 ? result : undefined;
}

function collectSections(
  lines: string[],
  lineOffsets: number[],
  frontmatterPosition: SourceRangePosition | null,
): Array<{ id?: string; type: string; position: SourceRangePosition }> | undefined {
  const sections: Array<{ id?: string; type: string; position: SourceRangePosition }> = [];
  let index = 0;
  if (frontmatterPosition) {
    sections.push({ type: "yaml", position: frontmatterPosition });
    index = Math.max(0, frontmatterPosition.end.line);
  }

  while (index < lines.length) {
    while (index < lines.length && !lines[index].trim()) index += 1;
    if (index >= lines.length) break;

    const start = index;
    const line = lines[index];
    const sectionType = getSectionType(line);
    if (sectionType === "code") {
      index = findCodeFenceEnd(lines, index) + 1;
    } else if (
      sectionType === "heading" ||
      sectionType === "thematicBreak" ||
      sectionType === "html"
    ) {
      index += 1;
    } else if (sectionType === "list") {
      index = collectUntilBlankOrRootBlock(
        lines,
        index + 1,
        (nextLine) => getSectionType(nextLine) === "list",
      );
    } else if (sectionType === "blockquote" || sectionType === "callout") {
      index = collectUntilBlankOrRootBlock(lines, index + 1, (nextLine) => /^>\s?/.test(nextLine));
    } else if (sectionType === "table") {
      index = collectUntilBlankOrRootBlock(lines, index + 1, (nextLine) => nextLine.includes("|"));
    } else {
      index = collectUntilBlankOrRootBlock(lines, index + 1, () => false);
    }

    const end = Math.max(start, index - 1);
    const id = findSectionBlockId(lines, start, end);
    sections.push({
      ...(id ? { id } : {}),
      type: sectionType,
      position: lineRangeToPosition(lines, lineOffsets, start, end),
    });
  }

  return sections.length > 0 ? sections : undefined;
}

function getFrontmatterPosition(source: string): SourceRangePosition | null {
  const match = /^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n)?/.exec(source);
  if (!match) return null;
  return {
    start: offsetToSourcePosition(source, 0),
    end: offsetToSourcePosition(source, match[0].length),
  };
}

function getSectionType(line: string): string {
  const trimmed = line.trim();
  if (/^```|^~~~/.test(trimmed)) return "code";
  if (/^(#{1,6})\s+/.test(line)) return "heading";
  if (/^>\s*\[![^\]]+\]/i.test(line)) return "callout";
  if (/^>\s?/.test(line)) return "blockquote";
  if (/^[ \t]*(?:[-*+]|\d+[.)])\s+/.test(line)) return "list";
  if (/^ {0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) return "thematicBreak";
  if (/^<\/?[A-Za-z][^>]*>/.test(trimmed)) return "html";
  if (line.includes("|")) return "table";
  return "paragraph";
}

function findCodeFenceEnd(lines: string[], start: number): number {
  const marker = lines[start].trim().startsWith("~~~") ? "~~~" : "```";
  for (let index = start + 1; index < lines.length; index += 1) {
    if (lines[index].trim().startsWith(marker)) return index;
  }
  return lines.length - 1;
}

function collectUntilBlankOrRootBlock(
  lines: string[],
  index: number,
  sameBlock: (line: string) => boolean,
): number {
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) break;
    if (!sameBlock(line) && isRootSectionStart(line)) break;
    index += 1;
  }
  return index;
}

function isRootSectionStart(line: string): boolean {
  const type = getSectionType(line);
  return (
    type === "heading" ||
    type === "code" ||
    type === "thematicBreak" ||
    type === "html" ||
    type === "blockquote" ||
    type === "callout" ||
    type === "list"
  );
}

function findSectionBlockId(lines: string[], start: number, end: number): string | null {
  for (let index = start; index <= end; index += 1) {
    const match = /\s\^([A-Za-z0-9-]+)\s*$/.exec(lines[index]);
    if (match) return match[1];
  }
  return null;
}

function lineRangeToPosition(
  lines: string[],
  lineOffsets: number[],
  start: number,
  end: number,
): SourceRangePosition {
  const startOffset = lineOffsets[start] ?? 0;
  const endOffset = (lineOffsets[end] ?? startOffset) + (lines[end]?.length ?? 0);
  return {
    start: { line: start, col: 0, offset: startOffset },
    end: { line: end, col: lines[end]?.length ?? 0, offset: endOffset },
  };
}

function collectMarkdownLinks(
  lines: string[],
  lineOffsets: number[],
): Array<{
  original: string;
  link: string;
  displayText?: string;
  embed: boolean;
  position: SourceRangePosition;
  source: SourceMatchPosition;
}> {
  const links: Array<{
    original: string;
    link: string;
    displayText?: string;
    embed: boolean;
    position: SourceRangePosition;
    source: SourceMatchPosition;
  }> = [];
  lines.forEach((line, lineNumber) => {
    for (const match of line.matchAll(/!?\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
      const start = match.index ?? 0;
      const end = start + match[0].length;
      links.push({
        original: match[0],
        link: safeDecodeLinkpath(match[2]),
        ...(match[1] ? { displayText: match[1] } : {}),
        embed: match[0].startsWith("!"),
        position: inlineRangeToPosition(lineOffsets, lineNumber, start, end),
        source: {
          line: lineNumber,
          start,
          end,
          text: line,
        },
      });
    }
  });
  return links.filter((link) => !isExternalLink(link.link));
}

function collectReferenceLinks(
  lines: string[],
  lineOffsets: number[],
): Array<{
  id: string;
  link: string;
  position: SourceRangePosition;
  source: SourceMatchPosition;
}> {
  const links: Array<{
    id: string;
    link: string;
    position: SourceRangePosition;
    source: SourceMatchPosition;
  }> = [];
  lines.forEach((line, lineNumber) => {
    const match = /^[ \t]{0,3}\[(?!\^)([^\]\s]+)\]:[ \t]*(\S+)/.exec(line);
    if (!match) return;
    const start = line.indexOf(match[0]);
    links.push({
      id: match[1],
      link: safeDecodeLinkpath(match[2]),
      position: inlineRangeToPosition(lineOffsets, lineNumber, start, start + match[0].length),
      source: {
        line: lineNumber,
        start,
        end: start + match[0].length,
        text: line,
      },
    });
  });
  return links;
}

function collectFrontmatterLinks(
  frontmatter: Record<string, unknown> | undefined,
): Array<{ key: string; link: string; original: string; displayText?: string }> | undefined {
  if (!frontmatter) return undefined;
  const links: Array<{ key: string; link: string; original: string; displayText?: string }> = [];
  for (const [key, value] of Object.entries(frontmatter))
    collectFrontmatterLinksFromValue(key, value, links);
  return links.length > 0 ? links : undefined;
}

function collectFrontmatterLinksFromValue(
  key: string,
  value: unknown,
  links: Array<{ key: string; link: string; original: string; displayText?: string }>,
): void {
  if (typeof value === "string") {
    for (const match of value.matchAll(/\[\[([^\]]+)\]\]/g)) {
      const parsed = parseWikiReference(match[1]);
      links.push({
        key,
        link: parsed.link,
        original: match[0],
        ...(parsed.displayText ? { displayText: parsed.displayText } : {}),
      });
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectFrontmatterLinksFromValue(key, item, links);
  }
}

function parseWikiReference(value: string): { link: string; displayText?: string } {
  const [link, displayText] = value.split("|", 2);
  return {
    link: link.trim(),
    ...(displayText?.trim() ? { displayText: displayText.trim() } : {}),
  };
}

function inlineRangeToPosition(
  lineOffsets: number[],
  line: number,
  start: number,
  end: number,
): SourceRangePosition {
  const lineOffset = lineOffsets[line] ?? 0;
  return {
    start: { line, col: start, offset: lineOffset + start },
    end: { line, col: end, offset: lineOffset + end },
  };
}

function isContentReference(
  position: SourceRangePosition,
  frontmatterPosition: SourceRangePosition | null,
): boolean {
  return !frontmatterPosition || position.start.offset >= frontmatterPosition.end.offset;
}

function collectFootnotes(source: string): Array<{ id: string; position: SourceRangePosition }> {
  const footnotes: Array<{ id: string; position: SourceRangePosition }> = [];
  for (const match of source.matchAll(
    /(^|\n)([ \t]{0,3}\[\^([^\]\s]+)\]:[^\n]*(?:\n[ \t]+[^\n]*)*)/g,
  )) {
    const prefix = match[1] ?? "";
    const definition = match[2] ?? "";
    const id = match[3] ?? "";
    if (!id || !definition) continue;
    const start = (match.index ?? 0) + prefix.length;
    const end = start + definition.length;
    footnotes.push({
      id,
      position: {
        start: offsetToSourcePosition(source, start),
        end: offsetToSourcePosition(source, end),
      },
    });
  }
  return footnotes;
}

function collectFootnoteRefs(source: string): Array<{ id: string; position: SourceRangePosition }> {
  const refs: Array<{ id: string; position: SourceRangePosition }> = [];
  for (const match of source.matchAll(/\[\^([^\]\s]+)\](?!:)/g)) {
    const id = match[1] ?? "";
    if (!id) continue;
    const start = match.index ?? 0;
    const end = start + match[0].length;
    refs.push({
      id,
      position: {
        start: offsetToSourcePosition(source, start),
        end: offsetToSourcePosition(source, end),
      },
    });
  }
  return refs;
}

function offsetToSourcePosition(source: string, offset: number): SourceOffsetPosition {
  const clamped = Math.max(0, Math.min(source.length, offset));
  const before = source.slice(0, clamped).split(/\r?\n/);
  return {
    line: before.length - 1,
    col: before[before.length - 1]?.length ?? 0,
    offset: clamped,
  };
}

function safeDecodeLinkpath(linkpath: string): string {
  try {
    return decodeURIComponent(linkpath);
  } catch {
    return linkpath;
  }
}

function isExternalLink(linkpath: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(linkpath) || linkpath.startsWith("#");
}
