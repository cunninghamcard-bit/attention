import { htmlToMarkdown } from "../markdown/HtmlToMarkdown";
import { sanitizeHTMLToDom } from "../api/ApiUtils";

export interface WebViewerReaderResult {
  title: string;
  siteName?: string;
  markdown: string;
}

/** The slice of the adapter reader extraction needs (injectable for tests). */
export interface ReaderHost {
  executeJavaScript(code: string): Promise<unknown>;
}

interface ReadabilityArticle {
  title?: unknown;
  siteName?: unknown;
  content?: unknown;
}

/**
 * Real Obsidian's reader pipeline (decode ref, getReaderModeContent):
 * fetch the bundled /lib/readability.js, inject it into the guest, run
 * `new Readability(document.cloneNode(true)).parse()`, sanitize the article
 * HTML, and convert to markdown for the preview renderer.
 */
export class WebViewerReader {
  /** Injectable for tests; production fetches the vendored Apache-2.0 file. */
  loadLibrary: () => Promise<string> = async () => {
    const response = await fetch("/lib/readability.js");
    if (!response.ok) throw new Error("Could not load the reader library");
    return response.text();
  };

  async extractFromPage(host: ReaderHost, url: string): Promise<WebViewerReaderResult> {
    const library = await this.loadLibrary();
    await host.executeJavaScript(library);
    const article = await host.executeJavaScript("new Readability(document.cloneNode(true)).parse()") as ReadabilityArticle | null;
    if (!article || typeof article.content !== "string") throw new Error("No readable content found on this page");
    const title = typeof article.title === "string" && article.title.trim()
      ? article.title
      : typeof article.siteName === "string" && article.siteName.trim() ? article.siteName : "Untitled";
    // Sanitize before conversion, like the real pipeline — the article HTML
    // comes from an arbitrary page.
    const fragment = sanitizeHTMLToDom(article.content);
    const holder = document.createElement("div");
    holder.appendChild(fragment);
    return {
      title,
      siteName: typeof article.siteName === "string" ? article.siteName : siteNameFromUrl(url),
      markdown: htmlToMarkdown(holder.innerHTML),
    };
  }

  /** Fallback snapshot when live extraction is unavailable (e.g. no page). */
  extract(url: string, title: string, fallbackText = ""): WebViewerReaderResult {
    const safeTitle = title || titleFromUrl(url);
    const markdown = [
      `# ${safeTitle}`,
      "",
      `Source: ${url}`,
      "",
      fallbackText.trim() || `Reader snapshot for ${url}.`,
      "",
    ].join("\n");
    return {
      title: safeTitle,
      siteName: siteNameFromUrl(url),
      markdown,
    };
  }
}

function titleFromUrl(url: string): string {
  try {
    return new URL(url).hostname || url;
  } catch {
    return url;
  }
}

function siteNameFromUrl(url: string): string | undefined {
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}
