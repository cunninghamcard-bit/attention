import type { App } from "../app/App";
import type { TFile } from "../vault/TAbstractFile";
import { CODE_EXTENSIONS } from "../views/CodeFileView";

// Search every text file the workspace can open: notes plus source code.
// Binary formats (images, pdf, audio) stay out — reading them as text
// produces garbage matches.
const SEARCHABLE_EXTENSIONS = new Set(["md", "canvas", ...CODE_EXTENSIONS]);

export interface SearchMatch {
  line: number;
  text: string;
  start: number;
  end: number;
}

export interface VaultSearchResult {
  path: string;
  matches: SearchMatch[];
}

export interface SearchQuery {
  query: string;
  caseSensitive?: boolean;
  pathPrefix?: string;
}

/**
 * Obsidian's search-operator query language, the subset the search options
 * dropdown advertises: `path:`, `file:`, `tag:` filter files; `line:(a b)`
 * and `section:(a b)` scope keyword groups; `[property]`/`[property:value]`
 * match frontmatter. Everything else is a plain keyword.
 */
interface ParsedSearchQuery {
  words: string[];
  pathTerms: string[];
  fileTerms: string[];
  tagTerms: string[];
  propertyTerms: Array<{ key: string; value: string | null }>;
  lineGroups: string[][];
  sectionGroups: string[][];
}

export class SearchEngine {
  constructor(readonly app: App) {}

  async search(query: SearchQuery): Promise<VaultSearchResult[]> {
    const rawQuery = query.query.trim();
    if (!rawQuery) return [];
    const fold = (text: string) => (query.caseSensitive ? text : text.toLowerCase());
    const parsed = parseSearchQuery(fold(rawQuery));
    const results: VaultSearchResult[] = [];

    for (const file of this.app.vault.getFiles()) {
      if (!SEARCHABLE_EXTENSIONS.has(file.extension)) continue;
      if (query.pathPrefix && !file.path.startsWith(query.pathPrefix)) continue;
      if (!this.passesFileFilters(file, parsed, fold)) continue;

      const hasContentTerms = parsed.words.length > 0 || parsed.lineGroups.length > 0 || parsed.sectionGroups.length > 0;
      if (!hasContentTerms) {
        results.push({ path: file.path, matches: [] });
        continue;
      }

      const source = await this.app.vault.read(file);
      const lines = source.split(/\r?\n/);
      const haystacks = lines.map(fold);
      const matches = this.matchContent(file, lines, haystacks, parsed);
      if (matches) results.push({ path: file.path, matches });
    }

    results.sort((a, b) => a.path.localeCompare(b.path, undefined, { sensitivity: "base", numeric: true }));
    this.app.workspace.trigger("search-complete", query, results);
    return results;
  }

  private passesFileFilters(file: TFile, parsed: ParsedSearchQuery, fold: (text: string) => string): boolean {
    for (const term of parsed.pathTerms) if (!fold(file.path).includes(term)) return false;
    for (const term of parsed.fileTerms) if (!fold(file.name).includes(term)) return false;
    if (parsed.tagTerms.length > 0) {
      const tags = this.tagsOf(file).map(fold);
      for (const term of parsed.tagTerms) {
        if (!tags.some((tag) => tag === term || tag.startsWith(`${term}/`))) return false;
      }
    }
    if (parsed.propertyTerms.length > 0) {
      const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
      const keys = new Map(Object.keys(frontmatter).map((key) => [fold(key), key] as const));
      for (const { key, value } of parsed.propertyTerms) {
        const realKey = keys.get(key);
        if (realKey === undefined) return false;
        if (value !== null && !fold(String(frontmatter[realKey] ?? "")).includes(value)) return false;
      }
    }
    return true;
  }

  private tagsOf(file: TFile): string[] {
    const cache = this.app.metadataCache.getFileCache(file);
    const tags = (cache?.tags ?? []).map((entry) => entry.tag.replace(/^#/, ""));
    const frontmatterTags = cache?.frontmatter?.tags;
    if (Array.isArray(frontmatterTags)) tags.push(...frontmatterTags.map((tag) => String(tag).replace(/^#/, "")));
    else if (typeof frontmatterTags === "string") tags.push(frontmatterTags.replace(/^#/, ""));
    return tags;
  }

  /** Returns matches when the content terms are satisfied, null otherwise. */
  private matchContent(file: TFile, lines: string[], haystacks: string[], parsed: ParsedSearchQuery): SearchMatch[] | null {
    const matches: SearchMatch[] = [];

    for (const word of parsed.words) {
      const found = collectWordMatches(lines, haystacks, word, 0, haystacks.length);
      if (found.length === 0) return null;
      matches.push(...found);
    }

    for (const group of parsed.lineGroups) {
      let satisfied = false;
      for (let index = 0; index < haystacks.length; index++) {
        if (!group.every((word) => haystacks[index].includes(word))) continue;
        satisfied = true;
        for (const word of group) matches.push(...collectWordMatches(lines, haystacks, word, index, index + 1));
      }
      if (!satisfied) return null;
    }

    if (parsed.sectionGroups.length > 0) {
      const sections = this.sectionRangesOf(file, haystacks.length);
      for (const group of parsed.sectionGroups) {
        let satisfied = false;
        for (const [from, to] of sections) {
          if (!group.every((word) => haystacks.slice(from, to).some((line) => line.includes(word)))) continue;
          satisfied = true;
          for (const word of group) matches.push(...collectWordMatches(lines, haystacks, word, from, to));
        }
        if (!satisfied) return null;
      }
    }

    matches.sort((a, b) => a.line - b.line || a.start - b.start);
    return dedupeMatches(matches);
  }

  private sectionRangesOf(file: TFile, lineCount: number): Array<[number, number]> {
    const headings = this.app.metadataCache.getFileCache(file)?.headings ?? [];
    if (headings.length === 0) return [[0, lineCount]];
    const starts = headings.map((heading) => heading.position.start.line);
    const ranges: Array<[number, number]> = [];
    if (starts[0] > 0) ranges.push([0, starts[0]]);
    for (let index = 0; index < starts.length; index++) {
      ranges.push([starts[index], index + 1 < starts.length ? starts[index + 1] : lineCount]);
    }
    return ranges;
  }
}

function collectWordMatches(lines: string[], haystacks: string[], word: string, fromLine: number, toLine: number): SearchMatch[] {
  const matches: SearchMatch[] = [];
  for (let index = fromLine; index < toLine; index++) {
    const haystack = haystacks[index];
    let cursor = 0;
    while (cursor <= haystack.length) {
      const start = haystack.indexOf(word, cursor);
      if (start === -1) break;
      matches.push({ line: index, text: lines[index], start, end: start + word.length });
      cursor = Math.max(start + word.length, start + 1);
    }
  }
  return matches;
}

function dedupeMatches(matches: SearchMatch[]): SearchMatch[] {
  const seen = new Set<string>();
  return matches.filter((match) => {
    const key = `${match.line}:${match.start}:${match.end}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parseSearchQuery(query: string): ParsedSearchQuery {
  const parsed: ParsedSearchQuery = { words: [], pathTerms: [], fileTerms: [], tagTerms: [], propertyTerms: [], lineGroups: [], sectionGroups: [] };
  const tokenPattern = /\[([^\]]+)\]|(path|file|tag|line|section):(?:\(([^)]*)\)|"([^"]*)"|(\S*))|"([^"]*)"|(\S+)/g;
  for (const token of query.matchAll(tokenPattern)) {
    const [, property, operator, parens, quoted, bare, quotedWord, plainWord] = token;
    if (property !== undefined) {
      const colon = property.indexOf(":");
      parsed.propertyTerms.push(colon === -1
        ? { key: property.trim(), value: null }
        : { key: property.slice(0, colon).trim(), value: property.slice(colon + 1).trim() });
      continue;
    }
    if (operator !== undefined) {
      const value = parens ?? quoted ?? bare ?? "";
      const groupWords = value.split(/\s+/).filter(Boolean);
      if (groupWords.length === 0) continue;
      if (operator === "path") parsed.pathTerms.push(value.trim());
      else if (operator === "file") parsed.fileTerms.push(value.trim());
      else if (operator === "tag") parsed.tagTerms.push(...groupWords.map((tag) => tag.replace(/^#/, "")));
      else if (operator === "line") parsed.lineGroups.push(groupWords);
      else if (operator === "section") parsed.sectionGroups.push(groupWords);
      continue;
    }
    const word = quotedWord ?? plainWord;
    if (word) parsed.words.push(word);
  }
  return parsed;
}
