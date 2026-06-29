import type { App } from "../app/App";
import type { SourceMatchPosition } from "./MetadataCache";

export interface LinkGraphEdge {
  from: string;
  to: string;
  original: string;
  resolved: boolean;
  position?: SourceMatchPosition;
}

export class LinkGraph {
  constructor(readonly app: App) {}

  getOutgoingLinks(path: string): LinkGraphEdge[] {
    const file = this.app.vault.getFileByPath(path);
    const cache = this.app.metadataCache.getFileCache(file);
    return (cache?.links ?? []).map((link) => {
      const dest = this.app.metadataCache.getFirstLinkpathDest(link.link, path);
      return {
        from: path,
        to: dest?.path ?? link.link,
        original: link.original,
        resolved: Boolean(dest),
        position: link.source,
      };
    });
  }

  getBacklinks(path: string): LinkGraphEdge[] {
    const edges: LinkGraphEdge[] = [];
    for (const [sourcePath, cache] of this.app.metadataCache.entries()) {
      for (const link of cache.links ?? []) {
        const dest = this.app.metadataCache.getFirstLinkpathDest(link.link, sourcePath);
        if ((dest?.path ?? link.link) === path) {
          edges.push({ from: sourcePath, to: path, original: link.original, resolved: Boolean(dest), position: link.source });
        }
      }
    }
    return edges;
  }

  getGraph(): LinkGraphEdge[] {
    return this.app.vault.getMarkdownFiles().flatMap((file) => this.getOutgoingLinks(file.path));
  }
}
