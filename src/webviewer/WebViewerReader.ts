export interface WebViewerReaderResult {
  title: string;
  siteName?: string;
  markdown: string;
}

export class WebViewerReader {
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
