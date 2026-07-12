import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "@web/app/App";
import type { InternalPluginWrapper } from "@web/plugin/InternalPluginWrapper";
import {
  QuickSwitcherController,
  QuickSwitcherModal,
  type QuickSwitcherItem,
} from "@web/builtin/QuickSwitcher";

describe("QuickSwitcher Obsidian core plugin behavior", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
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
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
  });

  it("quick switcher computes its item list once per open", async () => {
    const app = new App(document.createElement("div"));
    const controller = new QuickSwitcherController(app);
    await controller.onEnable(createWrapper());
    await app.vault.create("Alpha.md", "alpha");
    await app.vault.create("Beta.md", "beta");
    const getFiles = vi.spyOn(app.vault, "getFiles");

    controller.open();
    const modal = controller.activeModal!;
    for (const query of ["a", "al", "alp"]) {
      modal.inputEl.value = query;
      modal.inputEl.dispatchEvent(new Event("input"));
    }

    expect(getFiles).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain("Alpha");

    // A fresh open must re-enumerate: files created meanwhile must appear.
    modal.close();
    await app.vault.create("Gamma.md", "gamma");
    controller.open();
    const reopened = controller.activeModal!;
    reopened.inputEl.value = "gam";
    reopened.inputEl.dispatchEvent(new Event("input"));

    expect(getFiles).toHaveBeenCalledTimes(2);
    expect(document.body.textContent).toContain("Gamma");
    reopened.close();
  });

  it("reuses one active modal until it closes", async () => {
    const app = new App(document.createElement("div"));
    const controller = new QuickSwitcherController(app);
    await controller.onEnable(createWrapper());

    controller.open();
    const first = controller.activeModal;
    controller.open();

    expect(controller.activeModal).toBe(first);
    expect(document.body.querySelectorAll(".prompt")).toHaveLength(1);

    first?.close();
    expect(controller.activeModal).toBeNull();
  });

  it("opens selected files in a new tab for Mod/Command Enter", async () => {
    const app = new App(document.createElement("div"));
    const controller = new QuickSwitcherController(app);
    const file = await app.vault.create("Alpha.md", "alpha");
    const getLeaf = vi.spyOn(app.workspace, "getLeaf");

    await controller.choose({ type: "file", file }, modEnter());

    expect(getLeaf).toHaveBeenCalledWith("tab");
    expect(app.workspace.activeEditor?.file).toBe(file);
  });

  it("renders real quick switcher instructions and creates missing notes with Shift Enter", async () => {
    const app = new App(document.createElement("div"));
    const controller = new QuickSwitcherController(app);
    const modal = new QuickSwitcherModal(app, controller);
    const openLinkText = vi.spyOn(app.workspace, "openLinkText");
    modal.inputEl.value = "New Note";
    modal.inputEl.dispatchEvent(new Event("input", { bubbles: true }));

    expect(
      [...modal.instructionsEl.querySelectorAll(".prompt-instruction-command")].map(
        (el) => el.textContent,
      ),
    ).toEqual([
      "↑↓",
      "↵",
      isMacLike() ? "⌘ ↵" : "ctrl ↵",
      isMacLike() ? "⌘ ⌥ ↵" : "ctrl alt ↵",
      "shift ↵",
      "esc",
    ]);

    expect(
      modal.scope.handleKey(new KeyboardEvent("keydown", { key: "Enter", shiftKey: true })),
    ).toBe(false);
    await Promise.resolve();

    expect(openLinkText).toHaveBeenCalledWith("New Note", "", false, { active: true });
    expect(app.vault.getFileByPath("New Note.md")).not.toBeNull();
  });

  it("shows recent files for an empty query instead of all files", async () => {
    const app = new App(document.createElement("div"));
    const controller = new QuickSwitcherController(app);
    const alpha = await app.vault.create("Alpha.md", "alpha");
    const beta = await app.vault.create("Beta.md", "beta");
    await app.vault.create("Gamma.md", "gamma");
    app.workspace.recentFilePaths = [beta.path, alpha.path];
    const modal = new QuickSwitcherModal(app, controller);

    const suggestions = modal.getSuggestions("");

    expect(suggestions.map((suggestion) => itemLabel(suggestion.item))).toEqual([
      "Beta.md",
      "Alpha.md",
    ]);
  });

  it("offers create only when a non-empty query has no file matches", async () => {
    const app = new App(document.createElement("div"));
    const controller = new QuickSwitcherController(app);
    await app.vault.create("Alpha.md", "alpha");
    const modal = new QuickSwitcherModal(app, controller);

    expect(
      modal.getSuggestions("Alpha").some((suggestion) => suggestion.item?.type === "create"),
    ).toBe(false);
    const missing = modal.getSuggestions("Missing Note");

    expect(missing).toHaveLength(1);
    expect(missing[0]?.item).toBeNull();
  });

  it("still offers the create row when existing-only hides unresolved links", async () => {
    const app = new App(document.createElement("div"));
    const controller = new QuickSwitcherController(app);
    controller.options = { showExistingOnly: true, showAttachments: true, showAllFileTypes: false };
    const modal = new QuickSwitcherModal(app, controller);

    expect(modal.getSuggestions("Definitely Missing")[0]?.item).toBeNull();
  });

  it("matches markdown files by display path without the .md extension", async () => {
    const app = new App(document.createElement("div"));
    const controller = new QuickSwitcherController(app);
    await app.vault.create("Projects/Alpha.md", "alpha");
    const modal = new QuickSwitcherModal(app, controller);

    expect(
      modal.getSuggestions("Projects/Alpha.md").map((suggestion) => itemLabel(suggestion.item)),
    ).toEqual([]);
    expect(
      modal.getSuggestions("Projects/Alpha").map((suggestion) => itemLabel(suggestion.item)),
    ).toEqual(["Projects/Alpha.md"]);
  });

  it("renders file rows with markdown path titles and create rows with suggestion actions", async () => {
    const app = new App(document.createElement("div"));
    const controller = new QuickSwitcherController(app);
    await app.vault.createFolder("Folder");
    const file = await app.vault.create("Folder/Alpha.md", "alpha");
    const modal = new QuickSwitcherModal(app, controller);
    const fileEl = document.createElement("div");
    const createEl = document.createElement("div");

    modal.renderSuggestion(
      { item: { type: "file", file }, match: { score: 0, matches: [] } },
      fileEl,
    );
    modal.inputEl.value = "Missing";
    modal.renderSuggestion({ item: null, match: { score: 0, matches: [] } }, createEl);

    expect(fileEl.querySelector(".suggestion-title")?.textContent).toBe("Folder/Alpha");
    expect(fileEl.querySelector(".suggestion-note")?.textContent).toBe("Folder/Alpha.md");
    expect(createEl.querySelector(".suggestion-title")?.textContent).toBe("Missing");
    expect(createEl.querySelector(".suggestion-action")?.textContent).toBe("Create new note");
  });

  it("filters markdown, canvas/base, attachments, and all file types through switcher options", async () => {
    const app = new App(document.createElement("div"));
    const controller = new QuickSwitcherController(app);
    await app.vault.create("Note.md", "");
    await app.vault.create("Board.canvas", "");
    await app.vault.create("Table.base", "");
    await app.vault.create("Image.png", "");
    await app.vault.create("Archive.pdf", "");
    await app.vault.create("Raw.bin", "");

    controller.options = {
      showExistingOnly: false,
      showAttachments: false,
      showAllFileTypes: false,
    };
    expect(controller.getItems().map(itemLabel)).toEqual(["Board.canvas", "Note.md", "Table.base"]);

    controller.options = {
      showExistingOnly: false,
      showAttachments: true,
      showAllFileTypes: false,
    };
    expect(controller.getItems().map(itemLabel)).toEqual([
      "Archive.pdf",
      "Board.canvas",
      "Image.png",
      "Note.md",
      "Table.base",
    ]);

    controller.options = {
      showExistingOnly: false,
      showAttachments: false,
      showAllFileTypes: true,
    };
    expect(controller.getItems().map(itemLabel)).toEqual([
      "Archive.pdf",
      "Board.canvas",
      "Image.png",
      "Note.md",
      "Raw.bin",
      "Table.base",
    ]);
  });

  it("does not widen empty-query recent attachments through showAllFileTypes alone", async () => {
    const app = new App(document.createElement("div"));
    const controller = new QuickSwitcherController(app);
    const note = await app.vault.create("Note.md", "");
    const image = await app.vault.create("Image.png", "");
    app.workspace.recentFilePaths = [image.path, note.path];
    controller.options = {
      showExistingOnly: false,
      showAttachments: false,
      showAllFileTypes: true,
    };
    const modal = new QuickSwitcherModal(app, controller);

    expect(modal.getSuggestions("").map((suggestion) => itemLabel(suggestion.item))).toEqual([
      "Note.md",
    ]);
  });

  it("includes unresolved link suggestions and opens them through workspace openLinkText", async () => {
    const app = new App(document.createElement("div"));
    const controller = new QuickSwitcherController(app);
    const source = await app.vault.create("Source.md", "[[Missing Target]]");
    await app.metadataCache.computeFileMetadataAsync(source);
    await vi.waitFor(() =>
      expect(app.metadataCache.unresolvedLinks[source.path]).toEqual({ "Missing Target": 1 }),
    );
    const modal = new QuickSwitcherModal(app, controller);
    const suggestion = modal.getSuggestions("Missing")[0];
    if (!suggestion?.item || suggestion.item.type !== "unresolved")
      throw new Error("missing unresolved suggestion");
    const el = document.createElement("div");
    const openLinkText = vi.spyOn(app.workspace.getLeaf(), "openLinkText").mockResolvedValue();

    modal.renderSuggestion(suggestion, el);
    await controller.choose(suggestion.item, new KeyboardEvent("keydown", { key: "Enter" }));

    expect(el.querySelector(".suggestion-title")?.textContent).toBe("Missing Target");
    expect(el.querySelector(".suggestion-note")).toBeNull();
    expect(el.querySelector<HTMLElement>(".suggestion-flair")?.dataset.icon).toBe(
      "lucide-file-plus",
    );
    expect(el.querySelector<HTMLElement>(".suggestion-flair")?.title).toBe("Not created yet");
    expect(openLinkText).toHaveBeenCalledWith("Missing Target", "", { active: true });
  });
});

function itemLabel(item: QuickSwitcherItem | null): string {
  if (item === null) return "(create)";
  if (item.type === "file") return item.file.path;
  if (item.type === "create") return item.path;
  return item.linktext;
}

function createWrapper(): InternalPluginWrapper {
  return {
    loadData: async () => null,
    addSettingTab: () => {},
  } as unknown as InternalPluginWrapper;
}

function modEnter(): KeyboardEvent {
  const isMac = isMacLike();
  return new KeyboardEvent("keydown", {
    key: "Enter",
    metaKey: isMac,
    ctrlKey: !isMac,
    bubbles: true,
    cancelable: true,
  });
}

function isMacLike(): boolean {
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
}
