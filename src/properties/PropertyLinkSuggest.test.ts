import { beforeEach, describe, expect, it } from "vitest";
import { App } from "../app/App";
import { MarkdownView } from "../views/MarkdownView";

describe("PropertyLinkSuggest", () => {
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

  it("accepts property link suggestions as wikilinks even when markdown links are enabled", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    const source = await app.vault.create("Daily/Today.md", [
      "---",
      "related: \"[[Tar\"",
      "---",
      "Body",
    ].join("\n"));
    await app.vault.create("Notes/Target.md", "Target body");
    app.vault.setConfig("newLinkFormat", "relative");
    app.vault.setConfig("useMarkdownLinks", true);

    const leaf = app.workspace.getLeaf();
    await leaf.openFile(source, { active: true, state: { mode: "source" } });
    const view = leaf.view as MarkdownView;
    const inputEl = view.metadataContainerEl.querySelector<HTMLInputElement>(".metadata-input-text");
    if (!inputEl) throw new Error("missing property input");
    inputEl.setSelectionRange(inputEl.value.length, inputEl.value.length);
    inputEl.dispatchEvent(new InputEvent("input", { bubbles: true }));
    await waitForSuggestions();
    inputEl.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await Promise.resolve();

    expect(view.getViewData()).toBe([
      "---",
      "related: \"[[../Notes/Target|Target]]\"",
      "---",
      "Body",
    ].join("\n"));
  });

  it("keeps property suggestions open for subpath continuation keys", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    const source = await app.vault.create("Daily/Today.md", [
      "---",
      "related: \"[[Tar\"",
      "---",
      "Body",
    ].join("\n"));
    await app.vault.create("Notes/Target.md", "Target body");
    app.vault.setConfig("newLinkFormat", "relative");

    const leaf = app.workspace.getLeaf();
    await leaf.openFile(source, { active: true, state: { mode: "source" } });
    const view = leaf.view as MarkdownView;
    const inputEl = view.metadataContainerEl.querySelector<HTMLInputElement>(".metadata-input-text");
    if (!inputEl) throw new Error("missing property input");
    inputEl.setSelectionRange(inputEl.value.length, inputEl.value.length);
    inputEl.dispatchEvent(new InputEvent("input", { bubbles: true }));
    await waitForSuggestions();
    inputEl.dispatchEvent(new KeyboardEvent("keydown", { key: "#", bubbles: true }));
    await Promise.resolve();

    expect(inputEl.value).toBe("[[../Notes/Target#|Target]]");
    expect(view.getViewData()).toContain("related: \"[[Tar\"");
  });

  it("writes missing block ids before committing a property link", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    const source = await app.vault.create("Source.md", [
      "---",
      "related: \"[[Target#^Para\"",
      "---",
      "Body",
    ].join("\n"));
    const target = await app.vault.create("Target.md", "Paragraph block");
    await app.metadataCache.computeFileMetadataAsync(target);

    const leaf = app.workspace.getLeaf();
    await leaf.openFile(source, { active: true, state: { mode: "source" } });
    const view = leaf.view as MarkdownView;
    const inputEl = view.metadataContainerEl.querySelector<HTMLInputElement>(".metadata-input-text");
    if (!inputEl) throw new Error("missing property input");
    inputEl.setSelectionRange(inputEl.value.length, inputEl.value.length);
    inputEl.dispatchEvent(new InputEvent("input", { bubbles: true }));
    await waitForSuggestions();
    inputEl.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await waitForSuggestions();

    const targetText = await app.vault.read(target);
    expect(targetText).toMatch(/^Paragraph block \^[a-f0-9]{6}$/);
    expect(view.getViewData()).toMatch(/related: "\[\[Target#\^[a-f0-9]{6}\]\]"/);
  });
});

async function waitForSuggestions(): Promise<void> {
  for (let index = 0; index < 20; index += 1) {
    await Promise.resolve();
  }
}
