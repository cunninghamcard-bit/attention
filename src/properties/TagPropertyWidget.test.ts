import { beforeEach, describe, expect, it } from "vitest";
import { App } from "../app/App";
import { MarkdownView } from "../views/MarkdownView";

describe("TagPropertyWidget", () => {
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

  it("renders tags without a leading hash, marks invalid tags, and prevents hash-insensitive duplicates", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    const source = await app.vault.create("Note.md", [
      "---",
      "tags:",
      "  - project/alpha",
      "  - \"#bad tag\"",
      "---",
      "Body",
    ].join("\n"));

    const leaf = app.workspace.getLeaf();
    await leaf.openFile(source, { active: true, state: { mode: "source" } });
    const view = leaf.view as MarkdownView;
    const rowEl = view.metadataContainerEl.querySelector<HTMLElement>('[data-property-key="tags"]');
    const inputEl = rowEl?.querySelector<HTMLInputElement>(".multi-select-input");
    if (!rowEl || !inputEl) throw new Error("missing tags widget");

    expect([...rowEl.querySelectorAll(".multi-select-pill-content")].map((el) => el.textContent)).toEqual(["project/alpha", "bad tag"]);
    expect(rowEl.querySelectorAll(".multi-select-pill.is-invalid")).toHaveLength(1);

    inputEl.value = "#project/alpha";
    inputEl.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(view.getViewData().match(/project\/alpha/g)).toHaveLength(1);

    inputEl.value = "new-tag";
    inputEl.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(view.getViewData()).toContain("  - \"new-tag\"");
  });

  it("tabs through existing tag suggestions before enter commits them", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    const existing = await app.vault.create("Existing.md", "Body #project/beta");
    await app.metadataCache.computeFileMetadataAsync(existing);
    const source = await app.vault.create("Note.md", [
      "---",
      "tags:",
      "  - alpha",
      "---",
      "Body",
    ].join("\n"));

    const leaf = app.workspace.getLeaf();
    await leaf.openFile(source, { active: true, state: { mode: "source" } });
    const view = leaf.view as MarkdownView;
    const inputEl = view.metadataContainerEl.querySelector<HTMLInputElement>('[data-property-key="tags"] .multi-select-input');
    if (!inputEl) throw new Error("missing tags input");

    inputEl.value = "proj";
    inputEl.dispatchEvent(new InputEvent("input", { bubbles: true }));
    await waitForSuggestions();
    expect(document.body.querySelector(".metadata-tag-suggestion-container .suggestion-highlight")?.textContent).toBe("proj");
    inputEl.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));

    expect(inputEl.value).toBe("project/");
    expect(view.getViewData()).not.toContain("project/beta");

    inputEl.value = "project/beta";
    inputEl.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(view.getViewData()).toContain("  - project/beta");
  });

  it("keeps the hash when completing hash-prefixed tag suggestions", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    const existing = await app.vault.create("Existing.md", "Body #project/beta");
    await app.metadataCache.computeFileMetadataAsync(existing);
    const source = await app.vault.create("Note.md", [
      "---",
      "tags:",
      "  - alpha",
      "---",
      "Body",
    ].join("\n"));

    const leaf = app.workspace.getLeaf();
    await leaf.openFile(source, { active: true, state: { mode: "source" } });
    const view = leaf.view as MarkdownView;
    const inputEl = view.metadataContainerEl.querySelector<HTMLInputElement>('[data-property-key="tags"] .multi-select-input');
    if (!inputEl) throw new Error("missing tags input");

    inputEl.value = "#proj";
    inputEl.dispatchEvent(new InputEvent("input", { bubbles: true }));
    await waitForSuggestions();
    inputEl.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));

    expect(inputEl.value).toBe("#project/");
    inputEl.value = "#project/beta";
    inputEl.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(view.getViewData()).toContain("  - \"#project/beta\"");
  });

  it("edits existing tag pills using hash-insensitive duplicate rules", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    const source = await app.vault.create("Note.md", [
      "---",
      "tags:",
      "  - alpha",
      "  - beta",
      "---",
      "Body",
    ].join("\n"));

    const leaf = app.workspace.getLeaf();
    await leaf.openFile(source, { active: true, state: { mode: "source" } });
    const view = leaf.view as MarkdownView;
    const firstPill = view.metadataContainerEl.querySelector<HTMLElement>('[data-property-key="tags"] .multi-select-pill');
    if (!firstPill) throw new Error("missing tag pill");
    firstPill.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    const editInput = [...view.metadataContainerEl.querySelectorAll<HTMLInputElement>('[data-property-key="tags"] .multi-select-input')]
      .find((input) => input.value === "alpha");
    if (!editInput) throw new Error("missing tag edit input");
    editInput.value = "#beta";
    editInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(view.getViewData()).toContain("  - alpha");
    expect(view.metadataContainerEl.querySelector('[data-property-key="tags"] .multi-select-pill.multi-select-duplicate')).not.toBeNull();

    editInput.value = "gamma";
    editInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(view.getViewData()).toContain("  - gamma");
    expect(view.getViewData()).not.toContain("  - alpha");
  });
});

async function waitForSuggestions(): Promise<void> {
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
}
