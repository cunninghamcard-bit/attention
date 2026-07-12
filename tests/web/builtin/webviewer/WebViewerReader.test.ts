import { describe, expect, it, vi } from "vitest";
import { WebViewerReader } from "@web/builtin/webviewer/WebViewerReader";

describe("WebViewerReader.extractFromPage", () => {
  it("injects the library, parses, sanitizes, and converts to markdown", async () => {
    const reader = new WebViewerReader();
    reader.loadLibrary = async () => "/* readability source */";
    const calls: string[] = [];
    const host = {
      executeJavaScript: vi.fn(async (code: string) => {
        calls.push(code);
        if (code.includes("Readability")) {
          return {
            title: "An article",
            siteName: "example.com",
            // Script must be sanitized away before conversion.
            content: "<h2>Section</h2><p>Hello <strong>world</strong></p><script>evil()</script>",
          };
        }
        return undefined;
      }),
    };
    const result = await reader.extractFromPage(host, "https://example.com/a");
    expect(calls[0]).toBe("/* readability source */");
    expect(calls[1]).toContain("new Readability(document.cloneNode(true)).parse()");
    expect(result.title).toBe("An article");
    expect(result.markdown).toContain("## Section");
    expect(result.markdown).toContain("**world**");
    expect(result.markdown).not.toContain("evil");
  });

  it("throws a readable error when the page has no article", async () => {
    const reader = new WebViewerReader();
    reader.loadLibrary = async () => "lib";
    const host = { executeJavaScript: vi.fn(async () => null) };
    await expect(reader.extractFromPage(host, "https://example.com")).rejects.toThrow(
      "No readable content",
    );
  });
});
