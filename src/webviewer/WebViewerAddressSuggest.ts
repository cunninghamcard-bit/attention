import type { App } from "../app/App";

export interface WebViewerAddressSuggestion {
  type: "typed" | "history" | "bookmark" | "search" | "blank";
  title: string;
  url: string;
  score: number;
}

export class WebViewerAddressSuggest {
  constructor(readonly app: App) {}

  getSuggestions(input: string): WebViewerAddressSuggestion[] {
    const query = input.trim();
    const suggestions: WebViewerAddressSuggestion[] = [
      { type: "blank", title: "Blank page", url: "about:blank", score: query ? 0 : 100 },
    ];
    if (query) {
      const typed = this.app.webViewer.normalizeUrl(query);
      suggestions.push({
        type: /^(https?|about|file):/i.test(query) || /^[\w.-]+\.[a-z]{2,}/i.test(query) ? "typed" : "search",
        title: query,
        url: typed,
        score: 95,
      });
    }
    for (const entry of this.app.webViewer.listHistory()) {
      const score = fuzzyScore(query, `${entry.title} ${entry.url}`);
      if (!query || score > 0) suggestions.push({ type: "history", title: entry.title, url: entry.url, score });
    }
    for (const bookmark of this.getUrlBookmarks()) {
      const score = fuzzyScore(query, `${bookmark.title} ${bookmark.url}`);
      if (!query || score > 0) suggestions.push({ type: "bookmark", title: bookmark.title, url: bookmark.url, score });
    }
    return suggestions
      .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
      .slice(0, 12);
  }

  private getUrlBookmarks(): Array<{ title: string; url: string }> {
    const bookmarks = (this.app as unknown as { bookmarks?: { listBookmarks?: () => Array<{ title?: string; url?: string }> } }).bookmarks;
    return bookmarks?.listBookmarks?.()
      ?.filter((item) => item.url && /^https?:/i.test(item.url))
      .map((item) => ({ title: item.title ?? item.url as string, url: item.url as string })) ?? [];
  }
}

function fuzzyScore(query: string, text: string): number {
  if (!query) return 50;
  const haystack = text.toLowerCase();
  const needle = query.toLowerCase();
  if (haystack.includes(needle)) return 80 + Math.min(needle.length, 20);
  let index = 0;
  let score = 0;
  for (const char of needle) {
    const found = haystack.indexOf(char, index);
    if (found === -1) return 0;
    score += Math.max(1, 12 - (found - index));
    index = found + 1;
  }
  return score;
}
