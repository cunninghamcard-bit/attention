import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "@web/app/App";

describe("CustomCss", () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
        clear: () => values.clear(),
      },
    });
    Object.defineProperty(window, "focus", { configurable: true, value: () => {} });
  });

  afterEach(() => {
    document.head.querySelectorAll("style[data-obsidian-reconstructed-css]").forEach((style) => style.remove());
  });

  it("loads legacy theme css and enabled snippets from the vault config directory", async () => {
    const app = new App(document.createElement("div"));
    void app.jsonStore.writeText("themes/Legacy.css", "body { --legacy-theme: 1; }");
    void app.jsonStore.writeText("snippets/focus.css", ".focus { opacity: .8; }");
    app.vault.setConfig("cssTheme", "Legacy");
    app.vault.setConfig("enabledCssSnippets", ["focus"]);

    await app.ready;

    expect(app.themes.getActiveTheme()?.id).toBe("Legacy");
    expect(document.head.querySelector<HTMLStyleElement>('style[data-theme="Legacy"]')?.textContent).toContain("--legacy-theme");
    expect(document.head.querySelector<HTMLStyleElement>('style[data-obsidian-reconstructed-css="snippet:focus"]')?.textContent).toContain("opacity");
  });

  it("loads folder themes from manifest.json and theme.css", async () => {
    const app = new App(document.createElement("div"));
    void app.jsonStore.write("themes/Solarized/manifest.json", { name: "Solarized", author: "Ethan" });
    void app.jsonStore.writeText("themes/Solarized/theme.css", "body { --solarized: 1; }");
    app.vault.setConfig("cssTheme", "Solarized");

    await app.ready;

    expect(app.themes.getActiveTheme()?.id).toBe("Solarized");
    expect(document.head.querySelector<HTMLStyleElement>('style[data-theme="Solarized"]')?.textContent).toContain("--solarized");
  });

  it("reloads snippets from raw config file changes", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;

    app.vault.setConfig("enabledCssSnippets", ["later"]);
    await app.jsonStore.writeText("snippets/later.css", ".later { color: red; }");

    await vi.waitFor(() => {
      expect(document.head.querySelector<HTMLStyleElement>('style[data-obsidian-reconstructed-css="snippet:later"]')?.textContent).toContain("color");
    });
  });

  it("treats scanned snippets as authoritative while preserving enabled config", async () => {
    const app = new App(document.createElement("div"));
    void app.jsonStore.writeText("snippets/keep.css", ".keep { color: green; }");
    void app.jsonStore.writeText("snippets/gone.css", ".gone { color: red; }");
    app.vault.setConfig("enabledCssSnippets", ["keep", "gone"]);
    await app.ready;

    expect(getSnippetStyle("keep")?.textContent).toContain("green");
    expect(getSnippetStyle("gone")?.textContent).toContain("red");
    expect(app.cssSnippets.listSnippets().map((snippet) => snippet.id)).toEqual(["gone", "keep"]);

    await app.jsonStore.delete("snippets/gone.css");
    await app.customCss.readSnippets(true);
    await app.customCss.requestLoadSnippets.run();

    expect(getSnippetStyle("keep")?.textContent).toContain("green");
    expect(getSnippetStyle("gone")).toBeNull();
    expect(app.cssSnippets.listSnippets().map((snippet) => snippet.id)).toEqual(["keep"]);
    expect(app.vault.getConfig("enabledCssSnippets")).toEqual(["keep", "gone"]);

    await app.jsonStore.writeText("snippets/gone.css", ".gone { color: purple; }");
    await app.customCss.readSnippets(true);
    await app.customCss.requestLoadSnippets.run();

    expect(getSnippetStyle("gone")?.textContent).toContain("purple");
    expect(app.cssSnippets.listSnippets().map((snippet) => snippet.id)).toEqual(["gone", "keep"]);
  });

  it("debounces configured theme and snippet CSS application", async () => {
    const app = new App(document.createElement("div"));
    void app.jsonStore.writeText("themes/Slow.css", "body { --slow-theme: 1; }");
    void app.jsonStore.writeText("snippets/slow.css", ".slow { color: blue; }");
    await app.ready;

    vi.useFakeTimers();
    try {
      app.themes.setTheme("Slow");
      app.cssSnippets.setEnabled("slow", true);

      await vi.advanceTimersByTimeAsync(99);
      expect(document.head.querySelector<HTMLStyleElement>('style[data-theme="Slow"]')?.textContent ?? "").not.toContain("--slow-theme");
      expect(document.head.querySelector<HTMLStyleElement>('style[data-obsidian-reconstructed-css="snippet:slow"]')).toBeNull();

      await vi.advanceTimersByTimeAsync(1);
      expect(document.head.querySelector<HTMLStyleElement>('style[data-theme="Slow"]')?.textContent).toContain("--slow-theme");
      expect(document.head.querySelector<HTMLStyleElement>('style[data-obsidian-reconstructed-css="snippet:slow"]')?.textContent).toContain("blue");
    } finally {
      vi.useRealTimers();
    }
  });
});

function getSnippetStyle(id: string): HTMLStyleElement | null {
  return document.head.querySelector<HTMLStyleElement>(`style[data-obsidian-reconstructed-css="snippet:${id}"]`);
}
