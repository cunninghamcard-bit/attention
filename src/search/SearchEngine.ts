import type { App } from "../app/App";

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

export class SearchEngine {
  constructor(readonly app: App) {}

  async search(query: SearchQuery): Promise<VaultSearchResult[]> {
    const rawQuery = query.query.trim();
    if (!rawQuery) return [];

    const needle = query.caseSensitive ? rawQuery : rawQuery.toLowerCase();
    const results: VaultSearchResult[] = [];

    for (const file of this.app.vault.getMarkdownFiles()) {
      if (query.pathPrefix && !file.path.startsWith(query.pathPrefix)) continue;
      const source = await this.app.vault.read(file);
      const matches: SearchMatch[] = [];
      source.split(/\r?\n/).forEach((line, index) => {
        const haystack = query.caseSensitive ? line : line.toLowerCase();
        let cursor = 0;
        while (cursor <= haystack.length) {
          const start = haystack.indexOf(needle, cursor);
          if (start === -1) break;
          matches.push({ line: index, text: line, start, end: start + needle.length });
          cursor = Math.max(start + needle.length, start + 1);
        }
      });
      if (matches.length) results.push({ path: file.path, matches });
    }

    results.sort((a, b) => a.path.localeCompare(b.path, undefined, { sensitivity: "base", numeric: true }));
    this.app.workspace.trigger("search-complete", query, results);
    return results;
  }
}
