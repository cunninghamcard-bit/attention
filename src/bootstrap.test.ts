import { beforeEach, describe, expect, it } from "vitest";
import { bootstrap } from "./bootstrap";

describe("application bootstrap", () => {
  beforeEach(() => {
    document.body.className = "";
    document.body.replaceChildren();
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

  it("starts the runnable shell with one AppDom and opens the Welcome markdown view", async () => {
    const app = await bootstrap(document.body);

    expect(window.app).toBe(app);
    expect(document.body.querySelectorAll(":scope > .app-container")).toHaveLength(1);
    expect(app.vault.getFileByPath("Welcome.md")).not.toBeNull();
    expect(app.vault.getFileByPath("Plugin Architecture.md")).not.toBeNull();
    expect(app.workspace.activeLeaf?.view?.getViewType()).toBe("markdown");
    expect((app.workspace.activeLeaf?.view as { file?: { path: string } | null } | null)?.file?.path).toBe("Welcome.md");
    expect(app.workspace.activeLeaf?.view?.getState()).toMatchObject({ mode: "preview" });
    expect(document.body.textContent).toContain("Obsidian Reconstructed");
  });
});
