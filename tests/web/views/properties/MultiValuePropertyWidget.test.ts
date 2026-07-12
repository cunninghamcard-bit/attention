import { beforeEach, describe, expect, it } from "vitest";
import { App } from "@web/app/App";
import { MarkdownView } from "@web/views/MarkdownView";

describe("MultiValuePropertyWidget", () => {
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

  it("renders multitext values as removable multi-select pills and commits typed entries", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    const source = await app.vault.create(
      "Note.md",
      ["---", "items:", "  - Alpha", "  - Beta", "---", "Body"].join("\n"),
    );

    const leaf = app.workspace.getLeaf();
    await leaf.openFile(source, { active: true, state: { mode: "source" } });
    const view = leaf.view as MarkdownView;
    const rowEl = view.metadataContainerEl.querySelector<HTMLElement>(
      '[data-property-key="items"]',
    );
    const inputEl = rowEl?.querySelector<HTMLInputElement>(".multi-select-input");
    if (!rowEl || !inputEl) throw new Error("missing items multi-select");

    expect(
      [...rowEl.querySelectorAll(".multi-select-pill-content")].map((el) => el.textContent),
    ).toEqual(["Alpha", "Beta"]);

    rowEl.querySelector<HTMLButtonElement>(".multi-select-pill-remove-button")?.click();
    expect(view.getViewData()).toContain("  - Beta");
    expect(view.getViewData()).not.toContain("  - Alpha");

    const rerenderedInput = view.metadataContainerEl.querySelector<HTMLInputElement>(
      '[data-property-key="items"] .multi-select-input',
    );
    if (!rerenderedInput) throw new Error("missing rerendered input");
    rerenderedInput.value = "Gamma";
    rerenderedInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(view.getViewData()).toContain("  - Beta");
    expect(view.getViewData()).toContain("  - Gamma");

    const finalInput = view.metadataContainerEl.querySelector<HTMLInputElement>(
      '[data-property-key="items"] .multi-select-input',
    );
    if (!finalInput) throw new Error("missing final input");
    finalInput.value = "[[Manual";
    finalInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(view.getViewData()).toContain('  - "[[Manual]]"');
  });

  it("adds accepted property link suggestions as multitext pills", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    const source = await app.vault.create(
      "Daily/Today.md",
      ["---", "items:", "  - Existing", "---", "Body"].join("\n"),
    );
    await app.vault.create("Notes/Target.md", "Target body");
    app.vault.setConfig("newLinkFormat", "relative");

    const leaf = app.workspace.getLeaf();
    await leaf.openFile(source, { active: true, state: { mode: "source" } });
    const view = leaf.view as MarkdownView;
    const inputEl = view.metadataContainerEl.querySelector<HTMLInputElement>(
      '[data-property-key="items"] .multi-select-input',
    );
    if (!inputEl) throw new Error("missing items input");

    inputEl.value = "[[Tar";
    inputEl.setSelectionRange(inputEl.value.length, inputEl.value.length);
    inputEl.dispatchEvent(new InputEvent("input", { bubbles: true }));
    await waitForSuggestions();
    inputEl.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await waitForSuggestions();

    expect(view.getViewData()).toContain("  - Existing");
    expect(view.getViewData()).toContain('  - "[[../Notes/Target|Target]]"');
  });

  it("edits existing multitext pills and preserves wikilink normalization", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    const source = await app.vault.create(
      "Note.md",
      ["---", "items:", "  - Alpha", "---", "Body"].join("\n"),
    );

    const leaf = app.workspace.getLeaf();
    await leaf.openFile(source, { active: true, state: { mode: "source" } });
    const view = leaf.view as MarkdownView;
    const pill = view.metadataContainerEl.querySelector<HTMLElement>(
      '[data-property-key="items"] .multi-select-pill',
    );
    if (!pill) throw new Error("missing item pill");
    pill.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    const editInput = [
      ...view.metadataContainerEl.querySelectorAll<HTMLInputElement>(
        '[data-property-key="items"] .multi-select-input',
      ),
    ].find((input) => input.value === "Alpha");
    if (!editInput) throw new Error("missing item edit input");
    editInput.value = "[[Edited";
    editInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(view.getViewData()).toContain('  - "[[Edited]]"');
    expect(view.getViewData()).not.toContain("  - Alpha");
  });
});

async function waitForSuggestions(): Promise<void> {
  for (let index = 0; index < 5; index += 1) {
    await Promise.resolve();
  }
}
