import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "@web/app/App";
import { MarkdownView } from "@web/views/MarkdownView";

describe("AliasPropertyWidget", () => {
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

  it("renders aliases as plain text pills, marks empty aliases invalid, and prevents exact duplicates", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    const source = await app.vault.create(
      "Note.md",
      ["---", "aliases:", "  - Alpha", '  - ""', "---", "Body"].join("\n"),
    );

    const leaf = app.workspace.getLeaf();
    await leaf.openFile(source, { active: true, state: { mode: "source" } });
    const view = leaf.view as MarkdownView;
    const rowEl = view.metadataContainerEl.querySelector<HTMLElement>(
      '[data-property-key="aliases"]',
    );
    const inputEl = rowEl?.querySelector<HTMLInputElement>(".multi-select-input");
    if (!rowEl || !inputEl) throw new Error("missing aliases widget");

    expect(
      [...rowEl.querySelectorAll(".multi-select-pill-content")].map((el) => el.textContent),
    ).toEqual(["Alpha", ""]);
    expect(rowEl.querySelectorAll(".multi-select-pill.is-invalid")).toHaveLength(1);
    expect(rowEl.querySelector(".metadata-link-inner")).toBeNull();

    inputEl.value = "Alpha";
    inputEl.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(view.getViewData().match(/Alpha/g)).toHaveLength(1);

    inputEl.value = "Beta";
    inputEl.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(view.getViewData()).toContain("  - Beta");
  });

  it("commits aliases on blur but not comma or tab", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    const source = await app.vault.create(
      "Note.md",
      ["---", "aliases:", "  - Existing", "---", "Body"].join("\n"),
    );

    const leaf = app.workspace.getLeaf();
    await leaf.openFile(source, { active: true, state: { mode: "source" } });
    const view = leaf.view as MarkdownView;
    const inputEl = view.metadataContainerEl.querySelector<HTMLInputElement>(
      '[data-property-key="aliases"] .multi-select-input',
    );
    if (!inputEl) throw new Error("missing aliases input");

    inputEl.value = "Comma";
    inputEl.dispatchEvent(new KeyboardEvent("keydown", { key: ",", bubbles: true }));
    expect(view.getViewData()).not.toContain("Comma");

    inputEl.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    expect(view.getViewData()).not.toContain("Comma");

    inputEl.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
    expect(view.getViewData()).toContain("  - Comma");
  });

  it("does not bind property link suggestions for aliases", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    const source = await app.vault.create(
      "Note.md",
      ["---", "aliases:", "  - Existing", "---", "Body"].join("\n"),
    );
    await app.vault.create("Target.md", "Target body");

    const leaf = app.workspace.getLeaf();
    await leaf.openFile(source, { active: true, state: { mode: "source" } });
    const view = leaf.view as MarkdownView;
    const inputEl = view.metadataContainerEl.querySelector<HTMLInputElement>(
      '[data-property-key="aliases"] .multi-select-input',
    );
    if (!inputEl) throw new Error("missing aliases input");

    inputEl.value = "[[Tar";
    inputEl.setSelectionRange(inputEl.value.length, inputEl.value.length);
    inputEl.dispatchEvent(new InputEvent("input", { bubbles: true }));
    await waitForMicrotasks();
    inputEl.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(view.getViewData()).toContain('  - "[[Tar"');
    expect(view.getViewData()).not.toContain("[[Target");
  });

  it("edits existing alias pills with enter, escape, blur, and duplicate highlighting", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    const source = await app.vault.create(
      "Note.md",
      ["---", "aliases:", "  - Alpha", "  - Beta", "---", "Body"].join("\n"),
    );

    const leaf = app.workspace.getLeaf();
    await leaf.openFile(source, { active: true, state: { mode: "source" } });
    const view = leaf.view as MarkdownView;
    const firstPill = view.metadataContainerEl.querySelector<HTMLElement>(
      '[data-property-key="aliases"] .multi-select-pill',
    );
    if (!firstPill) throw new Error("missing alias pill");
    firstPill.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    const editInput = [
      ...view.metadataContainerEl.querySelectorAll<HTMLInputElement>(
        '[data-property-key="aliases"] .multi-select-input',
      ),
    ].find((input) => input.value === "Alpha");
    if (!editInput) throw new Error("missing alias edit input");
    editInput.value = "Beta";
    editInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(view.getViewData()).toContain("  - Alpha");
    expect(
      view.metadataContainerEl.querySelector(
        '[data-property-key="aliases"] .multi-select-pill.multi-select-duplicate',
      ),
    ).not.toBeNull();

    editInput.value = "Gamma";
    editInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(view.getViewData()).toContain("  - Gamma");
    expect(view.getViewData()).not.toContain("  - Alpha");
  });

  it("opens the shared pill context menu for edit, copy, and remove", async () => {
    const writeText = vi.fn();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const app = new App(document.createElement("div"));
    await app.ready;
    const source = await app.vault.create(
      "Note.md",
      ["---", "aliases:", "  - Alpha", "  - Beta", "---", "Body"].join("\n"),
    );

    const leaf = app.workspace.getLeaf();
    await leaf.openFile(source, { active: true, state: { mode: "source" } });
    const view = leaf.view as MarkdownView;
    const firstPill = view.metadataContainerEl.querySelector<HTMLElement>(
      '[data-property-key="aliases"] .multi-select-pill',
    );
    if (!firstPill) throw new Error("missing alias pill");

    firstPill.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, clientX: 10, clientY: 10 }),
    );
    expect(
      [...document.body.querySelectorAll(".menu-item-title")].map((el) => el.textContent),
    ).toEqual(["Edit", "Copy", "Remove"]);
    [...document.body.querySelectorAll<HTMLElement>(".menu-item")]
      .find((item) => item.textContent?.includes("Copy"))
      ?.click();
    expect(writeText).toHaveBeenCalledWith("Alpha");

    firstPill.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, clientX: 10, clientY: 10 }),
    );
    [...document.body.querySelectorAll<HTMLElement>(".menu-item")]
      .find((item) => item.textContent?.includes("Remove"))
      ?.click();
    expect(view.getViewData()).not.toContain("  - Alpha");
    expect(view.getViewData()).toContain("  - Beta");
  });
});

async function waitForMicrotasks(): Promise<void> {
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
}
