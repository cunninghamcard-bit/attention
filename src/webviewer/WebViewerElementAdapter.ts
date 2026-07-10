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
  goBack?: () => void;
  goForward?: () => void;
  setZoomFactor?: (zoom: number) => void;
  getWebContentsId?: () => number;
};

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

  constructor(options: WebViewerElementAdapterOptions) {
    const supportsWebview = typeof customElements !== "undefined" && Boolean(customElements.get("webview"));
    this.mode = supportsWebview ? "webview" : "iframe";
    this.element = document.createElement(this.mode === "webview" ? "webview" : "iframe") as WebviewLikeElement;
    this.element.className = this.mode === "webview" ? "webviewer-webview" : "webviewer-frame";
    this.element.partition = options.partition;
    this.element.allowpopups = options.allowPopups ?? true;
    this.element.setAttribute("partition", options.partition);
    if (options.allowPopups ?? true) this.element.setAttribute("allowpopups", "true");
    if (this.mode === "iframe") this.element.setAttribute("sandbox", "allow-forms allow-same-origin allow-scripts allow-popups");
    this.installEvents();
  }

  navigate(url: string, userInitiated = false): void {
    this.currentUrl = url || "about:blank";
    this.webContents.emit(userInitiated ? "did-start-navigation" : "did-redirect-navigation", { url: this.currentUrl });
    this.element.src = this.currentUrl;
  }

  reload(): void {
    this.webContents.emit("did-start-navigation", { url: this.currentUrl, reload: true });
    if (this.ready && this.element.reload) this.element.reload();
    else this.element.src = this.currentUrl;
  }

  goBack(): void {
    if (this.ready) this.element.goBack?.();
  }

  goForward(): void {
    if (this.ready) this.element.goForward?.();
  }

  setZoom(zoom: number): void {
    if (this.ready) this.element.setZoomFactor?.(zoom);
    else this.pendingZoom = zoom;
    this.element.style.transform = `scale(${zoom})`;
    this.element.style.transformOrigin = "top left";
    this.element.style.width = `${100 / zoom}%`;
    this.element.style.height = `${100 / zoom}%`;
  }

  getWebContentsId(): number | null {
    if (!this.ready) return null;
    return this.element.getWebContentsId?.() ?? null;
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
      this.element.addEventListener("dom-ready", () => {
        markReady();
        this.webContents.emit("dom-ready", { url: this.currentUrl });
      });
      this.element.addEventListener("did-stop-loading", () => this.webContents.emit("did-stop-loading", { url: this.currentUrl }));
      this.element.addEventListener("did-start-loading", () => this.webContents.emit("did-start-navigation", { url: this.currentUrl }));
      this.element.addEventListener("did-finish-load", () => this.webContents.emit("did-finish-load", { url: this.currentUrl }));
      this.element.addEventListener("did-fail-load", (event) => this.webContents.emit("did-fail-load", event));
    } else {
      this.element.addEventListener("load", () => {
        markReady();
        this.webContents.emit("dom-ready", { url: this.currentUrl });
        this.webContents.emit("did-stop-loading", { url: this.currentUrl });
        this.webContents.emit("did-finish-load", { url: this.currentUrl });
        this.webContents.emit("page-title-updated", { title: titleFromUrl(this.currentUrl) });
      });
    }
    this.element.addEventListener("error", () => {
      this.webContents.emit("did-fail-load", { url: this.currentUrl });
    });
    this.element.addEventListener("page-title-updated", (event) => this.webContents.emit("page-title-updated", event));
    this.element.addEventListener("page-favicon-updated", (event) => this.webContents.emit("page-favicon-updated", event));
    this.element.addEventListener("did-navigate-in-page", (event) => this.webContents.emit("did-navigate-in-page", event));
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
