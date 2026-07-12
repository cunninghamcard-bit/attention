import type { App } from "../../app/App";

export interface WebViewerAddressSuggestion {
  type: "about" | "typed" | "history" | "bookmark" | "search";
  title: string;
  url: string;
  score: number;
}

/**
 * Address bar suggestion composition, mirroring the real webviewer's
 * AddressBarSuggest: a URL-deduped candidate map seeded with the Blank page,
 * filled from history then bookmarks; fuzzy-filtered by the query; and when
 * nothing matches the input exactly, a typed-URL or web-search entry is
 * prepended (http(s):// as-is, "domain.tld" gets https://, anything else
 * becomes a search-engine query).
 */
export class WebViewerAddressSuggest {
  constructor(readonly app: App) {}

  getSuggestions(input: string): WebViewerAddressSuggestion[] {
    const raw = input.trim();
    const query = raw.toLowerCase();
    const candidates = new Map<string, { url: string; title: string; type: WebViewerAddressSuggestion["type"] }>();
    candidates.set("about:blank", { url: "about:blank", title: "Blank", type: "about" });
    for (const entry of this.app.webViewer.listHistory()) {
      if (!candidates.has(entry.url)) candidates.set(entry.url, { url: entry.url, title: entry.title, type: "history" });
    }
    for (const bookmark of this.getUrlBookmarks()) {
      candidates.set(bookmark.url, { url: bookmark.url, title: bookmark.title, type: "bookmark" });
    }

    const suggestions: WebViewerAddressSuggestion[] = [];
    let exactMatch = false;
    for (const candidate of candidates.values()) {
      if (!query) {
        suggestions.push({ ...candidate, score: 0 });
        continue;
      }
      if (candidate.url.toLowerCase() === query) exactMatch = true;
      const score = fuzzyScore(query, `${candidate.title} ${candidate.url}`);
      if (score > 0) suggestions.push({ ...candidate, score });
    }
    suggestions.sort((a, b) => b.score - a.score);

    if (query && !exactMatch) {
      if (/^https?:\/\//i.test(raw)) {
        suggestions.unshift({ title: "", url: raw, type: "typed", score: 100 });
      } else {
        const firstSegment = /([^/?#]+)/.exec(raw)?.[0] ?? "";
        const dot = firstSegment.lastIndexOf(".");
        if (dot !== -1 && dot !== firstSegment.length - 1) {
          suggestions.unshift({ title: "", url: `https://${raw}`, type: "typed", score: 100 });
        } else {
          suggestions.unshift({ title: raw, url: this.app.webViewer.normalizeUrl(raw), type: "search", score: 100 });
        }
      }
    }
    return suggestions.slice(0, 20);
  }

  private getUrlBookmarks(): Array<{ title: string; url: string }> {
    // Real: internalPlugins.getEnabledPluginById("bookmarks").getBookmarks()
    // filtered to type === "url".
    const plugin = (this.app.internalPlugins as unknown as {
      getEnabledPluginById?: (id: string) => { getBookmarks?: () => Array<{ type?: string; title?: string; url?: string }> } | null;
    }).getEnabledPluginById?.("bookmarks");
    const fromPlugin = plugin?.getBookmarks?.()
      ?.filter((item) => item.type === "url" && item.url)
      .map((item) => ({ title: item.title ?? item.url as string, url: item.url as string })) ?? [];
    if (fromPlugin.length > 0) return fromPlugin;
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
