import type { App } from "../app/App";
import type { SourceMatchPosition } from "./MetadataCache";

export interface TagOccurrence {
  tag: string;
  path: string;
  position?: SourceMatchPosition;
}

export class TagIndex {
  constructor(readonly app: App) {}

  getTags(): string[] {
    const tags = new Set<string>();
    for (const [, cache] of this.app.metadataCache.entries()) {
      for (const tag of cache.tags ?? []) tags.add(tag.tag);
    }
    return [...tags].sort();
  }

  getFilesWithTag(tag: string): TagOccurrence[] {
    const out: TagOccurrence[] = [];
    for (const [path, cache] of this.app.metadataCache.entries()) {
      for (const item of cache.tags ?? []) {
        if (item.tag === tag) out.push({ tag, path, position: item.source });
      }
    }
    return out;
  }

  getTagCounts(): Array<{ tag: string; count: number }> {
    return this.getTags().map((tag) => ({ tag, count: this.getFilesWithTag(tag).length }));
  }
}
