/**
 * Input: ./MetadataCache, ./FrontmatterTags
 * Output: TagOccurrence, TagIndex
 * Pos: Application code
 *
 * 🔄 Self-reference: When this file changes, update this header
 */

import type { CachedMetadata, MetadataHost, SourceMatchPosition } from "./MetadataCache";
import { getAllTags } from "./FrontmatterTags";

export interface TagOccurrence {
  tag: string;
  path: string;
  /** Inline tags carry their source position; frontmatter tags do not. */
  position?: SourceMatchPosition;
}

export class TagIndex {
  constructor(readonly app: MetadataHost) {}

  getTags(): string[] {
    const tags = new Set<string>();
    for (const [, cache] of this.markdownCaches()) {
      for (const tag of getAllTags(cache) ?? []) tags.add(tag);
    }
    return [...tags].sort();
  }

  getFilesWithTag(tag: string): TagOccurrence[] {
    const out: TagOccurrence[] = [];
    for (const [path, cache] of this.markdownCaches()) {
      for (const item of cache.tags ?? []) {
        if (item.tag === tag) out.push({ tag, path, position: item.source });
      }
      for (const frontmatterTag of frontmatterOnlyTags(cache)) {
        if (frontmatterTag === tag) out.push({ tag, path });
      }
    }
    return out;
  }

  getTagCounts(): Array<{ tag: string; count: number }> {
    // One pass over the caches, not one pass PER TAG: the tag pane calls this
    // on metadata changes, and the per-tag variant multiplied a full sweep by
    // the tag count — minutes of main-thread time during a 148k-file vault's
    // initial indexing.
    const counts = new Map<string, number>();
    for (const [, cache] of this.markdownCaches()) {
      for (const tag of getAllTags(cache) ?? []) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
    return [...counts.keys()].sort().map((tag) => ({ tag, count: counts.get(tag) ?? 0 }));
  }

  /**
   * Only markdown files can carry tags, and getCache manufactures a fresh
   * `{}` for every non-md path — sweeping all 148k files of a code vault per
   * query was mostly garbage-collector food.
   */
  private *markdownCaches(): Generator<[string, CachedMetadata]> {
    const metadataCache = this.app.metadataCache;
    for (const path of metadataCache.getCachedFiles()) {
      if (!path.endsWith(".md")) continue;
      const cache = metadataCache.getCache(path);
      if (cache) yield [path, cache];
    }
  }
}

function frontmatterOnlyTags(cache: Parameters<typeof getAllTags>[0]): string[] {
  const inline = new Set((cache?.tags ?? []).map((entry) => entry.tag));
  return (getAllTags(cache) ?? []).filter((tag) => !inline.has(tag));
}
