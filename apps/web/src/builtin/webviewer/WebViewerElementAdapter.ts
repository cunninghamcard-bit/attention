import { WebContentsBridge } from "./WebContentsBridge";

export interface WebViewerElementAdapterOptions {
  partition: string;
  allowPopups?: boolean;
}

type WebviewLikeElement = HTMLElement & {
  src?: string;
  partition?: string;
  allowpopups?: boolean | string;
  reload?: () => void;
  stop?: () => void;
  goBack?: () => void;
  goForward?: () => void;
  setZoomFactor?: (zoom: number) => void;
  getZoomFactor?: () => number;
  getWebContentsId?: () => number;
  executeJavaScript?: (code: string) => Promise<unknown>;
};

/** Native webview navigation events carry the real URL; main frame only. */
interface WebviewNavigationEvent {
  url?: string;
  isMainFrame?: boolean;
}

export class WebViewerElementAdapter {
  readonly element: WebviewLikeElement;
  readonly webContents = new WebContentsBridge();
  readonly mode: "webview" | "iframe";
  private currentUrl = "about:blank";
  // Electron <webview> methods (setZoomFactor/reload/goBack/...) throw until
  // the element is attached AND dom-ready has fired; gate them and replay the
  // last requested zoom once ready.
  private ready = false;
  private pendingZoom: number | null = null;
  private iframeZoom = 1;

  constructor(options: WebViewerElementAdapterOptions) {
    const supportsWebview =
      typeof customElements !== "undefined" && Boolean(customElements.get("webview"));
    this.mode = supportsWebview ? "webview" : "iframe";
    this.element = document.createElement(
      this.mode === "webview" ? "webview" : "iframe",
    ) as WebviewLikeElement;
    this.element.className = this.mode === "webview" ? "webviewer-webview" : "webviewer-frame";
    this.element.partition = options.partition;
    this.element.allowpopups = options.allowPopups ?? true;
    this.element.setAttribute("partition", options.partition);
    if (options.allowPopups ?? true) this.element.setAttribute("allowpopups", "true");
    if (this.mode === "iframe") {
      this.element.setAttribute(
        "sandbox",
        "allow-forms allow-same-origin allow-scripts allow-popups",
      );
      // Real Obsidian's CSS only sizes `webview` (`.webviewer-content webview`);
      // the iframe fallback would render at the UA default 300x150 without
      // inline sizing. Kept inline so the shipped CSS stays byte-identical.
      this.element.style.flex = "1 1 auto";
      this.element.style.width = "100%";
      this.element.style.border = "0";
      this.element.style.backgroundColor = "#fff";
    }
    this.installEvents();
  }

  navigate(url: string, userInitiated = false): void {
    this.currentUrl = url || "about:blank";
    this.webContents.emit(userInitiated ? "did-start-navigation" : "did-redirect-navigation", {
      url: this.currentUrl,
      isMainFrame: true,
    });
    this.element.src = this.currentUrl;
  }

  reload(): void {
    this.webContents.emit("did-start-navigation", {
      url: this.currentUrl,
      reload: true,
      isMainFrame: true,
    });
    if (this.ready && this.element.reload) this.element.reload();
    else this.element.src = this.currentUrl;
  }

  stop(): void {
    if (this.ready && this.element.stop) this.element.stop();
  }

  goBack(): void {
    if (this.ready) this.element.goBack?.();
  }

  goForward(): void {
    if (this.ready) this.element.goForward?.();
  }

  setZoom(zoom: number): void {
    if (this.mode === "webview") {
      // Native zoom only — layering a CSS scale on top double-applies it.
      if (this.ready) this.element.setZoomFactor?.(zoom);
      else this.pendingZoom = zoom;
      return;
    }
    this.iframeZoom = zoom;
    this.element.style.transform = zoom === 1 ? "" : `scale(${zoom})`;
    this.element.style.transformOrigin = "top left";
    this.element.style.width = `${100 / zoom}%`;
    this.element.style.height = `${100 / zoom}%`;
  }

  /**
   * The LIVE zoom factor. Chromium persists zoom per-origin inside the
   * persist: partition, so the webview is the source of truth — zoom is not
   * view state (mirrors real Obsidian's relative zoomIn/zoomOut).
   */
  getZoomFactor(): number {
    if (this.mode === "webview") {
      if (this.ready) return this.element.getZoomFactor?.() ?? 1;
      return this.pendingZoom ?? 1;
    }
    return this.iframeZoom;
  }

  getWebContentsId(): number | null {
    if (!this.ready) return null;
    return this.element.getWebContentsId?.() ?? null;
  }

  /**
   * Run code in the guest page (reader-mode extraction). Webview: native
   * executeJavaScript. Iframe fallback: same-origin eval; cross-origin pages
   * reject — reader mode is a desktop feature there, like real Obsidian.
   */
  async executeJavaScript(code: string): Promise<unknown> {
    if (this.mode === "webview") {
      if (!this.ready || !this.element.executeJavaScript)
        throw new Error("Web viewer is not ready");
      return this.element.executeJavaScript(code);
    }
    const frame = this.element as unknown as HTMLIFrameElement;
    const win = frame.contentWindow as (Window & { eval(code: string): unknown }) | null;
    if (!win) throw new Error("Web viewer frame is not available");
    return win.eval(code);
  }

  destroy(): void {
    this.webContents.destroy();
    this.element.remove();
  }

  private installEvents(): void {
    const markReady = () => {
      this.ready = true;
      if (this.pendingZoom != null) {
        this.element.setZoomFactor?.(this.pendingZoom);
        this.pendingZoom = null;
      }
    };
    if (this.mode === "webview") {
      // A real Electron <webview> emits its lifecycle as element events
      // (dom-ready/did-stop-loading/...), never the iframe "load" event.
      // Navigation events carry the REAL committed URL — track it (main frame
      // only) so guest-initiated navigation can never desync the view.
      const trackUrl = (event: Event): WebviewNavigationEvent => {
        const nav = event as unknown as WebviewNavigationEvent;
        if (nav.url && nav.isMainFrame !== false) this.currentUrl = nav.url;
        return { url: this.currentUrl, isMainFrame: nav.isMainFrame !== false };
      };
      this.element.addEventListener("dom-ready", () => {
        markReady();
        this.webContents.emit("dom-ready", { url: this.currentUrl });
      });
      this.element.addEventListener("did-start-navigation", (event) =>
        this.webContents.emit("did-start-navigation", trackUrl(event)),
      );
      this.element.addEventListener("did-redirect-navigation", (event) =>
        this.webContents.emit("did-redirect-navigation", trackUrl(event)),
      );
      this.element.addEventListener("did-navigate", (event) =>
        this.webContents.emit("did-navigate", trackUrl(event)),
      );
      this.element.addEventListener("did-navigate-in-page", (event) =>
        this.webContents.emit("did-navigate-in-page", trackUrl(event)),
      );
      this.element.addEventListener("did-start-loading", () =>
        this.webContents.emit("did-start-loading", { url: this.currentUrl }),
      );
      this.element.addEventListener("did-stop-loading", () =>
        this.webContents.emit("did-stop-loading", { url: this.currentUrl }),
      );
      this.element.addEventListener("did-finish-load", () =>
        this.webContents.emit("did-finish-load", { url: this.currentUrl }),
      );
      this.element.addEventListener("did-fail-load", (event) =>
        this.webContents.emit("did-fail-load", event),
      );
      this.element.addEventListener("page-title-updated", (event) =>
        this.webContents.emit("page-title-updated", event),
      );
      this.element.addEventListener("page-favicon-updated", (event) =>
        this.webContents.emit("page-favicon-updated", event),
      );
    } else {
      this.element.addEventListener("load", () => {
        markReady();
        this.webContents.emit("dom-ready", { url: this.currentUrl });
        this.webContents.emit("did-navigate", { url: this.currentUrl, isMainFrame: true });
        this.webContents.emit("did-stop-loading", { url: this.currentUrl });
        this.webContents.emit("did-finish-load", { url: this.currentUrl });
        this.webContents.emit("page-title-updated", { title: titleFromUrl(this.currentUrl) });
      });
      this.element.addEventListener("error", () => {
        this.webContents.emit("did-fail-load", { url: this.currentUrl });
      });
    }
  }
}

function titleFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname || url;
  } catch {
    return url;
  }
}
