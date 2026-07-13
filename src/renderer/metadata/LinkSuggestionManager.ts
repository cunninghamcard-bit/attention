import {
  computeBlockIdInsertion,
  createBlockId,
  type BlockCacheBlock,
  type BlockCacheRecord,
} from "./BlockCache";
import type { LinkSuggestion, MetadataHost } from "./MetadataCache";
import type { TFile } from "../vault/TAbstractFile";
import { fuzzyMatch, prepareFuzzyQuery, type FuzzyMatch } from "../core/fuzzy";
import { splitLinkpath } from "./Linkpath";

export type LinkSuggestionMatchRange = Array<[number, number]>;

export type LinkFileSuggestion =
  | {
      type: "file";
      file: TFile;
      path: string;
      score: number;
      matches: LinkSuggestionMatchRange | null;
      downranked?: boolean;
    }
  | {
      type: "alias";
      alias: string;
      file: TFile | null;
      path: string;
      score: number;
      matches: LinkSuggestionMatchRange | null;
      downranked?: boolean;
    }
  | {
      type: "linktext";
      path: string;
      score: number;
      matches: LinkSuggestionMatchRange | null;
    }
  | {
      type: "heading";
      file: TFile | null;
      path: string | null;
      subpath: string;
      level: number;
      heading: string;
      score: number;
      matches: LinkSuggestionMatchRange | null;
    }
  | {
      type: "block";
      file: TFile;
      path: string | null;
      content: string;
      display: string;
      node: BlockCacheBlock["node"];
      score: number;
      matches: LinkSuggestionMatchRange | null;
      idMatch?: LinkSuggestionMatchRange | null;
    };

export interface LinkSuggestionCancelToken {
  isCancelled?: boolean;
  cancelled?: boolean;
  throwIfCancelled?: () => void;
}

export interface LinkSuggestionReplacement {
  replacement: string;
  start: number;
  end: number;
  selectionStart: number;
  selectionEnd: number;
  blockId: string | null;
}

export interface LinkSuggestionReplacementOptions {
  query: string;
  tailText?: string;
  start: number;
  end: number;
  sourcePath?: string;
  key?: string;
  mode?: "markdown" | "frontmatter";
  blockId?: string;
}

type TextMatcher = (text: string) => FuzzyMatch | null;

export class LinkSuggestionManager {
  private fileSuggestions: LinkSuggestion[] | null = null;

  constructor(readonly app: MetadataHost) {
    this.app.metadataCache.on("changed", () => this.clearFileSuggestions());
    this.app.metadataCache.on("deleted", () => this.clearFileSuggestions());
    this.app.metadataCache.on("resolved", () => this.clearFileSuggestions());
  }

  clearFileSuggestions(): void {
    this.fileSuggestions = null;
  }

  async getSuggestionsAsync(
    cancelToken: LinkSuggestionCancelToken | null,
    query: string,
    sourcePath = "",
  ): Promise<LinkFileSuggestion[]> {
    const pipeIndex = query.indexOf("|");
    let suggestions: LinkFileSuggestion[];
    if (pipeIndex !== -1) {
      const { path, subpath } = splitLinkpath(query.slice(0, pipeIndex));
      suggestions = this.getDisplaySuggestions(
        cancelToken,
        path,
        subpath,
        query.slice(pipeIndex + 1),
        sourcePath,
      );
    } else if (query.startsWith("##")) {
      suggestions = this.getGlobalHeadingSuggestions(cancelToken, query.slice(2));
    } else if (query.startsWith("^^")) {
      suggestions = await this.getGlobalBlockSuggestions(cancelToken, query.slice(2));
    } else {
      const { path, subpath } = splitLinkpath(query);
      if (subpath) {
        suggestions = subpath.startsWith("#^")
          ? await this.getBlockSuggestions(cancelToken, path, subpath.slice(2), sourcePath)
          : this.getHeadingSuggestions(cancelToken, path, subpath, sourcePath);
      } else {
        const caretIndex = path.lastIndexOf("^");
        suggestions =
          caretIndex !== -1
            ? await this.getBlockSuggestions(
                cancelToken,
                path.slice(0, caretIndex),
                path.slice(caretIndex + 1),
                sourcePath,
              )
            : this.getFileSuggestions(cancelToken, path);
      }
    }
    suggestions.sort(compareSuggestionScore);
    return suggestions;
  }

  getFileSuggestions(
    cancelToken: LinkSuggestionCancelToken | null,
    query: string,
  ): LinkFileSuggestion[] {
    const trimmedQuery = query.trim();
    const suggestions = this.getCachedLinkSuggestions();
    const results: LinkFileSuggestion[] = [];
    if (trimmedQuery === "") {
      for (const suggestion of suggestions) {
        this.throwIfCancelled(cancelToken);
        if (suggestion.file && this.app.metadataCache.isUserIgnored(suggestion.file.path)) continue;
        if (!suggestion.file) {
          results.push({ type: "linktext", path: suggestion.path, score: 0, matches: null });
        } else if (suggestion.alias) {
          results.push({
            type: "alias",
            alias: suggestion.alias,
            file: suggestion.file,
            path: suggestion.path,
            score: this.getFileMtime(suggestion.file),
            matches: null,
          });
        } else {
          results.push({
            type: "file",
            file: suggestion.file,
            path: suggestion.path,
            score: this.getFileMtime(suggestion.file),
            matches: null,
          });
        }
      }
      results.sort(compareSuggestionScore);
      return results;
    }

    const matcher =
      suggestions.length < 10_000
        ? createFuzzyMatcher(trimmedQuery)
        : createLargeListMatcher(trimmedQuery);
    for (const suggestion of suggestions) {
      this.throwIfCancelled(cancelToken);
      if (!suggestion.file) {
        const match = matcher(suggestion.path);
        if (match)
          results.push({
            type: "linktext",
            path: suggestion.path,
            score: match.score,
            matches: match.matches,
          });
        continue;
      }
      const ignored = this.app.metadataCache.isUserIgnored(suggestion.file.path);
      const match = suggestion.alias
        ? matcher(suggestion.alias)
        : matchFilePath(matcher, suggestion.path);
      if (!match) continue;
      const score = match.score + (ignored ? -10 : 0);
      if (suggestion.alias) {
        results.push({
          type: "alias",
          alias: suggestion.alias,
          file: suggestion.file,
          path: suggestion.path,
          score,
          matches: match.matches,
          downranked: ignored,
        });
      } else {
        results.push({
          type: "file",
          file: suggestion.file,
          path: suggestion.path,
          score,
          matches: match.matches,
          downranked: ignored,
        });
      }
    }
    return results;
  }

  getDisplaySuggestions(
    cancelToken: LinkSuggestionCancelToken | null,
    path: string,
    subpath: string,
    displayQuery: string,
    sourcePath = "",
  ): LinkFileSuggestion[] {
    const linkpathWithSubpath = `${path}${subpath}`;
    const file = this.app.metadataCache.getFirstLinkpathDest(path, sourcePath);
    const aliases = getDisplayAliases(this.app.metadataCache.getFileCache(file)?.frontmatter);
    const matcher = createFuzzyMatcher(displayQuery.trim());
    const suggestions: LinkFileSuggestion[] = [];
    if (file) {
      for (const alias of aliases) {
        this.throwIfCancelled(cancelToken);
        const match = matcher(alias);
        if (!match) continue;
        suggestions.push({
          type: "alias",
          alias,
          file,
          path: linkpathWithSubpath,
          score: match.score,
          matches: match.matches,
        });
      }
    }
    if (suggestions.length > 0) return suggestions;
    return [
      {
        type: "alias",
        alias: displayQuery,
        file: null,
        path: linkpathWithSubpath,
        score: 0,
        matches: [[0, displayQuery.length]],
      },
    ];
  }

  getHeadingSuggestions(
    cancelToken: LinkSuggestionCancelToken | null,
    path: string,
    subpath: string,
    sourcePath = "",
  ): LinkFileSuggestion[] {
    const file = this.app.metadataCache.getFirstLinkpathDest(path, sourcePath);
    if (!file || file.extension !== "md") return [];
    const headings = this.app.metadataCache.getFileCache(file)?.headings ?? [];
    const suggestions = buildHeadingSuggestions(
      cancelToken,
      headings,
      (token) => this.throwIfCancelled(token),
      {
        file,
        path,
        rawSubpath: subpath,
        global: false,
      },
    );
    if (suggestions.length > 0) return suggestions;
    return [
      {
        type: "heading",
        file: null,
        path,
        subpath,
        heading: subpath.slice(1),
        level: 0,
        score: 0,
        matches: [[0, subpath.length]],
      },
    ];
  }

  getGlobalHeadingSuggestions(
    cancelToken: LinkSuggestionCancelToken | null,
    query: string,
  ): LinkFileSuggestion[] {
    const matcher = createFuzzyMatcher(query.trim());
    const suggestions: LinkFileSuggestion[] = [];
    for (const path of this.app.metadataCache.getCachedFiles()) {
      this.throwIfCancelled(cancelToken);
      if (!path.endsWith(".md") || this.app.metadataCache.isUserIgnored(path)) continue;
      const file = this.app.vault.getFileByPath(path);
      if (!file) continue;
      for (const heading of this.app.metadataCache.getCache(path)?.headings ?? []) {
        const match = matcher(heading.heading);
        if (!match) continue;
        suggestions.push({
          type: "heading",
          file,
          path: null,
          subpath: `#${sanitizeHeadingSubpath(heading.heading)}`,
          level: heading.level,
          heading: heading.heading,
          score: match.score,
          matches: match.matches,
        });
      }
    }
    return suggestions;
  }

  async getBlockSuggestions(
    cancelToken: LinkSuggestionCancelToken | null,
    path: string,
    query: string,
    sourcePath = "",
  ): Promise<LinkFileSuggestion[]> {
    const file = this.app.metadataCache.getFirstLinkpathDest(path, sourcePath);
    if (!file || file.extension !== "md") return [];
    const record = await this.app.metadataCache.blockCache.getForFile(cancelToken, file);
    if (!record) return [];
    return this.getBlockSuggestionsForRecord(cancelToken, record, path, query);
  }

  async getGlobalBlockSuggestions(
    cancelToken: LinkSuggestionCancelToken | null,
    query: string,
  ): Promise<LinkFileSuggestion[]> {
    const queryParts = blockQueryParts(query);
    const suggestions: LinkFileSuggestion[] = [];
    for await (const record of this.app.metadataCache.blockCache.getAll(cancelToken)) {
      if (!record) continue;
      for (const block of record.blocks) {
        this.throwIfCancelled(cancelToken);
        const suggestion = this.matchBlock(record, block, null, queryParts);
        if (suggestion) suggestions.push(suggestion);
      }
    }
    return suggestions;
  }

  suggestionToLinkpath(suggestion: LinkFileSuggestion): { path: string; subpath: string } {
    if (suggestion.type === "block")
      return { path: suggestion.file.path, subpath: `#^${suggestion.node.id ?? ""}` };
    if (suggestion.type === "heading")
      return {
        path: suggestion.file?.path ?? suggestion.path ?? "",
        subpath: `#${sanitizeHeadingSubpath(suggestion.heading)}`,
      };
    if (suggestion.type === "file" || suggestion.type === "alias")
      return { path: suggestion.file?.path ?? "", subpath: "" };
    return splitLinkpath(suggestion.path);
  }

  async ensureBlockSuggestionId(
    suggestion: Extract<LinkFileSuggestion, { type: "block" }>,
    blockId = createBlockId(6),
  ): Promise<{
    suggestion: Extract<LinkFileSuggestion, { type: "block" }>;
    blockId: string;
    insertion: ReturnType<typeof computeBlockIdInsertion> | null;
  }> {
    if (suggestion.node.id) return { suggestion, blockId: suggestion.node.id, insertion: null };
    const insertion = computeBlockIdInsertion(suggestion, blockId);
    const nextContent = `${suggestion.content.slice(0, insertion.blockEnd)}${insertion.addition}${suggestion.content.slice(insertion.blockEnd)}`;
    await this.app.vault.modify(suggestion.file, nextContent);
    suggestion.node.id = blockId;
    suggestion.content = nextContent;
    this.app.metadataCache.blockCache.clear();
    return { suggestion, blockId, insertion };
  }

  createLinkSuggestionReplacement(
    suggestion: LinkFileSuggestion | { type: "none" },
    options: LinkSuggestionReplacementOptions,
  ): LinkSuggestionReplacement {
    const mode = options.mode ?? "markdown";
    const key = options.key ?? "";
    const sourcePath = options.sourcePath ?? "";
    const markdownLink =
      mode === "markdown" &&
      Boolean(this.app.vault.getConfig<boolean>("useMarkdownLinks")) &&
      key !== "#" &&
      key !== "^";
    let target = "";
    let display = "";
    let blockId: string | null = null;

    if (suggestion.type === "none") {
      target = options.query;
      display = options.query;
    } else if (suggestion.type === "file") {
      target = this.fileToLinktext(suggestion.file, sourcePath, !markdownLink);
      display = shouldUseFileDisplay(target, suggestion.file) ? suggestion.file.basename : "";
    } else if (suggestion.type === "alias") {
      display = suggestion.alias;
      const { path, subpath } = splitLinkpath(suggestion.path);
      target = `${suggestion.file ? this.fileToLinktext(suggestion.file, sourcePath, !markdownLink) : path}${subpath}`;
    } else if (suggestion.type === "linktext") {
      target = suggestion.path;
      display = suggestion.path;
    } else if (suggestion.type === "heading") {
      target = `${this.resolveSuggestionBasePath(suggestion.file, suggestion.path, sourcePath, !markdownLink)}${suggestion.subpath}`;
      display = suggestion.heading;
    } else {
      const id = suggestion.node.id ?? options.blockId ?? createBlockId(6);
      if (!suggestion.node.id) blockId = id;
      target = `${this.resolveSuggestionBasePath(suggestion.file, suggestion.path, sourcePath, !markdownLink)}#^${id}`;
      display = "";
    }

    if (key === "#")
      target += suggestion.type === "file" && suggestion.file.extension === "pdf" ? "#page=" : "#";
    if (key === "^") target += "^";
    const consumedDisplay = consumeTrailingDisplay(options.tailText ?? "");
    if (consumedDisplay) display = consumedDisplay.display;
    const replacement = markdownLink
      ? markdownReplacement(target, display)
      : wikiReplacement(target, display);
    const end = options.end + (consumedDisplay?.length ?? 0);
    const selection = replacementSelection(replacement, display, markdownLink, key);
    return {
      replacement,
      start: options.start,
      end,
      selectionStart: options.start + selection.start,
      selectionEnd: options.start + selection.end,
      blockId,
    };
  }

  private getCachedLinkSuggestions(): LinkSuggestion[] {
    this.fileSuggestions ??= this.app.metadataCache.getLinkSuggestions();
    return this.fileSuggestions;
  }

  private getFileMtime(file: TFile): number {
    return this.app.metadataCache.getFileInfo(file.path)?.mtime ?? 0;
  }

  private fileToLinktext(file: TFile, sourcePath: string, omitMdExtension: boolean): string {
    return this.app.metadataCache.fileToLinktext(file, sourcePath, omitMdExtension);
  }

  private resolveSuggestionBasePath(
    file: TFile | null,
    path: string | null,
    sourcePath: string,
    omitMdExtension: boolean,
  ): string {
    return file ? this.fileToLinktext(file, sourcePath, omitMdExtension) : (path ?? "");
  }

  private getBlockSuggestionsForRecord(
    cancelToken: LinkSuggestionCancelToken | null,
    record: BlockCacheRecord,
    path: string,
    query: string,
  ): LinkFileSuggestion[] {
    const queryParts = blockQueryParts(query);
    const suggestions: LinkFileSuggestion[] = [];
    for (const block of record.blocks) {
      this.throwIfCancelled(cancelToken);
      const suggestion = this.matchBlock(record, block, path, queryParts);
      if (suggestion) suggestions.push(suggestion);
    }
    return suggestions;
  }

  private matchBlock(
    record: BlockCacheRecord,
    block: BlockCacheBlock,
    path: string | null,
    queryParts: string[],
  ): LinkFileSuggestion | null {
    const displayMatch = matchBlockText(queryParts, block.display.toLowerCase());
    let idMatch: LinkSuggestionMatchRange | null = null;
    let score = scoreBlockMatch(displayMatch);
    if (typeof block.node.id === "string") {
      idMatch = matchBlockText(queryParts, block.node.id.toLowerCase());
      if (idMatch) score = 0;
    }
    if (!displayMatch && !idMatch) return null;
    return {
      type: "block",
      file: record.file,
      path,
      content: record.content,
      display: block.display,
      node: block.node,
      score,
      matches: displayMatch,
      idMatch,
    };
  }

  private throwIfCancelled(cancelToken: LinkSuggestionCancelToken | null): void {
    cancelToken?.throwIfCancelled?.();
    if (cancelToken?.isCancelled || cancelToken?.cancelled)
      throw new Error("Suggestion request cancelled");
  }
}

function createFuzzyMatcher(query: string): TextMatcher {
  const prepared = prepareFuzzyQuery(query);
  return (text) => fuzzyMatch(prepared, text);
}

function createLargeListMatcher(query: string): TextMatcher {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  return (text) => {
    if (tokens.length === 0) return { score: 0, matches: [] };
    const haystack = text.toLowerCase();
    const matches: LinkSuggestionMatchRange = [];
    let cursor = 0;
    for (const token of tokens) {
      const index = haystack.indexOf(token, cursor);
      if (index === -1) return null;
      matches.push([index, index + token.length]);
      cursor = index + token.length;
    }
    const first = matches[0]?.[0] ?? 0;
    const last = matches[matches.length - 1]?.[1] ?? first;
    return {
      score: 500 - first * 3 - Math.max(0, last - first - query.length),
      matches,
    };
  };
}

function matchFilePath(matcher: TextMatcher, path: string): FuzzyMatch | null {
  const name = basename(path);
  const basenameMatch = matcher(name);
  if (basenameMatch) return offsetMatch(basenameMatch, path.length - name.length);
  const pathMatch = matcher(path);
  if (!pathMatch) return null;
  return { score: pathMatch.score - 1, matches: pathMatch.matches };
}

function offsetMatch(match: FuzzyMatch, offset: number): FuzzyMatch {
  return {
    score: match.score,
    matches: match.matches.map(([start, end]) => [start + offset, end + offset]),
  };
}

function compareSuggestionScore(left: LinkFileSuggestion, right: LinkFileSuggestion): number {
  return right.score - left.score;
}

function shouldUseFileDisplay(target: string, file: TFile): boolean {
  return target.includes("/") && !isImageExtension(file.extension);
}

function isImageExtension(extension: string): boolean {
  return ["bmp", "png", "jpg", "jpeg", "gif", "svg", "webp", "avif"].includes(
    extension.toLowerCase(),
  );
}

function wikiReplacement(target: string, display: string): string {
  return display ? `[[${target}|${display}]]` : `[[${target}]]`;
}

function markdownReplacement(target: string, display: string): string {
  return `[${display}](${encodeMarkdownTarget(target)})`;
}

function encodeMarkdownTarget(target: string): string {
  return target.replace(/ /g, "%20").replace(/\)/g, "%29");
}

function consumeTrailingDisplay(tailText: string): { display: string; length: number } | null {
  const match = /^\|([^\]]*)\]\]/.exec(tailText);
  return match ? { display: match[1], length: match[0].length } : null;
}

function replacementSelection(
  replacement: string,
  display: string,
  markdownLink: boolean,
  key: string,
): { start: number; end: number } {
  if (markdownLink) {
    if (!display) return { start: 1, end: 1 };
    return { start: replacement.length, end: replacement.length };
  }
  if (key === "#" || key === "^" || key === "|") {
    const cursor = Math.max(0, replacement.length - 2);
    return { start: cursor, end: cursor };
  }
  if (display) {
    const start = replacement.lastIndexOf(display);
    if (key === "Tab" && start !== -1) return { start, end: start + display.length };
  }
  const cursor = Math.max(0, replacement.length - 2);
  return { start: cursor, end: cursor };
}

function blockQueryParts(query: string): string[] {
  return query
    .toLowerCase()
    .split(" ")
    .filter((part) => part.length > 0);
}

function matchBlockText(queryParts: string[], text: string): LinkSuggestionMatchRange | null {
  if (queryParts.length === 0) return [];
  const matches: LinkSuggestionMatchRange = [];
  let cursor = 0;
  for (const part of queryParts) {
    const index = text.indexOf(part, cursor);
    if (index === -1) return null;
    matches.push([index, index + part.length]);
    cursor = index + part.length;
  }
  return matches;
}

function scoreBlockMatch(matches: LinkSuggestionMatchRange | null): number {
  return matches ? -(matches.length + (matches.length > 0 ? matches[0][0] / 10 : 0)) : 0;
}

function buildHeadingSuggestions(
  cancelToken: LinkSuggestionCancelToken | null,
  headings: Array<{ heading: string; level: number }>,
  throwIfCancelled: (token: LinkSuggestionCancelToken | null) => void,
  options: { file: TFile; path: string | null; rawSubpath: string; global: boolean },
): LinkFileSuggestion[] {
  const parts = options.rawSubpath.split("#").slice(1);
  const query = parts.pop() ?? "";
  let candidates = headings;
  for (const part of parts) {
    const normalized = part.toLowerCase();
    const parent = candidates.find((heading) => heading.heading.toLowerCase() === normalized);
    if (!parent) return [];
    candidates = candidates.filter((heading) => heading.level > parent.level);
  }
  const prefix = parts.length > 0 ? `#${parts.map(sanitizeHeadingSubpath).join("#")}#` : "#";
  if (query === "") {
    return candidates.map((heading) => {
      throwIfCancelled(cancelToken);
      return {
        type: "heading",
        file: options.file,
        path: options.path,
        subpath: `${prefix}${sanitizeHeadingSubpath(heading.heading)}`,
        level: heading.level,
        heading: heading.heading,
        score: 0,
        matches: null,
      };
    });
  }
  const matcher = createFuzzyMatcher(query);
  const suggestions: LinkFileSuggestion[] = [];
  for (const heading of candidates) {
    throwIfCancelled(cancelToken);
    const match = matcher(heading.heading);
    if (!match) continue;
    suggestions.push({
      type: "heading",
      file: options.file,
      path: options.path,
      subpath: `${prefix}${sanitizeHeadingSubpath(heading.heading)}`,
      level: heading.level,
      heading: heading.heading,
      score: match.score,
      matches: match.matches,
    });
  }
  return suggestions;
}

function sanitizeHeadingSubpath(heading: string): string {
  return heading
    .replace(/[:#|^\r\n]/g, " ")
    .replace(/%%/g, " ")
    .replace(/\[\[|\]\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function basename(path: string): string {
  return path.split("/").pop() ?? path;
}

function getDisplayAliases(frontmatter: Record<string, unknown> | undefined): string[] {
  if (!frontmatter) return [];
  const entry = Object.entries(frontmatter).find(([key]) => /^aliases$/i.test(key));
  if (!entry) return [];
  const value = entry[1];
  const values =
    typeof value === "string"
      ? [value]
      : Array.isArray(value)
        ? value.filter((item): item is string => typeof item === "string")
        : [];
  return values.map((item) => item.trim()).filter(Boolean);
}
