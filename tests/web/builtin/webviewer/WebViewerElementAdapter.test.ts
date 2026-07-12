import { describe, expect, it, vi } from "vitest";
import { WebViewerElementAdapter } from "@web/builtin/webviewer/WebViewerElementAdapter";

// jsdom has no <webview> custom element, so the adapter defaults to iframe
// mode. Webview-mode tests register a stub custom element first.
function makeIframeAdapter() {
  return new WebViewerElementAdapter({ partition: "persist:test" });
}

function makeWebviewAdapter() {
  // jsdom can't define a hyphen-less custom element ("webview" is an Electron
  // internal registration), so stub the detection probe instead.
  const spy = vi
    .spyOn(customElements, "get")
    .mockImplementation((name) =>
      name === "webview" ? (class extends HTMLElement {} as CustomElementConstructor) : undefined,
    );
  try {
    return new WebViewerElementAdapter({ partition: "persist:test" });
  } finally {
    spy.mockRestore();
  }
}

describe("WebViewerElementAdapter zoom", () => {
  it("iframe mode zooms via CSS only — no native calls", () => {
    const adapter = makeIframeAdapter();
    const setZoomFactor = vi.fn<(zoom: number) => void>();
    (adapter.element as unknown as { setZoomFactor: typeof setZoomFactor }).setZoomFactor =
      setZoomFactor;
    adapter.setZoom(1.5);
    expect(adapter.element.style.transform).toBe("scale(1.5)");
    adapter.element.dispatchEvent(new Event("load"));
    adapter.setZoom(2);
    expect(setZoomFactor).not.toHaveBeenCalled();
    expect(adapter.element.style.transform).toBe("scale(2)");
  });

  it("webview mode zooms natively only, deferring until dom-ready and replaying the last zoom", () => {
    const adapter = makeWebviewAdapter();
    expect(adapter.mode).toBe("webview");
    const setZoomFactor = vi.fn<(zoom: number) => void>();
    (adapter.element as unknown as { setZoomFactor: typeof setZoomFactor }).setZoomFactor =
      setZoomFactor;
    // Electron throws "The WebView must be attached to the DOM and the
    // dom-ready event emitted" for early calls — the adapter must not forward.
    adapter.setZoom(2);
    adapter.setZoom(1.5);
    expect(setZoomFactor).not.toHaveBeenCalled();
    // No CSS scale on top of native zoom — that double-applies.
    expect(adapter.element.style.transform).toBe("");

    adapter.element.dispatchEvent(new Event("dom-ready"));
    expect(setZoomFactor).toHaveBeenCalledTimes(1);
    expect(setZoomFactor).toHaveBeenCalledWith(1.5);

    adapter.setZoom(3);
    expect(setZoomFactor).toHaveBeenLastCalledWith(3);
    expect(adapter.element.style.transform).toBe("");
  });
});

describe("WebViewerElementAdapter readiness gating", () => {
  it("gates goBack/goForward/getWebContentsId before ready", () => {
    const adapter = makeIframeAdapter();
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
    const adapter = makeIframeAdapter();
    const events: string[] = [];
    for (const name of [
      "dom-ready",
      "did-navigate",
      "did-stop-loading",
      "did-finish-load",
    ] as const) {
      adapter.webContents.on(name, () => events.push(name));
    }
    adapter.navigate("https://example.com", true);
    // Not ready: reload must not call element.reload (throws on real webview).
    const reload = vi.fn();
    (adapter.element as unknown as { reload: typeof reload }).reload = reload;
    adapter.reload();
    expect(reload).not.toHaveBeenCalled();

    adapter.element.dispatchEvent(new Event("load"));
    expect(events).toEqual(["dom-ready", "did-navigate", "did-stop-loading", "did-finish-load"]);
    adapter.reload();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe("WebViewerElementAdapter guest navigation tracking", () => {
  it("webview mode adopts main-frame URLs from native navigation events and ignores subframes", () => {
    const adapter = makeWebviewAdapter();
    const commits: Array<{ url?: string; isMainFrame?: boolean }> = [];
    adapter.webContents.on("did-navigate", (payload) =>
      commits.push(payload as { url?: string; isMainFrame?: boolean }),
    );

    const nav = new Event("did-navigate") as Event & { url?: string; isMainFrame?: boolean };
    nav.url = "https://example.com/clicked";
    nav.isMainFrame = true;
    adapter.element.dispatchEvent(nav);
    expect(commits).toEqual([{ url: "https://example.com/clicked", isMainFrame: true }]);

    const subframe = new Event("did-navigate") as Event & { url?: string; isMainFrame?: boolean };
    subframe.url = "https://ads.example.com/frame";
    subframe.isMainFrame = false;
    adapter.element.dispatchEvent(subframe);
    // Subframe navigations must not overwrite the tracked main-frame URL.
    expect(commits[1]).toEqual({ url: "https://example.com/clicked", isMainFrame: false });
  });

  it("iframe mode sizes itself inline (real CSS has no iframe selector)", () => {
    const adapter = makeIframeAdapter();
    expect(adapter.element.style.width).toBe("100%");
    expect(adapter.element.style.flex).toBe("1 1 auto");
  });
});
