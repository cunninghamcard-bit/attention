import type { App } from "../app/App";
import type { GraphColorGroupOptions, GraphFilterOptions } from "./GraphOptions";
import { graphColorToCss } from "./GraphOptions";
import { compileGraphSearchQuery } from "./GraphSearchQuery";

export type GraphNodeType = "" | "file" | "tag" | "attachment" | "unresolved";

export interface GraphNode {
  id: string;
  label: string;
  type: GraphNodeType;
  resolved: boolean;
  x: number;
  y: number;
  links: number;
  focused: boolean;
  colorClass: string;
  properties?: Record<string, unknown>;
  color?: string;
}

export interface GraphLink {
  from: string;
  to: string;
  resolved: boolean;
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
  focusedId: string | null;
  hasFilter: boolean;
  weights?: Record<string, number>;
}

interface VaultFileLike {
  path: string;
  basename?: string;
  name?: string;
  extension?: string;
}

interface LinkLike {
  from: string;
  to: string;
  resolved?: boolean;
}

interface CachedMetadataLike {
  frontmatter?: Record<string, unknown>;
  tags?: Array<string | { tag?: string }>;
}

interface MetadataCacheLike {
  getCachedFiles?: () => string[];
  isUserIgnored?: (path: string) => boolean;
  getCacheByPath?: (path: string) => CachedMetadataLike | null;
  getFileCache?: (file: VaultFileLike | null) => CachedMetadataLike | null;
  resolvedLinks?: Record<string, Record<string, unknown>>;
  unresolvedLinks?: Record<string, Record<string, unknown>>;
}

interface VaultLike {
  getMarkdownFiles?: () => VaultFileLike[];
  getAllLoadedFiles?: () => VaultFileLike[];
  getFiles?: () => VaultFileLike[];
  getFileByPath?: (path: string) => VaultFileLike | null;
}

export class GraphDataEngine {
  constructor(private readonly app: App) {}

  collect(filters: GraphFilterOptions, local: boolean, colorGroups: GraphColorGroupOptions[]): GraphData {
    const globalData = this.collectGlobalData(filters);
    const focusedId = local ? filters.localFile ?? this.app.workspace.activeEditor?.file?.path ?? null : null;
    const graphData = local ? this.collectLocalData(globalData, filters, focusedId) : { ...globalData, focusedId };
    return this.finalizeData(this.filterByQuery(graphData, filters.query), filters.query, colorGroups);
  }

  private collectGlobalData(filters: GraphFilterOptions): GraphData {
    const nodeMap = new Map<string, GraphNode>();
    const links: GraphLink[] = [];

    this.collectCachedNodes(nodeMap, filters);
    if (filters.showAttachments) this.collectAttachmentNodes(nodeMap);

    const usedMetadataLinks = this.collectMetadataLinks(nodeMap, links, filters);
    if (!usedMetadataLinks) this.collectFallbackLinks(nodeMap, links, filters);
    if (filters.showTags) this.collectTagNodes(nodeMap, links);

    if (!filters.showOrphans) this.deleteOrphans(nodeMap, links);
    return this.dataFromMap(nodeMap, links, null);
  }

  private collectCachedNodes(nodeMap: Map<string, GraphNode>, filters: GraphFilterOptions): void {
    const metadataCache = this.metadataCache();
    const cachedFiles = metadataCache.getCachedFiles?.() ?? [];
    const markdownFiles = this.vault().getMarkdownFiles?.() ?? [];
    const sourcePaths = new Set(cachedFiles.length > 0 ? [...cachedFiles, ...markdownFiles.map((file) => file.path)] : markdownFiles.map((file) => file.path));

    for (const path of sourcePaths) {
      if (metadataCache.isUserIgnored?.(path)) continue;
      if (!this.shouldIncludeResolvedPath(path, filters)) continue;
      this.ensureResolvedNode(nodeMap, path, filters);
    }
  }

  private collectAttachmentNodes(nodeMap: Map<string, GraphNode>): void {
    for (const file of this.getAllVaultFiles()) {
      if (nodeMap.has(file.path) || this.isMarkdownFile(file)) continue;
      nodeMap.set(file.path, this.createNode(file.path, this.fileLabel(file), "attachment", true));
    }
  }

  private collectMetadataLinks(nodeMap: Map<string, GraphNode>, links: GraphLink[], filters: GraphFilterOptions): boolean {
    const metadataCache = this.metadataCache();
    const resolvedLinks = metadataCache.resolvedLinks;
    const unresolvedLinks = metadataCache.unresolvedLinks;
    if (!resolvedLinks && !unresolvedLinks) return false;

    for (const [from, destinations] of Object.entries(resolvedLinks ?? {})) {
      if (metadataCache.isUserIgnored?.(from)) continue;
      this.ensureResolvedNode(nodeMap, from, filters);
      if (!nodeMap.has(from)) continue;
      for (const to of Object.keys(destinations)) {
        if (!this.shouldIncludeResolvedPath(to, filters)) continue;
        this.ensureResolvedNode(nodeMap, to, filters);
        if (nodeMap.has(to)) this.addLink(links, { from, to, resolved: true });
      }
    }

    if (!filters.hideUnresolved) {
      for (const [from, destinations] of Object.entries(unresolvedLinks ?? {})) {
        if (metadataCache.isUserIgnored?.(from)) continue;
        this.ensureResolvedNode(nodeMap, from, filters);
        if (!nodeMap.has(from)) continue;
        for (const to of Object.keys(destinations)) {
          if (!nodeMap.has(to)) nodeMap.set(to, this.createNode(to, this.pathLabel(to), "unresolved", false));
          this.addLink(links, { from, to, resolved: false });
        }
      }
    }

    return true;
  }

  private collectFallbackLinks(nodeMap: Map<string, GraphNode>, links: GraphLink[], filters: GraphFilterOptions): void {
    const rawLinks = this.app.linkGraph.getGraph() as LinkLike[];

    for (const raw of rawLinks) {
      const resolved = raw.resolved !== false && this.shouldIncludeResolvedPath(raw.to, filters);
      if (!resolved && filters.hideUnresolved) continue;
      this.ensureResolvedNode(nodeMap, raw.from, filters);
      if (!nodeMap.has(raw.from)) continue;
      if (resolved) this.ensureResolvedNode(nodeMap, raw.to, filters);
      else if (!nodeMap.has(raw.to)) nodeMap.set(raw.to, this.createNode(raw.to, this.pathLabel(raw.to), "unresolved", false));
      if (nodeMap.has(raw.to)) this.addLink(links, { from: raw.from, to: raw.to, resolved });
    }
  }

  private collectTagNodes(nodeMap: Map<string, GraphNode>, links: GraphLink[]): void {
    const canonicalTags = this.collectCanonicalTags();
    for (const node of [...nodeMap.values()]) {
      if (node.type === "tag" || node.type === "attachment" || node.type === "unresolved") continue;
      for (const tag of this.getTagsForPath(node.id)) {
        const normalized = this.normalizeTag(tag);
        const id = canonicalTags.get(normalized.toLowerCase()) ?? normalized;
        canonicalTags.set(normalized.toLowerCase(), id);
        if (!nodeMap.has(id)) nodeMap.set(id, this.createNode(id, id, "tag", true));
        this.addLink(links, { from: node.id, to: id, resolved: true });
      }
    }
  }

  private collectLocalData(globalData: GraphData, filters: GraphFilterOptions, focusedId: string | null): GraphData {
    if (!focusedId) return { nodes: [], links: [], focusedId: null, hasFilter: false, weights: {} };

    const nodeMap = new Map(globalData.nodes.map((node) => [node.id, { ...node, focused: false }]));
    if (!nodeMap.has(focusedId)) nodeMap.set(focusedId, this.createNode(focusedId, this.pathLabel(focusedId), "", true));

    const outgoing = this.groupLinks(globalData.links, "from");
    const incoming = this.groupLinks(globalData.links, "to");
    const visibleIds = new Set([focusedId]);
    const localLinkKeys = new Set<string>();
    const weights: Record<string, number> = { [focusedId]: 30 };
    const jumps = Math.max(1, Math.min(5, filters.localJumps));
    let frontier = new Set([focusedId]);

    for (let depth = 0; depth < jumps && frontier.size > 0; depth++) {
      const next = new Set<string>();
      const weight = Math.max(0, 30 - 30 / jumps * (depth + 1));
      for (const id of frontier) {
        const node = nodeMap.get(id);
        if (node?.type === "tag") continue;

        if (filters.localForelinks) {
          for (const link of outgoing.get(id) ?? []) {
            this.includeLocalLink(link, visibleIds, next, weights, weight, localLinkKeys, link.to);
          }
        }

        if (filters.localBacklinks) {
          for (const link of incoming.get(id) ?? []) {
            this.includeLocalLink(link, visibleIds, next, weights, weight, localLinkKeys, link.from);
          }
        }
      }
      frontier = next;
    }

    const links = filters.localInterlinks
      ? globalData.links.filter((link) => visibleIds.has(link.from) && visibleIds.has(link.to))
      : globalData.links.filter((link) => visibleIds.has(link.from) && visibleIds.has(link.to) && localLinkKeys.has(this.linkKey(link)));
    const nodes = [...visibleIds].flatMap((id) => {
      const node = nodeMap.get(id);
      return node ? [{ ...node }] : [];
    });

    return { nodes, links, focusedId, hasFilter: false, weights };
  }

  private includeLocalLink(
    link: GraphLink,
    visibleIds: Set<string>,
    next: Set<string>,
    weights: Record<string, number>,
    weight: number,
    localLinkKeys: Set<string>,
    discoveredId: string,
  ): void {
    localLinkKeys.add(this.linkKey(link));
    if (visibleIds.has(discoveredId)) return;
    visibleIds.add(discoveredId);
    next.add(discoveredId);
    weights[discoveredId] = weight;
  }

  private filterByQuery(data: GraphData, queryText: string): GraphData {
    const query = compileGraphSearchQuery(queryText);
    if (query.isEmpty) return data;
    const nodes = data.nodes.filter((node) => query.matchNode(node));
    const ids = new Set(nodes.map((node) => node.id));
    const weights = data.weights ? Object.fromEntries(Object.entries(data.weights).filter(([id]) => ids.has(id))) : undefined;
    return {
      ...data,
      nodes,
      links: data.links.filter((link) => ids.has(link.from) && ids.has(link.to)),
      weights,
    };
  }

  private finalizeData(data: GraphData, queryText: string, colorGroups: GraphColorGroupOptions[]): GraphData {
    const withMetrics = this.withLinkMetrics(data);
    const nodes = withMetrics.nodes.map((node) => ({ ...node, focused: node.id === withMetrics.focusedId }));
    this.applyColorGroups(nodes, colorGroups);
    return {
      ...withMetrics,
      nodes,
      hasFilter: !compileGraphSearchQuery(queryText).isEmpty,
    };
  }

  private withLinkMetrics(data: GraphData): GraphData {
    const counts = this.countLinks(data.links);
    return {
      ...data,
      nodes: data.nodes.map((node) => ({ ...node, links: Math.round(data.weights?.[node.id] ?? counts.get(node.id) ?? 0) })),
    };
  }

  private dataFromMap(nodeMap: Map<string, GraphNode>, links: GraphLink[], focusedId: string | null): GraphData {
    const ids = new Set(nodeMap.keys());
    return {
      nodes: [...nodeMap.values()].map((node) => ({ ...node })),
      links: links.filter((link) => ids.has(link.from) && ids.has(link.to)),
      focusedId,
      hasFilter: false,
    };
  }

  private deleteOrphans(nodeMap: Map<string, GraphNode>, links: GraphLink[]): void {
    const connected = new Set<string>();
    for (const link of links) {
      if (link.from === link.to || !nodeMap.has(link.from) || !nodeMap.has(link.to)) continue;
      connected.add(link.from);
      connected.add(link.to);
    }
    for (const id of [...nodeMap.keys()]) {
      if (!connected.has(id)) nodeMap.delete(id);
    }
    for (let index = links.length - 1; index >= 0; index--) {
      const link = links[index];
      if (!nodeMap.has(link.from) || !nodeMap.has(link.to)) links.splice(index, 1);
    }
  }

  private groupLinks(links: GraphLink[], key: "from" | "to"): Map<string, GraphLink[]> {
    const groups = new Map<string, GraphLink[]>();
    for (const link of links) {
      const value = link[key];
      const bucket = groups.get(value) ?? [];
      bucket.push(link);
      groups.set(value, bucket);
    }
    return groups;
  }

  private countLinks(links: GraphLink[]): Map<string, number> {
    const counts = new Map<string, number>();
    for (const link of links) {
      counts.set(link.from, (counts.get(link.from) ?? 0) + 1);
      counts.set(link.to, (counts.get(link.to) ?? 0) + 1);
    }
    return counts;
  }

  private addLink(links: GraphLink[], link: GraphLink): void {
    const key = this.linkKey(link);
    if (links.some((item) => this.linkKey(item) === key)) return;
    links.push(link);
  }

  private linkKey(link: GraphLink): string {
    return `${link.from}\u0000${link.to}\u0000${link.resolved ? "1" : "0"}`;
  }

  private applyColorGroups(nodes: GraphNode[], colorGroups: GraphColorGroupOptions[]): void {
    for (const node of nodes) {
      node.colorClass = this.defaultColorClass(node);
      node.color = undefined;
      for (let index = 0; index < colorGroups.length; index++) {
        const group = colorGroups[index];
        const query = compileGraphSearchQuery(group.query);
        if (query.isEmpty) continue;
        if (query.matchNode(node)) {
          node.colorClass = `color-fill-${(index % 6) + 1}`;
          node.color = graphColorToCss(group.color);
          break;
        }
      }
      if (node.focused) node.colorClass = "color-fill-focused";
    }
  }

  private defaultColorClass(node: GraphNode): string {
    if (node.focused) return "color-fill-focused";
    if (node.type === "tag") return "color-fill-tag";
    if (node.type === "attachment") return "color-fill-attachment";
    if (!node.resolved) return "color-fill-unresolved";
    return "color-fill";
  }

  private ensureResolvedNode(nodeMap: Map<string, GraphNode>, path: string, filters: GraphFilterOptions): void {
    if (nodeMap.has(path)) return;
    if (!this.shouldIncludeResolvedPath(path, filters)) return;
    const file = this.getVaultFile(path);
    const type = this.isMarkdownPath(path, file) ? "" : "attachment";
    const node = this.createNode(path, file ? this.fileLabel(file) : this.pathLabel(path), type, true);
    node.properties = this.getFrontmatterForPath(path);
    nodeMap.set(path, node);
  }

  private shouldIncludeResolvedPath(path: string, filters: GraphFilterOptions): boolean {
    return this.isMarkdownPath(path, this.getVaultFile(path)) || filters.showAttachments;
  }

  private createNode(id: string, label: string, type: GraphNodeType, resolved: boolean): GraphNode {
    return { id, label, type, resolved, x: 0, y: 0, links: 0, focused: false, colorClass: "color-fill" };
  }

  private metadataCache(): MetadataCacheLike {
    return this.app.metadataCache as unknown as MetadataCacheLike;
  }

  private vault(): VaultLike {
    return this.app.vault as unknown as VaultLike;
  }

  private getAllVaultFiles(): VaultFileLike[] {
    const vault = this.vault();
    return vault.getAllLoadedFiles?.() ?? vault.getFiles?.() ?? vault.getMarkdownFiles?.() ?? [];
  }

  private getVaultFile(path: string): VaultFileLike | null {
    return this.vault().getFileByPath?.(path) ?? this.getAllVaultFiles().find((file) => file.path === path) ?? null;
  }

  private isMarkdownPath(path: string, file: VaultFileLike | null): boolean {
    return file ? this.isMarkdownFile(file) : path.toLowerCase().endsWith(".md");
  }

  private isMarkdownFile(file: VaultFileLike): boolean {
    return file.extension === "md" || file.path.toLowerCase().endsWith(".md");
  }

  private fileLabel(file: VaultFileLike): string {
    return file.basename ?? file.name?.replace(/\.[^.]+$/, "") ?? this.pathLabel(file.path);
  }

  private pathLabel(path: string): string {
    const name = path.split("/").pop() ?? path;
    return name.replace(/\.[^.]+$/, "");
  }

  private collectCanonicalTags(): Map<string, string> {
    const tagIndex = this.app.tagIndex as unknown as { getTags?: () => string[] };
    const canonicalTags = new Map<string, string>();
    for (const tag of tagIndex.getTags?.() ?? []) {
      const normalized = this.normalizeTag(tag);
      canonicalTags.set(normalized.toLowerCase(), normalized);
    }
    return canonicalTags;
  }

  private normalizeTag(tag: string): string {
    return tag.startsWith("#") ? tag : `#${tag}`;
  }

  private getTagsForPath(path: string): string[] {
    const tags = this.getCacheForPath(path)?.tags ?? [];
    return tags.flatMap((tag) => {
      if (typeof tag === "string") return tag;
      return typeof tag.tag === "string" ? tag.tag : [];
    });
  }

  private getFrontmatterForPath(path: string): Record<string, unknown> {
    return this.getCacheForPath(path)?.frontmatter ?? {};
  }

  private getCacheForPath(path: string): CachedMetadataLike | null {
    const metadataCache = this.metadataCache();
    return metadataCache.getCacheByPath?.(path) ?? metadataCache.getFileCache?.(this.getVaultFile(path)) ?? null;
  }
}
