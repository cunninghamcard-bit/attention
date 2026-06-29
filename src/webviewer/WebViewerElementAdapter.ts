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
    if (this.element.reload) this.element.reload();
    else this.element.src = this.currentUrl;
  }

  goBack(): void {
    this.element.goBack?.();
  }

  goForward(): void {
    this.element.goForward?.();
  }

  setZoom(zoom: number): void {
    this.element.setZoomFactor?.(zoom);
    this.element.style.transform = `scale(${zoom})`;
    this.element.style.transformOrigin = "top left";
    this.element.style.width = `${100 / zoom}%`;
    this.element.style.height = `${100 / zoom}%`;
  }

  getWebContentsId(): number | null {
    return this.element.getWebContentsId?.() ?? null;
  }

  destroy(): void {
    this.webContents.destroy();
    this.element.remove();
  }

  private installEvents(): void {
    this.element.addEventListener("load", () => {
      this.webContents.emit("dom-ready", { url: this.currentUrl });
      this.webContents.emit("did-stop-loading", { url: this.currentUrl });
      this.webContents.emit("did-finish-load", { url: this.currentUrl });
      this.webContents.emit("page-title-updated", { title: titleFromUrl(this.currentUrl) });
    });
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
