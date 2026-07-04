import type { App } from "../app/App";
import type { SourceMatchPosition } from "./MetadataCache";
import { getAllTags } from "../api/ApiUtils";

export interface TagOccurrence {
  tag: string;
  path: string;
  /** Inline tags carry their source position; frontmatter tags do not. */
  position?: SourceMatchPosition;
}

export class TagIndex {
  constructor(readonly app: App) {}

  getTags(): string[] {
    const tags = new Set<string>();
    for (const [, cache] of this.app.metadataCache.entries()) {
      for (const tag of getAllTags(cache) ?? []) tags.add(tag);
    }
    return [...tags].sort();
  }

  getFilesWithTag(tag: string): TagOccurrence[] {
    const out: TagOccurrence[] = [];
    for (const [path, cache] of this.app.metadataCache.entries()) {
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
    return this.getTags().map((tag) => ({ tag, count: this.getFilesWithTag(tag).length }));
  }
}

function frontmatterOnlyTags(cache: Parameters<typeof getAllTags>[0]): string[] {
  const inline = new Set((cache?.tags ?? []).map((entry) => entry.tag));
  return (getAllTags(cache) ?? []).filter((tag) => !inline.has(tag));
}
