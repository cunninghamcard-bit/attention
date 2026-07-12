import { describe, expect, it } from "vitest";
import { WebViewerAddressSuggest } from "@web/builtin/webviewer/WebViewerAddressSuggest";
import type { App } from "@web/app/App";

function makeSuggest(history: Array<{ url: string; title: string }> = []) {
  const app = {
    webViewer: {
      listHistory: () => history,
      normalizeUrl: (input: string) => /^[a-z]+:/i.test(input) ? input : `https://duckduckgo.com/?q=${encodeURIComponent(input)}`,
    },
    internalPlugins: { getEnabledPluginById: () => null },
  } as unknown as App;
  return new WebViewerAddressSuggest(app);
}

describe("WebViewerAddressSuggest (real composition)", () => {
  it("empty query lists the Blank seed followed by history", () => {
    const suggest = makeSuggest([
      { url: "https://a.example/", title: "A" },
      { url: "https://b.example/", title: "B" },
    ]);
    const results = suggest.getSuggestions("");
    expect(results[0]).toMatchObject({ type: "about", url: "about:blank", title: "Blank" });
    expect(results.slice(1).map((s) => s.url)).toEqual(["https://a.example/", "https://b.example/"]);
  });

  it("dedupes history by URL", () => {
    const suggest = makeSuggest([
      { url: "https://a.example/", title: "First visit" },
      { url: "https://a.example/", title: "Second visit" },
    ]);
    const results = suggest.getSuggestions("");
    expect(results.filter((s) => s.url === "https://a.example/")).toHaveLength(1);
  });

  it("prepends a typed https:// entry for domain-shaped input", () => {
    const results = makeSuggest().getSuggestions("example.com");
    expect(results[0]).toMatchObject({ type: "typed", url: "https://example.com", title: "" });
  });

  it("prepends the input as-is when it already has a scheme", () => {
    const results = makeSuggest().getSuggestions("http://example.com/x");
    expect(results[0]).toMatchObject({ type: "typed", url: "http://example.com/x" });
  });

  it("prepends a web search for plain words", () => {
    const results = makeSuggest().getSuggestions("clash config");
    expect(results[0].type).toBe("search");
    expect(results[0].url).toContain("duckduckgo.com/?q=");
  });

  it("suppresses the typed entry when the query exactly matches a known URL", () => {
    const suggest = makeSuggest([{ url: "https://a.example/", title: "A" }]);
    const results = suggest.getSuggestions("https://a.example/");
    expect(results.filter((s) => s.type === "typed")).toHaveLength(0);
    expect(results[0]).toMatchObject({ type: "history", url: "https://a.example/" });
  });
});
