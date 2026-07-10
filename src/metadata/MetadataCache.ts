import { Events } from "../core/Events";
import type { EventRef } from "../core/Events";
import { unregisterEventRef } from "../core/EventRefInternal";
import type { App } from "../app/App";
import { getAllTags } from "../api/ApiUtils";
import { createMetadataCacheStore, type MetadataCachePersistentStore } from "./MetadataCacheStore";
import { getFrontmatterValues } from "../properties/Frontmatter";
import type { PropertyType } from "../properties/PropertyTypes";
import { TFile } from "../vault/TAbstractFile";
import type { Vault } from "../vault/Vault";
import { Notice } from "../ui/Notice";
import { MarkdownBlockCache, parseMarkdownBlocks, type BlockCacheBlock } from "./BlockCache";

export interface CachedMetadata {
  frontmatter?: FrontMatterCache;
  frontmatterPosition?: Pos;
  frontmatterLinks?: FrontmatterLinkCache[];
  sections?: SectionCache[];
  headings?: HeadingCache[];
  blocks?: Record<string, BlockCache>;
  listItems?: ListItemCache[];
  links?: LinkCache[];
  embeds?: EmbedCache[];
  referenceLinks?: ReferenceLinkCache[];
  footnotes?: FootnoteCache[];
  footnoteRefs?: FootnoteRefCache[];
  tags?: TagCache[];
}

export interface Reference {
  link: string;
  original: string;
  displayText?: string;
}

export interface ReferenceCache extends Reference, CacheItem {
  source?: SourceMatchPosition;
}

export interface LinkCache extends ReferenceCache {}

export interface EmbedCache extends ReferenceCache {}

export interface FrontmatterLinkCache extends Reference {
  key: string;
}

export interface Loc {
  line: number;
  col: number;
  offset: number;
}

export interface Pos {
  start: Loc;
  end: Loc;
}

export interface SourceOffsetPosition extends Loc {}

export interface SourceRangePosition extends Pos {
  line?: number;
}

export interface CacheItem {
  position: Pos;
}

export interface BlockCache extends CacheItem {
  id: string;
}

export interface FrontMatterCache {
  [key: string]: any;
}

export interface SectionCache extends CacheItem {
  id?: string | undefined;
  type: "blockquote" | "callout" | "code" | "element" | "footnoteDefinition" | "heading" | "html" | "list" | "paragraph" | "table" | "text" | "thematicBreak" | "yaml" | string;
}

export interface HeadingCache extends CacheItem {
  heading: string;
  level: number;
  position: SourceRangePosition;
}

export interface ListItemCache extends CacheItem {
  id?: string | undefined;
  task?: string | undefined;
  parent: number;
}

export interface ReferenceLinkCache extends CacheItem {
  id: string;
  link: string;
  source?: SourceMatchPosition;
}

export interface FootnoteCache extends CacheItem {
  id: string;
}

export interface FootnoteRefCache extends CacheItem {
  id: string;
}

export interface TagCache extends CacheItem {
  tag: string;
  source?: SourceMatchPosition;
}

export interface SourceMatchPosition {
  line: number;
  start: number;
  end: number;
  text: string;
}

export interface FrontmatterPropertyInfo {
  name: string;
  widget: PropertyType;
  occurrences: number;
}

export type FrontmatterPropertyInfoMap = Record<string, FrontmatterPropertyInfo>;

export interface FileCacheInfo {
  mtime: number;
  size: number;
  hash: string;
}

export interface LinkSuggestion {
  file: TFile | null;
  path: string;
  alias?: string;
}

export function iterateRefs(refs: Reference[] | null | undefined, cb: (ref: Reference) => boolean | void): boolean {
  if (!refs) return false;
  for (const ref of refs) {
    if (cb(ref)) return true;
  }
  return false;
}

export function iterateCacheRefs(cache: CachedMetadata | null | undefined, cb: (ref: ReferenceCache) => boolean | void): boolean {
  return !!cache && (
    iterateRefs(cache.links, cb as (ref: Reference) => boolean | void)
    || iterateRefs(cache.embeds, cb as (ref: Reference) => boolean | void)
  );
}

export class MetadataCache extends Events {
  readonly blockCache: MarkdownBlockCache;
  private fileCache = new Map<string, FileCacheInfo>();
  private metadataCache = new Map<string, CachedMetadata>();
  readonly resolvedLinks: Record<string, Record<string, number>> = {};
  readonly unresolvedLinks: Record<string, Record<string, number>> = {};
  private initialized = false;
  private preloadPromise: Promise<void> | null = null;
  private inProgressTaskCount = 0;
  private didFinishTimer: ReturnType<typeof setTimeout> | null = null;
  private vaultEventRefs: EventRef[] = [];
  private cleanupDeletedCacheInterval: ReturnType<typeof setInterval> | null = null;
  private cleanupDeletedCacheTimeout: ReturnType<typeof setTimeout> | null = null;
  private linkResolverQueue: Array<TFile | null> = [];
  private linkResolverRunning = false;
  private linkResolverNotifyTimer: ReturnType<typeof setTimeout> | null = null;
  private onCleanCacheCallbacks: Array<() => void> = [];
  private workQueue: Promise<unknown> = Promise.resolve();
  private uniqueFileLookup = new Map<string, TFile[]>();
  private workerResolve: ((metadata: CachedMetadata) => void) | null = null;
  private workerReject: ((reason: unknown) => void) | null = null;
  private indexingNoticeTimer: ReturnType<typeof setTimeout> | null = null;
  private indexingCompleteTimer: ReturnType<typeof setTimeout> | null = null;
  private indexingNotice: Notice | null = null;

  override on(name: "changed", callback: (file: TFile, data: string, cache: CachedMetadata) => any, ctx?: any): EventRef;
  override on(name: "deleted", callback: (file: TFile, prevCache: CachedMetadata | null) => any, ctx?: any): EventRef;
  override on(name: "resolve", callback: (file: TFile) => any, ctx?: any): EventRef;
  override on(name: "resolved", callback: () => any, ctx?: any): EventRef;
  override on<TArgs extends unknown[]>(name: string, callback: (...args: TArgs) => any, ctx?: object): EventRef<TArgs>;
  override on<TArgs extends unknown[]>(name: string, callback: (...args: TArgs) => any, ctx?: object): EventRef<TArgs> {
    return super.on(name, callback, ctx);
  }

  constructor(readonly vault: Vault, readonly app?: App, private readonly persistentStore: MetadataCachePersistentStore | null = createMetadataCacheStore(app?.appId ?? "obsidian-reconstructed")) {
    super();
    this.blockCache = new MarkdownBlockCache(this.vault);
    this.on("finished", () => this.checkCleanCache());
    this.on("resolved", () => this.checkCleanCache());
  }

  getFileCache(file: TFile | null): CachedMetadata | null {
    if (!file) return null;
    return this.getCache(file.path);
  }

  entries(): Array<[string, CachedMetadata]> {
    return this.getCachedFiles()
      .map((path) => [path, this.getCache(path)] as [string, CachedMetadata | null])
      .filter((entry): entry is [string, CachedMetadata] => entry[1] !== null);
  }

  getCachedFiles(): string[] {
    return [...this.fileCache.keys()];
  }

  getFileInfo(path: string): FileCacheInfo | null {
    return this.fileCache.get(path) ?? null;
  }

  getCache(path: string): CachedMetadata | null {
    const info = this.fileCache.get(path);
    if (!info) return null;
    if (!path.endsWith(".md")) return {};
    return this.metadataCache.get(info.hash) ?? null;
  }

  isUserIgnored(path: string): boolean {
    const filters = this.vault.getConfig<string[] | null>("userIgnoreFilters") ?? [];
    if (filters.length === 0) return false;
    const normalizedPath = normalizePath(path);
    return filters.some((filter) => matchesIgnoreFilter(normalizedPath, filter));
  }

  getCacheByPath(path: string): CachedMetadata | null {
    return this.getCache(path);
  }

  getFrontmatterPropertyValuesForKey(key: string): string[] {
    const values = new Set<string>();
    for (const path of this.getCachedFiles()) {
      const cache = this.getCache(path);
      if (this.isUserIgnored(path) || !cache?.frontmatter || !Object.prototype.hasOwnProperty.call(cache.frontmatter, key)) continue;
      const value = cache.frontmatter[key];
      if (Array.isArray(value)) {
        for (const item of value) {
          if (typeof item === "string") values.add(item);
        }
      } else if (typeof value === "string") {
        values.add(value);
      }
    }
    return [...values].sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base", numeric: true }));
  }

  getAllPropertyInfos(): FrontmatterPropertyInfoMap {
    const infos: Record<string, FrontmatterPropertyInfo & { widget?: PropertyType }> = {};
    for (const [key, assigned] of this.app?.metadataTypeManager.assignedWidgets ?? []) {
      infos[key] = {
        name: assigned.name,
        widget: assigned.widget,
        occurrences: 0,
      };
    }
    for (const path of this.getCachedFiles()) {
      const cache = this.getCache(path);
      if (this.isUserIgnored(path) || !cache?.frontmatter) continue;
      for (const [name, value] of Object.entries(cache.frontmatter)) {
        const key = name.toLowerCase();
        const info = infos[key] ?? {
          name,
          widget: value != null ? inferFrontmatterWidget(value) : undefined,
          occurrences: 0,
        };
        info.occurrences += 1;
        if (!info.widget && value != null) info.widget = inferFrontmatterWidget(value);
        infos[key] = info;
      }
    }
    for (const info of Object.values(infos)) info.widget ??= "text";
    return infos as FrontmatterPropertyInfoMap;
  }

  getLinkSuggestions(): LinkSuggestion[] {
    const suggestions: LinkSuggestion[] = [];
    const seen = new Set<string>();
    for (const file of this.vault.getFiles()) {
      if (!this.isSupportedFile(file)) continue;
      const path = file.extension === "md" ? stripExtension(file.path) : file.path;
      suggestions.push({ file, path });
      seen.add(path);
      const aliases = getFrontmatterAliases(this.getFileCache(file)?.frontmatter);
      for (const alias of aliases) suggestions.push({ file, path, alias });
    }
    for (const unresolved of Object.values(this.unresolvedLinks)) {
      for (const path of Object.keys(unresolved)) {
        const truncated = path.length > 500 ? path.slice(0, 500) : path;
        if (seen.has(truncated)) continue;
        seen.add(truncated);
        suggestions.push({ file: null, path: truncated });
      }
    }
    return suggestions;
  }

  // Real `getTags()`: vault-wide '#tag' -> occurrence count. Each nested tag
  // also counts toward its parents ('#foo/bar' increments '#foo'), ignored
  // files are skipped, and casings are merged per lowercase key — the casing
  // with the highest individual count becomes the reported key.
  getTags(): Record<string, number> {
    const counts: Record<string, number> = {};
    const count = (tag: string): void => {
      if (tag.endsWith("/")) tag = tag.slice(0, -1);
      if (!isValidTag(tag)) return;
      const last = tag.split("/").pop() ?? tag;
      counts[tag] = (counts[tag] ?? 0) + 1;
      if (last !== tag) count(tag.slice(0, tag.length - last.length - 1));
    };
    for (const [path, info] of this.fileCache) {
      if (this.isUserIgnored(path)) continue;
      const cache = this.metadataCache.get(info.hash);
      if (!cache) continue;
      for (const tag of getAllTags(cache) ?? []) count(tag);
    }
    const merged: Record<string, { tag: string; count: number; max: number }> = {};
    for (const [tag, total] of Object.entries(counts)) {
      const key = tag.toLowerCase();
      const entry = merged[key];
      if (entry) {
        entry.count += total;
        if (total > entry.max) {
          entry.max = total;
          entry.tag = tag;
        }
      } else {
        merged[key] = { tag, count: total, max: total };
      }
    }
    const result: Record<string, number> = {};
    for (const entry of Object.values(merged)) result[entry.tag] = entry.count;
    return result;
  }

  fileToLinktext(file: TFile, sourcePath = "", omitMdExtension = true): string {
    const format = this.vault.getConfig<string>("newLinkFormat") ?? "shortest";
    const fullPath = file.extension === "md" && omitMdExtension && file.path.endsWith(".md")
      ? file.path.slice(0, -3)
      : file.path;

    if (format === "absolute") return fullPath;
    if (format === "relative") return relativePath(sourcePath, fullPath);

    const shortName = file.extension === "md" && omitMdExtension ? file.basename : file.name;
    const candidates = this.getLinkpathDest(stripSubpath(shortName), sourcePath);
    return candidates.length === 1 && candidates[0] === file ? shortName : fullPath;
  }

  async computeFileMetadata(file: TFile): Promise<CachedMetadata> {
    return this.computeFileMetadataAsync(file);
  }

  async computeMetadataAsync(buffer: ArrayBuffer): Promise<CachedMetadata> {
    return this.queueMetadataWork(() => this.work(buffer));
  }

  isCacheClean(): boolean {
    return this.inProgressTaskCount === 0 && this.linkResolverQueue.length === 0 && !this.linkResolverRunning;
  }

  onCleanCache(callback: () => void): void {
    if (this.isCacheClean()) {
      callback();
      return;
    }
    this.onCleanCacheCallbacks.push(callback);
  }

  async computeFileMetadataAsync(file: TFile): Promise<CachedMetadata> {
    if (!(file instanceof TFile)) return {};
    this.addUniqueFile(file);
    const stat = await this.getVaultFileStat(file);
    if (file.extension !== "md") {
      this.saveFileCache(file.path, { mtime: stat?.mtime ?? Date.now(), size: stat?.size ?? 0, hash: "" });
      return {};
    }
    const cachedInfo = this.fileCache.get(file.path);
    const cachedMetadata = cachedInfo ? this.metadataCache.get(cachedInfo.hash) : null;
    if (cachedInfo && cachedMetadata && stat && cachedInfo.mtime === stat.mtime && cachedInfo.size === stat.size) {
      this.queueFileForLinkResolution(file);
      return cachedMetadata;
    }
    if (!cachedInfo) this.saveFileCache(file.path, { mtime: 0, size: 0, hash: "" });
    this.inProgressTaskCount += 1;
    return this.queueMetadataWork(() => this.computeMarkdownFileMetadata(file));
  }

  async preload(): Promise<void> {
    if (this.initialized) return;
    this.preloadPromise ??= this.preloadFromPersistentCache();
    await this.preloadPromise;
  }

  async initialize(): Promise<void> {
    await this.preload();
    this.preloadPromise = null;
    const tasks: Array<Promise<CachedMetadata>> = [];
    for (const file of this.vault.getAllLoadedFiles()) {
      if (!(file instanceof TFile)) continue;
      this.addUniqueFile(file);
      if (await this.canReuseFileCache(file)) this.queueFileForLinkResolution(file);
      else tasks.push(this.computeFileMetadataAsync(file));
    }
    this.initialized = true;
    this.watchVaultChanges();
    this.trigger("finished");
    this.scheduleCleanupDeletedCache();
    void Promise.all(tasks).catch((error) => console.error(error));
  }

  showIndexingNotice(): void {
    if (this.indexingNoticeTimer) clearTimeout(this.indexingNoticeTimer);
    if (this.indexingCompleteTimer) clearTimeout(this.indexingCompleteTimer);
    this.indexingNotice?.hide();
    this.indexingNotice = null;
    this.indexingNoticeTimer = setTimeout(() => {
      this.indexingNoticeTimer = null;
      if (this.inProgressTaskCount === 0) return;
      const total = this.metadataCache.size + this.inProgressTaskCount;
      if (total === 0) return;
      const notice = new Notice(formatIndexingNotice(total, this.inProgressTaskCount), 0);
      this.indexingNotice = notice;
      const update = () => notice.setMessage(formatIndexingNotice(total, this.inProgressTaskCount));
      const changedRef = this.on("changed", update);
      const finishedRef = this.on("finished", update);
      this.onCleanCache(() => {
        unregisterEventRef(changedRef);
        unregisterEventRef(finishedRef);
        if (this.indexingNotice !== notice) return;
        notice.setMessage("Indexing complete");
        this.indexingCompleteTimer = setTimeout(() => {
          this.indexingCompleteTimer = null;
          if (this.indexingNotice === notice) {
            notice.hide();
            this.indexingNotice = null;
          }
        }, 3000);
      });
    }, 1000);
  }

  async clear(): Promise<void> {
    for (const path of this.getCachedFiles()) this.saveFileCache(path, null);
    for (const hash of [...this.metadataCache.keys()]) this.saveMetaCache(hash, null);
    this.clearResolvedLinks();
    const tasks = this.vault.getAllLoadedFiles()
      .filter((file): file is TFile => file instanceof TFile)
      .map((file) => this.computeFileMetadataAsync(file));
    await Promise.all(tasks);
    this.trigger("finished");
  }

  private parseMetadata(source: string): CachedMetadata {
    const lines = source.split(/\r?\n/);
    const lineOffsets = getLineOffsets(source, lines);
    const blockEntries = parseMarkdownBlocks(source);
    const wikiLinks = collectWikiLinks(lines, lineOffsets);
    const markdownLinks = collectMarkdownLinks(lines, lineOffsets);
    const frontmatterPosition = getFrontmatterPosition(source);
    const frontmatter = this.extractFrontmatter(source);
    const contentReferences = [...wikiLinks, ...markdownLinks].filter((match) => isContentReference(match.position, frontmatterPosition));
    return {
      frontmatter,
      ...(frontmatterPosition ? { frontmatterPosition } : {}),
      frontmatterLinks: collectFrontmatterLinks(frontmatter),
      sections: collectSections(source, lines, lineOffsets, frontmatterPosition),
      blocks: collectBlocks(blockEntries),
      listItems: collectListItems(blockEntries),
      headings: lines.flatMap((line, index) => {
        const match = /^(#{1,6})\s+(.+)$/.exec(line);
        return match ? [{
          heading: match[2],
          level: match[1].length,
          position: {
            line: index,
            start: { line: index, col: 0, offset: lineOffsets[index] ?? 0 },
            end: { line: index, col: line.length, offset: (lineOffsets[index] ?? 0) + line.length },
          },
        }] : [];
      }),
      links: contentReferences
        .filter((match) => !match.embed)
        .map((match) => ({ link: this.normalizeLinkpath(match.link), original: match.original, ...(match.displayText ? { displayText: match.displayText } : {}), position: match.position, source: match.source })),
      embeds: contentReferences
        .filter((match) => match.embed)
        .map((match) => ({ link: this.normalizeLinkpath(match.link), original: match.original, ...(match.displayText ? { displayText: match.displayText } : {}), position: match.position, source: match.source })),
      referenceLinks: collectReferenceLinks(lines, lineOffsets),
      footnotes: collectFootnotes(source),
      footnoteRefs: collectFootnoteRefs(source),
      tags: collectTags(lines, lineOffsets),
    };
  }

  private async computeMarkdownFileMetadata(file: TFile): Promise<CachedMetadata> {
    try {
      const { buffer, text } = await this.readFileBinaryText(file);
      const hash = await sha256Hex(buffer);
      const info = await this.getFileCacheInfo(file, text, hash);
      this.saveFileCache(file.path, info);
      const previous = this.metadataCache.get(hash);
      if (previous) {
        this.queueFileForLinkResolution(file);
        this.trigger("changed", file, text, previous);
        return previous;
      }
      const metadata = await this.workWithSlowIndexingNotice(file, buffer);
      this.saveMetaCache(hash, metadata);
      this.queueFileForLinkResolution(file);
      this.trigger("changed", file, text, metadata);
      return metadata;
    } catch (error) {
      console.error(error);
      return {};
    } finally {
      this.inProgressTaskCount -= 1;
      if (this.inProgressTaskCount === 0) this.didFinish();
    }
  }

  private queueMetadataWork<T>(task: () => Promise<T>): Promise<T> {
    const next = this.workQueue.then(task, task);
    this.workQueue = next;
    void next.catch(() => {});
    return next;
  }

  private async workWithSlowIndexingNotice(file: TFile, buffer: ArrayBuffer): Promise<CachedMetadata> {
    const timer = setTimeout(() => {
      new Notice(`Indexing taking a long time for ${file.path}`);
    }, 10_000);
    (timer as { unref?: () => void }).unref?.();
    try {
      return await this.work(buffer);
    } finally {
      clearTimeout(timer);
    }
  }

  private async work(buffer: ArrayBuffer): Promise<CachedMetadata> {
    if (this.workerResolve) throw new Error("Work queue must be sequential!");
    return new Promise<CachedMetadata>((resolve, reject) => {
      this.workerResolve = resolve;
      this.workerReject = reject;
      queueMicrotask(() => {
        try {
          this.onReceiveMessageFromWorker({ data: this.parseMetadata(new TextDecoder().decode(buffer)) });
        } catch (error) {
          this.workerResolve = null;
          this.workerReject = null;
          reject(error);
        }
      });
    });
  }

  private onReceiveMessageFromWorker(event: { data: CachedMetadata }): void {
    const resolve = this.workerResolve;
    if (!resolve) return;
    this.workerResolve = null;
    this.workerReject = null;
    resolve(event.data);
  }

  private async readFileBinaryText(file: TFile): Promise<{ buffer: ArrayBuffer; text: string }> {
    const buffer = await this.vault.readBinary(file);
    return { buffer, text: new TextDecoder().decode(buffer) };
  }

  private async preloadFromPersistentCache(): Promise<void> {
    if (!this.persistentStore) return;
    try {
      for (const [path, value] of await this.persistentStore.loadFileEntries()) {
        if (isFileCacheInfo(value)) this.fileCache.set(path, value);
      }
      for (const [hash, value] of await this.persistentStore.loadMetadataEntries(300)) {
        if (isCachedMetadata(value)) this.metadataCache.set(hash, inflateMetadata(value));
      }
    } catch (error) {
      console.error("Failed to load cache, unable to open IndexedDB", error);
    }
  }

  private watchVaultChanges(): void {
    if (this.vaultEventRefs.length > 0) return;
    this.vaultEventRefs.push(
      this.vault.on("create", (file: TFile) => this.onCreate(file)),
      this.vault.on("modify", (file: TFile) => this.onModify(file)),
      this.vault.on("delete", (file: TFile) => this.onDelete(file)),
      this.vault.on("rename", (file: TFile, oldPath: string) => this.onRename(file, oldPath)),
      this.vault.on("config-changed", (key: string) => this.onConfigChanged(key)),
    );
  }

  private onCreate(file: TFile): void {
    if (!(file instanceof TFile)) return;
    void this.computeFileMetadataAsync(file);
    this.updateRelatedLinks([file.name]);
  }

  private onModify(file: TFile): void {
    if (file instanceof TFile) void this.computeFileMetadataAsync(file);
  }

  private onDelete(file: TFile): void {
    if (!(file instanceof TFile)) return;
    this.removeUniqueFile(file.name, file);
    const previous = this.getFileCache(file);
    this.trigger("deleted", file, previous);
    this.deletePath(file.path);
  }

  private onRename(file: TFile, oldPath: string): void {
    if (!(file instanceof TFile)) return;
    this.removeUniqueFile(basename(oldPath), file);
    this.addUniqueFile(file);
    const info = this.fileCache.get(oldPath);
    if (info) {
      this.saveFileCache(oldPath, null);
      this.saveFileCache(file.path, info);
    }
    this.migrateResolvedLinks(oldPath, file.path);
    const oldName = basename(oldPath);
    const newName = file.name;
    this.updateRelatedLinks(oldName.toLowerCase() === newName.toLowerCase() ? [oldName] : [oldName, newName]);
    this.queueFileForLinkResolution(null);
  }

  private onConfigChanged(key: string): void {
    if (key === "userIgnoreFilters") this.didFinish();
  }

  private deletePath(path: string): void {
    this.saveFileCache(path, null);
    delete this.resolvedLinks[path];
    delete this.unresolvedLinks[path];
    this.updateRelatedLinks([basename(path)]);
    this.queueFileForLinkResolution(null);
    if (this.inProgressTaskCount === 0) this.didFinish();
  }

  private didFinish(): void {
    if (this.didFinishTimer) clearTimeout(this.didFinishTimer);
    this.didFinishTimer = setTimeout(() => {
      this.didFinishTimer = null;
      this.trigger("finished");
    }, 10);
  }

  private queueFileForLinkResolution(file: TFile | null): void {
    this.linkResolverQueue.push(file);
    this.notifyLinkResolver();
  }

  private notifyLinkResolver(): void {
    if (this.linkResolverRunning || this.linkResolverNotifyTimer) return;
    this.linkResolverNotifyTimer = setTimeout(() => {
      this.linkResolverNotifyTimer = null;
      this.linkResolver();
    }, 0);
  }

  private linkResolver(): void {
    if (this.linkResolverRunning) return;
    this.linkResolverRunning = true;
    void this.drainLinkResolverQueue();
  }

  private async drainLinkResolverQueue(): Promise<void> {
    let batchStart = Date.now();
    let processed = 0;
    try {
      while (this.linkResolverQueue.length > 0) {
        const file = this.linkResolverQueue.shift() ?? null;
        if (file) {
          this.resolveLinks(file.path);
          this.trigger("resolve", file);
        }
        processed += 1;
        if (processed % 10 === 0 && Date.now() - batchStart > 5) {
          await delay(100);
          batchStart = Date.now();
        }
      }
    } catch (error) {
      console.error(error);
    } finally {
      this.linkResolverRunning = false;
      this.trigger("resolved");
      if (this.linkResolverQueue.length > 0) this.notifyLinkResolver();
    }
  }

  private checkCleanCache(): void {
    while (this.onCleanCacheCallbacks.length > 0 && this.isCacheClean()) {
      const callback = this.onCleanCacheCallbacks.shift();
      try {
        callback?.();
      } catch (error) {
        console.error(error);
      }
    }
  }

  private resolveLinks(path: string): void {
    const cache = this.getCache(path);
    if (!cache) return;
    const resolved: Record<string, number> = {};
    const unresolved: Record<string, number> = {};
    for (const ref of iterateRefsForCache(cache)) {
      const linkpath = stripSubpath(ref.link);
      const destination = this.getFirstLinkpathDest(linkpath, path);
      const bucket = destination ? resolved : unresolved;
      const key = destination?.path ?? normalizeUnresolvedLinkpath(linkpath);
      bucket[key] = (bucket[key] ?? 0) + 1;
    }
    this.resolvedLinks[path] = resolved;
    this.unresolvedLinks[path] = unresolved;
  }

  private migrateResolvedLinks(oldPath: string, nextPath: string): void {
    if (this.resolvedLinks[oldPath]) {
      this.resolvedLinks[nextPath] = this.resolvedLinks[oldPath];
      delete this.resolvedLinks[oldPath];
    }
    if (this.unresolvedLinks[oldPath]) {
      this.unresolvedLinks[nextPath] = this.unresolvedLinks[oldPath];
      delete this.unresolvedLinks[oldPath];
    }
  }

  private clearResolvedLinks(): void {
    for (const key of Object.keys(this.resolvedLinks)) delete this.resolvedLinks[key];
    for (const key of Object.keys(this.unresolvedLinks)) delete this.unresolvedLinks[key];
  }

  private updateRelatedLinks(names: string[]): void {
    const resolvedNames = names.map((name) => name.toLowerCase());
    const unresolvedNames = resolvedNames.flatMap((name) => name.endsWith(".md") ? [name.slice(0, -3), name] : [name]);
    for (const source of this.getCachedFiles()) {
      const file = this.vault.getFileByPath(source);
      if (!(file instanceof TFile)) continue;
      if (hasRelatedLink(resolvedNames, this.resolvedLinks[source]) || hasRelatedLink(unresolvedNames, this.unresolvedLinks[source])) {
        this.queueFileForLinkResolution(file);
      }
    }
  }

  private saveFileCache(path: string, info: FileCacheInfo | null): void {
    if (info) this.fileCache.set(path, info);
    else this.fileCache.delete(path);
    this.persistentStore?.save("file", path, info);
  }

  private saveMetaCache(hash: string, metadata: CachedMetadata | null): void {
    if (metadata) this.metadataCache.set(hash, metadata);
    else this.metadataCache.delete(hash);
    this.persistentStore?.save("metadata", hash, metadata ? compactMetadata(metadata) : null);
  }

  private cleanupDeletedCache(): void {
    const referenced = new Set([...this.fileCache.values()].map((info) => info.hash).filter(Boolean));
    for (const hash of [...this.metadataCache.keys()]) {
      if (!referenced.has(hash)) this.saveMetaCache(hash, null);
    }
  }

  private scheduleCleanupDeletedCache(): void {
    if (!this.cleanupDeletedCacheInterval) {
      this.cleanupDeletedCacheInterval = setInterval(() => this.cleanupDeletedCache(), 600_000);
      (this.cleanupDeletedCacheInterval as { unref?: () => void }).unref?.();
    }
    if (!this.cleanupDeletedCacheTimeout) {
      this.cleanupDeletedCacheTimeout = setTimeout(() => {
        this.cleanupDeletedCacheTimeout = null;
        this.cleanupDeletedCache();
      }, 60_000);
      (this.cleanupDeletedCacheTimeout as { unref?: () => void }).unref?.();
    }
  }

  private async canReuseFileCache(file: TFile): Promise<boolean> {
    const info = this.fileCache.get(file.path);
    if (!info) return false;
    if (file.extension !== "md") return true;
    if (!this.metadataCache.has(info.hash)) return false;
    const stat = await this.getVaultFileStat(file);
    return Boolean(stat && stat.mtime === info.mtime && stat.size === info.size);
  }

  private async getFileCacheInfo(file: TFile, source: string, hash: string): Promise<FileCacheInfo> {
    const stat = await this.getVaultFileStat(file);
    return {
      mtime: stat?.mtime ?? Date.now(),
      size: stat?.size ?? source.length,
      hash,
    };
  }

  private async getVaultFileStat(file: TFile): Promise<{ mtime: number; size: number } | null> {
    const adapter = this.vault.adapter as { stat?: (path: string) => Promise<{ mtime?: number; size?: number } | null> } | undefined;
    const stat = await adapter?.stat?.(file.path);
    if (stat?.mtime == null || stat.size == null) return null;
    return { mtime: stat.mtime, size: stat.size };
  }

  getFirstLinkpathDest(linkpath: string, _sourcePath: string): TFile | null {
    return this.getLinkpathDest(linkpath, _sourcePath)[0] ?? null;
  }

  getLinkpathDest(linkpath: string, sourcePath: string): TFile[] {
    const link = this.normalizeLinkpath(linkpath);
    if (link === "") {
      const sourceFile = this.vault.getFileByPath(sourcePath);
      return sourceFile?.extension === "md" ? [sourceFile] : [];
    }

    const lowerLink = link.toLowerCase();
    let matchPath = lowerLink;
    let lookupName = basename(lowerLink);
    let candidates = hasExtension(lookupName) ? this.getUniqueFiles(lookupName) : [];
    if (candidates.length === 0) {
      matchPath = `${lowerLink}.md`;
      lookupName = basename(matchPath);
      candidates = this.getUniqueFiles(lookupName);
    }
    if (candidates.length === 0) return [];
    if (lookupName === matchPath && candidates.length === 1) return [...candidates];

    const sourceFolder = dirname(sourcePath).toLowerCase();
    if (lowerLink.startsWith("./") || lowerLink.startsWith("../")) {
      const relativePath = resolveRelativeLinkpath(matchPath, sourcePath)?.toLowerCase();
      const exact = relativePath ? candidates.find((file) => file.path.toLowerCase() === relativePath) : null;
      if (exact) return [exact];
    }

    if (lowerLink.startsWith("/")) {
      const absolutePath = matchPath.slice(1);
      const exact = candidates.find((file) => file.path.toLowerCase() === absolutePath);
      return exact ? [exact] : [];
    }

    const matching = candidates.filter((file) => file.path.toLowerCase().endsWith(matchPath));
    const nearby = matching
      .filter((file) => isInFolder(file.path.toLowerCase(), sourceFolder))
      .sort(comparePathLength);
    const distant = matching
      .filter((file) => !isInFolder(file.path.toLowerCase(), sourceFolder))
      .sort(comparePathLength);
    return [...nearby, ...distant];
  }

  private normalizeLinkpath(linkpath: string): string {
    return linkpath.trim();
  }

  private extractFrontmatter(source: string): Record<string, unknown> | undefined {
    const frontmatter = getFrontmatterValues(source);
    return Object.keys(frontmatter).length > 0 ? frontmatter : undefined;
  }

  private addUniqueFile(file: TFile): void {
    const key = file.name.toLowerCase();
    let bucket = this.uniqueFileLookup.get(key);
    if (!bucket) this.uniqueFileLookup.set(key, (bucket = []));
    if (!bucket.includes(file)) bucket.push(file);
  }

  private removeUniqueFile(name: string, file: TFile): void {
    const key = name.toLowerCase();
    const bucket = this.uniqueFileLookup.get(key);
    if (!bucket) return;
    const index = bucket.indexOf(file);
    if (index !== -1) bucket.splice(index, 1);
    if (bucket.length === 0) this.uniqueFileLookup.delete(key);
  }

  private getUniqueFiles(name: string): TFile[] {
    this.syncUniqueFileLookup();
    return [...this.uniqueFileLookup.get(name.toLowerCase()) ?? []];
  }

  private syncUniqueFileLookup(): void {
    const loaded = this.vault.getAllLoadedFiles().filter((file): file is TFile => file instanceof TFile);
    const loadedSet = new Set(loaded);
    for (const [key, bucket] of [...this.uniqueFileLookup]) {
      const current = bucket.filter((file) => loadedSet.has(file) && file.name.toLowerCase() === key);
      if (current.length > 0) this.uniqueFileLookup.set(key, current);
      else this.uniqueFileLookup.delete(key);
    }
    for (const file of loaded) this.addUniqueFile(file);
  }

  private isSupportedFile(file: TFile): boolean {
    if (this.app?.vault.getConfig<boolean>("showUnsupportedFiles")) return true;
    return this.app?.viewRegistry.isExtensionRegistered(file.extension) ?? true;
  }
}

// Real `$A` tag-validity check: '#' followed by characters that are not
// punctuation or whitespace, and not purely numeric.
const VALID_TAG_RE = /^#[^\u2000-\u206F\u2E00-\u2E7F'!"#$%&()*+,.:;<=>?@^`{|}~\[\]\\\s]+$/;
const NUMERIC_TAG_RE = /^#\d+$/;

function isValidTag(tag: string): boolean {
  return !!tag && VALID_TAG_RE.test(tag) && !NUMERIC_TAG_RE.test(tag);
}

function matchesIgnoreFilter(path: string, filter: string): boolean {
  const value = filter.trim();
  if (!value) return false;
  if (value.length > 2 && value.startsWith("/") && value.endsWith("/")) {
    try {
      return new RegExp(value.slice(1, -1)).test(path);
    } catch {
      return false;
    }
  }

  const normalized = normalizePath(value);
  if (normalized.endsWith("/")) return path.startsWith(normalized);
  if (normalized.includes("*") || normalized.includes("?")) return globToRegExp(normalized).test(path);
  return path === normalized || path.startsWith(`${normalized}/`);
}

function globToRegExp(pattern: string): RegExp {
  let source = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === "*") {
      if (pattern[index + 1] === "*") {
        source += ".*";
        index += 1;
      } else {
        source += "[^/]*";
      }
    } else if (char === "?") {
      source += "[^/]";
    } else {
      source += escapeRegExp(char);
    }
  }
  return new RegExp(`^${source}$`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+/, "");
}

function basename(path: string): string {
  return path.split("/").pop() ?? path;
}

function stripExtension(path: string): string {
  const slash = path.lastIndexOf("/");
  const dot = path.lastIndexOf(".");
  return dot > slash ? path.slice(0, dot) : path;
}

function dirname(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? "" : path.slice(0, index);
}

function isInFolder(path: string, folder: string): boolean {
  return folder === "" || path.startsWith(`${folder}/`);
}

function hasExtension(path: string): boolean {
  return path.includes(".");
}

function comparePathLength(left: TFile, right: TFile): number {
  return left.path.length - right.path.length;
}

function stripSubpath(linkpath: string): string {
  return linkpath.split("#", 1)[0].trim();
}

function normalizeUnresolvedLinkpath(linkpath: string): string {
  const normalized = stripSubpath(linkpath);
  return basename(normalized).toLowerCase().endsWith(".md") ? normalized.slice(0, -3) : normalized;
}

function relativePath(sourcePath: string, targetPath: string): string {
  const sourceParts = sourcePath.includes("/") ? sourcePath.slice(0, sourcePath.lastIndexOf("/")).split("/").filter(Boolean) : [];
  const targetParts = targetPath.split("/").filter(Boolean);
  while (sourceParts.length > 0 && targetParts.length > 0 && sourceParts[0] === targetParts[0]) {
    sourceParts.shift();
    targetParts.shift();
  }
  const prefix = sourceParts.map(() => "..");
  return [...prefix, ...targetParts].join("/") || targetPath;
}

function iterateRefsForCache(cache: CachedMetadata): Array<{ link: string }> {
  return [
    ...cache.frontmatterLinks ?? [],
    ...cache.links ?? [],
    ...cache.embeds ?? [],
  ];
}

function getFrontmatterAliases(frontmatter: Record<string, unknown> | undefined): string[] {
  if (!frontmatter) return [];
  const entry = Object.entries(frontmatter).find(([key]) => /^aliases$/i.test(key));
  if (!entry) return [];
  const value = entry[1];
  const values = typeof value === "string" ? [value] : Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  return values.map((item) => item.trim()).filter(Boolean);
}

function hasRelatedLink(names: string[], links: Record<string, number> | undefined): boolean {
  if (!links) return false;
  return Object.keys(links).some((path) => names.includes(basename(path).toLowerCase()));
}

function formatIndexingNotice(total: number, inProgress: number): string {
  const complete = Math.max(0, Math.min(total, total - inProgress));
  return `Indexing ${complete}/${total}`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hashString(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  if (!globalThis.crypto?.subtle) return hashString(new TextDecoder().decode(buffer));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function isFileCacheInfo(value: unknown): value is FileCacheInfo {
  return Boolean(value && typeof value === "object"
    && typeof (value as FileCacheInfo).mtime === "number"
    && typeof (value as FileCacheInfo).size === "number"
    && typeof (value as FileCacheInfo).hash === "string");
}

function isCachedMetadata(value: unknown): value is CachedMetadata {
  return Boolean(value && typeof value === "object");
}

function compactMetadata(metadata: CachedMetadata): unknown {
  return transformStoredPositions(structuredClone(metadata), "compact");
}

function inflateMetadata(metadata: CachedMetadata): CachedMetadata {
  return upgradeLegacyInlinePositions(transformStoredPositions(structuredClone(metadata), "inflate")) as CachedMetadata;
}

function transformStoredPositions(value: unknown, mode: "compact" | "inflate"): unknown {
  if (Array.isArray(value)) return value.map((item) => transformStoredPositions(item, mode));
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  if (mode === "compact") {
    if ("frontmatterPosition" in record) {
      record.frontmatterPos = positionToTuple(record.frontmatterPosition);
      delete record.frontmatterPosition;
    }
    if ("position" in record) {
      const tuple = positionToTuple(record.position);
      if (tuple) {
        record.pos = tuple;
        delete record.position;
      }
    }
  } else {
    if (Array.isArray(record.frontmatterPos)) {
      record.frontmatterPosition = tupleToPosition(record.frontmatterPos);
      delete record.frontmatterPos;
    }
    if (Array.isArray(record.pos)) {
      record.position = tupleToPosition(record.pos);
      delete record.pos;
    }
  }
  for (const [key, child] of Object.entries(record)) record[key] = transformStoredPositions(child, mode);
  return record;
}

function upgradeLegacyInlinePositions(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(upgradeLegacyInlinePositions);
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  const legacy = record.position;
  if (isLegacyInlinePosition(legacy)) {
    record.source = { line: legacy.line, start: legacy.start, end: legacy.end, text: legacy.text };
    record.position = {
      start: { line: legacy.line, col: legacy.start, offset: 0 },
      end: { line: legacy.line, col: legacy.end, offset: 0 },
    };
  }
  for (const [key, child] of Object.entries(record)) record[key] = upgradeLegacyInlinePositions(child);
  return record;
}

function isLegacyInlinePosition(value: unknown): value is SourceMatchPosition {
  return Boolean(value && typeof value === "object"
    && typeof (value as SourceMatchPosition).line === "number"
    && typeof (value as SourceMatchPosition).start === "number"
    && typeof (value as SourceMatchPosition).end === "number"
    && typeof (value as SourceMatchPosition).text === "string");
}

function positionToTuple(position: unknown): number[] | null {
  if (!position || typeof position !== "object") return null;
  const record = position as { start?: { line?: unknown; col?: unknown; offset?: unknown }; end?: { line?: unknown; col?: unknown; offset?: unknown } };
  if (!record.start || !record.end) return null;
  return [
    Number(record.start.line ?? 0),
    Number(record.start.col ?? 0),
    Number(record.start.offset ?? 0),
    Number(record.end.line ?? 0),
    Number(record.end.col ?? 0),
    Number(record.end.offset ?? 0),
  ];
}

function tupleToPosition(tuple: unknown[]): { start: { line: number; col: number; offset: number }; end: { line: number; col: number; offset: number } } {
  return {
    start: { line: Number(tuple[0] ?? 0), col: Number(tuple[1] ?? 0), offset: Number(tuple[2] ?? 0) },
    end: { line: Number(tuple[3] ?? 0), col: Number(tuple[4] ?? 0), offset: Number(tuple[5] ?? 0) },
  };
}

function inferFrontmatterWidget(value: unknown): PropertyType {
  if (typeof value === "string") {
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return "datetime";
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return "date";
    return "text";
  }
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "checkbox";
  if (Array.isArray(value)) return "multitext";
  return "unknown";
}

function resolveRelativeLinkpath(linkpath: string, sourcePath: string): string | null {
  if (!sourcePath || !linkpath || linkpath.startsWith("/")) return null;
  if (!linkpath.includes("/") && !linkpath.startsWith(".")) return null;
  const sourceFolder = sourcePath.includes("/") ? sourcePath.slice(0, sourcePath.lastIndexOf("/")) : "";
  const parts = [...sourceFolder.split("/").filter(Boolean), ...linkpath.split("/").filter(Boolean)];
  const normalized: string[] = [];
  for (const part of parts) {
    if (part === ".") continue;
    if (part === "..") normalized.pop();
    else normalized.push(part);
  }
  return normalized.join("/");
}

function collectTags(lines: string[], lineOffsets: number[]): Array<{ tag: string; position: SourceRangePosition; source: SourceMatchPosition }> {
  const tags: Array<{ tag: string; position: SourceRangePosition; source: SourceMatchPosition }> = [];
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

function collectWikiLinks(lines: string[], lineOffsets: number[]): Array<{
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
  source: string,
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
    } else if (sectionType === "heading" || sectionType === "thematicBreak" || sectionType === "html") {
      index += 1;
    } else if (sectionType === "list") {
      index = collectUntilBlankOrRootBlock(lines, index + 1, (nextLine) => getSectionType(nextLine) === "list");
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

function collectUntilBlankOrRootBlock(lines: string[], index: number, sameBlock: (line: string) => boolean): number {
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
  return type === "heading"
    || type === "code"
    || type === "thematicBreak"
    || type === "html"
    || type === "blockquote"
    || type === "callout"
    || type === "list";
}

function findSectionBlockId(lines: string[], start: number, end: number): string | null {
  for (let index = start; index <= end; index += 1) {
    const match = /\s\^([A-Za-z0-9-]+)\s*$/.exec(lines[index]);
    if (match) return match[1];
  }
  return null;
}

function lineRangeToPosition(lines: string[], lineOffsets: number[], start: number, end: number): SourceRangePosition {
  const startOffset = lineOffsets[start] ?? 0;
  const endOffset = (lineOffsets[end] ?? startOffset) + (lines[end]?.length ?? 0);
  return {
    start: { line: start, col: 0, offset: startOffset },
    end: { line: end, col: lines[end]?.length ?? 0, offset: endOffset },
  };
}

function collectMarkdownLinks(lines: string[], lineOffsets: number[]): Array<{
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

function collectReferenceLinks(lines: string[], lineOffsets: number[]): Array<{
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

function collectFrontmatterLinks(frontmatter: Record<string, unknown> | undefined): Array<{ key: string; link: string; original: string; displayText?: string }> | undefined {
  if (!frontmatter) return undefined;
  const links: Array<{ key: string; link: string; original: string; displayText?: string }> = [];
  for (const [key, value] of Object.entries(frontmatter)) collectFrontmatterLinksFromValue(key, value, links);
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

function inlineRangeToPosition(lineOffsets: number[], line: number, start: number, end: number): SourceRangePosition {
  const lineOffset = lineOffsets[line] ?? 0;
  return {
    start: { line, col: start, offset: lineOffset + start },
    end: { line, col: end, offset: lineOffset + end },
  };
}

function isContentReference(position: SourceRangePosition, frontmatterPosition: SourceRangePosition | null): boolean {
  return !frontmatterPosition || position.start.offset >= frontmatterPosition.end.offset;
}

function collectFootnotes(source: string): Array<{ id: string; position: SourceRangePosition }> {
  const footnotes: Array<{ id: string; position: SourceRangePosition }> = [];
  for (const match of source.matchAll(/(^|\n)([ \t]{0,3}\[\^([^\]\s]+)\]:[^\n]*(?:\n[ \t]+[^\n]*)*)/g)) {
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
