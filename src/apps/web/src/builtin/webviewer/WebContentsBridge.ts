export type WebContentsBridgeEvent =
  | "did-start-navigation"
  | "did-redirect-navigation"
  | "did-navigate"
  | "dom-ready"
  | "did-start-loading"
  | "did-stop-loading"
  | "did-finish-load"
  | "did-fail-load"
  | "did-navigate-in-page"
  | "page-favicon-updated"
  | "page-title-updated"
  | "destroyed";

export type WebContentsBridgeHandler = (payload?: unknown) => void;

export class WebContentsBridge {
  private handlers = new Map<WebContentsBridgeEvent, Set<WebContentsBridgeHandler>>();

  on(event: WebContentsBridgeEvent, handler: WebContentsBridgeHandler): () => void {
    const handlers = this.handlers.get(event) ?? new Set<WebContentsBridgeHandler>();
    handlers.add(handler);
    this.handlers.set(event, handlers);
    return () => handlers.delete(handler);
  }

  emit(event: WebContentsBridgeEvent, payload?: unknown): void {
    for (const handler of this.handlers.get(event) ?? []) handler(payload);
  }

  destroy(): void {
    this.emit("destroyed");
    this.handlers.clear();
  }
}
