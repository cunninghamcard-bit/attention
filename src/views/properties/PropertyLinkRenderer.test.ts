import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../app/App";
import { MarkdownView } from "../MarkdownView";

describe("PropertyLinkRenderer", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => store.set(key, value),
        removeItem: (key: string) => store.delete(key),
        clear: () => store.clear(),
      },
    });
  });

  it("renders text property wikilinks as clickable internal metadata links", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    const source = await app.vault.create("Source.md", [
      "---",
      "related: \"[[Target|Shown]]\"",
      "---",
      "Body",
    ].join("\n"));
    await app.vault.create("Target.md", "Target body");

    const leaf = app.workspace.getLeaf();
    await leaf.openFile(source, { active: true, state: { mode: "source" } });
    const view = leaf.view as MarkdownView;
    const linkEl = view.metadataContainerEl.querySelector<HTMLElement>('[data-property-key="related"] .metadata-link-inner');
    if (!linkEl) throw new Error("missing metadata link");

    expect(linkEl.textContent).toBe("Shown");
    expect(linkEl.dataset.href).toBe("Target");
    expect(linkEl.classList.contains("internal-link")).toBe(true);
    expect(linkEl.classList.contains("is-unresolved")).toBe(false);

    const hover = vi.fn();
    app.workspace.on("hover-link", hover);
    linkEl.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    expect(hover).toHaveBeenCalledWith(expect.objectContaining({ linktext: "Target", sourcePath: "Source.md" }));
  });

  it("marks unresolved links and renders external property links", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    const source = await app.vault.create("Source.md", [
      "---",
      "missing: \"[[Missing]]\"",
      "website: https://example.com",
      "---",
      "Body",
    ].join("\n"));

    const leaf = app.workspace.getLeaf();
    await leaf.openFile(source, { active: true, state: { mode: "source" } });
    const view = leaf.view as MarkdownView;
    const missingEl = view.metadataContainerEl.querySelector<HTMLElement>('[data-property-key="missing"] .metadata-link-inner');
    const websiteEl = view.metadataContainerEl.querySelector<HTMLElement>('[data-property-key="website"] .metadata-link-inner');

    expect(missingEl?.classList.contains("is-unresolved")).toBe(true);
    expect(websiteEl?.classList.contains("external-link")).toBe(true);
    expect(websiteEl?.dataset.href).toBe("https://example.com");
  });

  it("renders internal markdown links inside multi-value pills", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    const source = await app.vault.create("Source.md", [
      "---",
      "items:",
      "  - \"[Shown](Target.md)\"",
      "---",
      "Body",
    ].join("\n"));
    await app.vault.create("Target.md", "Target body");

    const leaf = app.workspace.getLeaf();
    await leaf.openFile(source, { active: true, state: { mode: "source" } });
    const view = leaf.view as MarkdownView;
    const pillLinkEl = view.metadataContainerEl.querySelector<HTMLElement>('[data-property-key="items"] .multi-select-pill-content .metadata-link-inner');

    expect(pillLinkEl?.textContent).toBe("Shown");
    expect(pillLinkEl?.dataset.href).toBe("Target.md");
    expect(pillLinkEl?.classList.contains("internal-link")).toBe(true);
  });
});
