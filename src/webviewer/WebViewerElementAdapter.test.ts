import { describe, expect, it, vi } from "vitest";
import { WebViewerElementAdapter } from "./WebViewerElementAdapter";

// jsdom has no <webview> custom element, so the adapter runs in iframe mode;
// the ready-gating contract is the same in both modes.
function makeAdapter() {
  const adapter = new WebViewerElementAdapter({ partition: "persist:test" });
  const setZoomFactor = vi.fn<(zoom: number) => void>();
  (adapter.element as unknown as { setZoomFactor: typeof setZoomFactor }).setZoomFactor = setZoomFactor;
  return { adapter, setZoomFactor };
}

describe("WebViewerElementAdapter readiness gating", () => {
  it("defers setZoomFactor until the element is ready, then replays the last zoom", () => {
    const { adapter, setZoomFactor } = makeAdapter();
    // Electron throws "The WebView must be attached to the DOM and the
    // dom-ready event emitted" for early calls — the adapter must not forward.
    adapter.setZoom(2);
    adapter.setZoom(1.5);
    expect(setZoomFactor).not.toHaveBeenCalled();
    // The CSS fallback still applies immediately.
    expect(adapter.element.style.transform).toBe("scale(1.5)");

    adapter.element.dispatchEvent(new Event("load"));
    expect(setZoomFactor).toHaveBeenCalledTimes(1);
    expect(setZoomFactor).toHaveBeenCalledWith(1.5);

    adapter.setZoom(3);
    expect(setZoomFactor).toHaveBeenLastCalledWith(3);
  });

  it("gates goBack/goForward/getWebContentsId before ready", () => {
    const { adapter } = makeAdapter();
    const goBack = vi.fn();
    (adapter.element as unknown as { goBack: typeof goBack }).goBack = goBack;
    adapter.goBack();
    expect(goBack).not.toHaveBeenCalled();
    expect(adapter.getWebContentsId()).toBeNull();

    adapter.element.dispatchEvent(new Event("load"));
    adapter.goBack();
    expect(goBack).toHaveBeenCalledTimes(1);
  });

  it("emits the bridge lifecycle on load and falls back to src for early reload", () => {
    const { adapter } = makeAdapter();
    const events: string[] = [];
    for (const name of ["dom-ready", "did-stop-loading", "did-finish-load"] as const) {
      adapter.webContents.on(name, () => events.push(name));
    }
    adapter.navigate("https://example.com", true);
    // Not ready: reload must not call element.reload (throws on real webview).
    const reload = vi.fn();
    (adapter.element as unknown as { reload: typeof reload }).reload = reload;
    adapter.reload();
    expect(reload).not.toHaveBeenCalled();

    adapter.element.dispatchEvent(new Event("load"));
    expect(events).toEqual(["dom-ready", "did-stop-loading", "did-finish-load"]);
    adapter.reload();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
