import { describe, expect, it, vi } from "vitest";
import { App } from "../app/App";
import { WebViewerView } from "./WebViewerPlugin";
import type { WebViewerElementAdapter } from "../webviewer/WebViewerElementAdapter";

// Structural parity contract with real Obsidian's webviewer (decode-obsidian
// ref): the address bar replaces the header title, webviewer-content lives on
// view-content itself, and the guest element mounts exactly once.

async function createWebViewer(url = "https://example.com/") {
  const app = new App(document.createElement("div"));
  await app.ready;
  await app.internalPlugins.enable("webviewer");
  const leaf = app.workspace.getLeaf("tab");
  await leaf.setViewState({ type: "webviewer", state: { url }, active: true });
  const view = leaf.view as WebViewerView;
  const adapter = (view as unknown as { adapter: WebViewerElementAdapter }).adapter;
  return { app, leaf, view, adapter };
}

describe("WebViewerView structural parity", () => {
  it("mounts the address bar inside the header title container, not the content", async () => {
    const { view } = await createWebViewer();
    expect(view.headerEl.classList.contains("view-header-always-show")).toBe(true);
    // Reload button sits in the header before the title container.
    const reloadEl = view.headerEl.querySelector(".view-header-reload-button");
    expect(reloadEl).not.toBeNull();
    expect(reloadEl!.compareDocumentPosition(view.titleContainerEl) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The title container IS the address container; the title text is gone.
    expect(view.titleContainerEl.classList.contains("webviewer-address-container")).toBe(true);
    expect(view.titleContainerEl.querySelector(".webviewer-address > input")).not.toBeNull();
    expect(view.titleEl.isConnected).toBe(false);
    // No second toolbar row inside the content.
    expect(view.contentEl.querySelector(".webviewer-address")).toBeNull();
  });

  it("puts webviewer-content on view-content itself with the guest as a direct child", async () => {
    const { view, adapter } = await createWebViewer();
    expect(view.contentEl.classList.contains("webviewer-content")).toBe(true);
    expect(view.contentEl.querySelector(".webviewer-container")).toBeNull();
    expect(adapter.element.parentElement).toBe(view.contentEl);
    // iframe fallback sizes itself inline (real CSS only styles `webview`).
    expect(adapter.element.style.width).toBe("100%");
  });

  it("never re-attaches the guest element across reader/zoom toggles", async () => {
    const { view, adapter } = await createWebViewer();
    const element = adapter.element;
    view.toggleReaderMode();
    expect(adapter.element).toBe(element);
    // Still mounted in the view (the test harness app root itself is detached,
    // so document-level isConnected is meaningless here).
    expect(element.parentElement).toBe(view.contentEl);
    expect(element.style.display).toBe("none");
    view.zoomIn();
    view.toggleReaderMode();
    expect(adapter.element).toBe(element);
    expect(element.parentElement).toBe(view.contentEl);
    expect(element.style.display).toBe("");
  });

  it("syncs url, address input, tab title, and leaf history on guest-committed navigation", async () => {
    const { view, leaf, adapter } = await createWebViewer("https://example.com/");
    const record = vi.spyOn(leaf, "recordHistory");
    adapter.webContents.emit("did-navigate", { url: "https://example.com/next", isMainFrame: true });
    expect(view.url).toBe("https://example.com/next");
    const input = view.titleContainerEl.querySelector<HTMLInputElement>(".webviewer-address input");
    expect(input!.value).toBe("https://example.com/next");
    expect(record).toHaveBeenCalledTimes(1);
    const pushed = record.mock.calls[0][0];
    expect((pushed.state.state as { url?: string }).url).toBe("https://example.com/");
    // Subframe commits must not touch the view.
    adapter.webContents.emit("did-navigate", { url: "https://ads.example.com/", isMainFrame: false });
    expect(view.url).toBe("https://example.com/next");
  });

  it("shows the favicon in the tab header with a container the real CSS knows", async () => {
    const { view, leaf, adapter } = await createWebViewer();
    adapter.webContents.emit("page-favicon-updated", { favicons: ["https://example.com/icon-32.png"] });
    const container = leaf.tabHeaderInnerIconEl.querySelector(".webviewer-favicon-container");
    expect(container).not.toBeNull();
    expect(container!.querySelector("img")?.getAttribute("src")).toBe("https://example.com/icon-32.png");
    expect(view.url).toBe("https://example.com/");
  });

  it("zooms relative to the live factor and never persists zoom in view state", async () => {
    const { view, adapter } = await createWebViewer();
    // Fresh view: no forced setZoom — Chromium's per-origin memory rules.
    expect(adapter.getZoomFactor()).toBe(1);
    view.zoomIn();
    view.zoomIn();
    expect(adapter.getZoomFactor()).toBeCloseTo(1.2);
    view.zoomReset();
    expect(adapter.getZoomFactor()).toBe(1);
    // 30 zoomOuts must clamp at the real floor 0.5.
    for (let i = 0; i < 30; i++) view.zoomOut();
    expect(adapter.getZoomFactor()).toBeCloseTo(0.5);
    expect(view.getState()).not.toHaveProperty("zoom");
  });

  it("reader mode extracts real content via readability and renders markdown", async () => {
    const { app, view } = await createWebViewer("https://example.com/article");
    vi.spyOn(app.webViewer.reader, "extractFromPage").mockResolvedValue({
      title: "Extracted title",
      siteName: "example.com",
      markdown: "# Extracted title\n\nParagraph **bold** text.",
    });
    view.toggleReaderMode();
    await view.readerRender;
    const readerEl = view.contentEl.querySelector<HTMLElement>(".reader-mode-content")!;
    expect(readerEl.hidden).toBe(false);
    expect(readerEl.querySelector("h1")?.textContent).toBe("Extracted title");
    expect(readerEl.textContent).toContain("Paragraph");
    // Navigation is per-page: leaving the page exits reader mode.
    view.navigate("https://example.com/other");
    expect(view.readerMode).toBe(false);
    expect(readerEl.hidden).toBe(true);
  });

  it("falls back to web view with a notice when extraction fails", async () => {
    const { app, view, adapter } = await createWebViewer("https://example.com/broken");
    vi.spyOn(app.webViewer.reader, "extractFromPage").mockRejectedValue(new Error("No readable content found on this page"));
    view.toggleReaderMode();
    await view.readerRender;
    expect(view.readerMode).toBe(false);
    expect(adapter.element.style.display).toBe("");
  });

  it("surfaces load failures via the error notice, except ERR_ABORTED", async () => {
    const { view, adapter } = await createWebViewer();
    const errorEl = view.contentEl.querySelector<HTMLElement>(".error-notice")!;
    expect(errorEl.hidden).toBe(true);
    adapter.webContents.emit("did-fail-load", { errorCode: -105, isMainFrame: true });
    expect(errorEl.hidden).toBe(false);
    adapter.webContents.emit("did-start-navigation", { url: "https://example.com/retry" });
    expect(errorEl.hidden).toBe(true);
    adapter.webContents.emit("did-fail-load", { errorCode: -3, isMainFrame: true });
    expect(errorEl.hidden).toBe(true);
  });
});
