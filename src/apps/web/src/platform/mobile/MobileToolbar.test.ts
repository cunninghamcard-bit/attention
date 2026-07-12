import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../app/App";
import { Platform } from "../Platform";
import { MarkdownView } from "../../views/MarkdownView";

describe("MobileToolbar Obsidian command toolbar", () => {
  const realIsMobile = Platform.isMobile;

  beforeEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  afterEach(() => {
    Platform.isMobile = realIsMobile;
  });

  it("uses Obsidian's default mobile toolbar command order from vault config", () => {
    const app = new App(document.createElement("div"));

    expect(app.vault.getConfig("mobilePullAction")).toBe("command-palette:open");
    expect(app.vault.getConfig("mobileToolbarCommands")).toEqual([
      "editor:undo",
      "editor:redo",
      "editor:insert-wikilink",
      "editor:insert-embed",
      "editor:insert-tag",
      "editor:attach-file",
      "editor:set-heading",
      "editor:toggle-bold",
      "editor:toggle-italics",
      "editor:toggle-strikethrough",
      "editor:toggle-highlight",
      "editor:toggle-code",
      "editor:toggle-blockquote",
      "editor:toggle-comment",
      "editor:insert-link",
      "editor:toggle-bullet-list",
      "editor:toggle-numbered-list",
      "editor:toggle-checklist-status",
      "editor:indent-list",
      "editor:unindent-list",
      "editor:configure-toolbar",
    ]);
  });

  it("compiles configured command ids into mobile toolbar option buttons", () => {
    const app = new App(document.createElement("div"));
    app.vault.setConfig("mobileToolbarCommands", [
      "missing-command",
      "editor:insert-wikilink",
      "editor:toggle-bold",
      "editor:insert-link",
    ]);

    app.mobileToolbar.compileToolbar();
    const options = [...app.mobileToolbar.optionsListEl.querySelectorAll<HTMLElement>(".mobile-toolbar-option")];

    expect(options).toHaveLength(3);
    expect(app.mobileToolbar.optionsListContainerEl.className).toBe("mobile-toolbar-options-list-container mod-raised");
    expect(options.map((option) => option.hasAttribute("aria-label"))).toEqual([false, false, false]);
    expect(options.map((option) => option.className)).toEqual([
      "mobile-toolbar-option",
      "mobile-toolbar-option",
      "mobile-toolbar-option",
    ]);
  });

  it("executes command ids from toolbar button clicks and prevents mousedown focus loss", () => {
    const app = new App(document.createElement("div"));
    app.vault.setConfig("mobileToolbarCommands", ["editor:insert-link"]);
    const execute = vi.spyOn(app.commands, "executeCommandById");

    app.mobileToolbar.compileToolbar();
    const option = app.mobileToolbar.optionsListEl.querySelector<HTMLElement>(".mobile-toolbar-option");
    if (!option) throw new Error("Missing toolbar option");
    const mouseDown = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });

    option.dispatchEvent(mouseDown);
    option.dispatchEvent(click);

    expect(mouseDown.defaultPrevented).toBe(true);
    expect(click.defaultPrevented).toBe(true);
    expect(execute).toHaveBeenCalledWith("editor:insert-link", click);
  });

  it("shows while the active editor has focus and hides when focus is lost (mobile only)", async () => {
    Platform.isMobile = true;
    const app = new App(document.createElement("div"));
    const file = await app.vault.create("Toolbar.md", "Alpha");
    const leaf = await app.workspace.openFile(file, { active: true, state: { mode: "source" } });
    const view = leaf.view;
    if (!(view instanceof MarkdownView)) throw new Error("Expected markdown view");
    app.vault.setConfig("mobileToolbarCommands", ["editor:insert-link"]);

    view.editor.focus();
    app.workspace.activeEditor = view;
    app.mobileToolbar.update();

    expect(app.mobileToolbar.isVisible).toBe(true);
    expect(app.dom.appContainerEl.contains(app.mobileToolbar.wrapperEl)).toBe(true);
    expect(app.dom.appContainerEl.contains(app.mobileToolbar.spacerEl)).toBe(true);
    expect(document.body.classList.contains("mod-toolbar-open")).toBe(true);

    view.editor.blur();
    app.mobileToolbar.update();

    expect(app.mobileToolbar.isVisible).toBe(false);
    expect(app.dom.appContainerEl.contains(app.mobileToolbar.wrapperEl)).toBe(false);
    expect(app.dom.appContainerEl.contains(app.mobileToolbar.spacerEl)).toBe(false);
    expect(document.body.classList.contains("mod-toolbar-open")).toBe(false);
  });

  it("never surfaces on desktop even while an editor holds focus", async () => {
    Platform.isMobile = false;
    const app = new App(document.createElement("div"));
    const file = await app.vault.create("Toolbar.md", "Alpha");
    const leaf = await app.workspace.openFile(file, { active: true, state: { mode: "source" } });
    const view = leaf.view;
    if (!(view instanceof MarkdownView)) throw new Error("Expected markdown view");
    app.vault.setConfig("mobileToolbarCommands", ["editor:insert-link"]);

    view.editor.focus();
    app.workspace.activeEditor = view;
    app.mobileToolbar.update();

    expect(app.mobileToolbar.isVisible).toBe(false);
    expect(app.dom.appContainerEl.contains(app.mobileToolbar.wrapperEl)).toBe(false);
    expect(document.body.classList.contains("mod-toolbar-open")).toBe(false);
  });

  it("recompiles when mobileToolbarCommands changes", () => {
    const app = new App(document.createElement("div"));
    app.vault.setConfig("mobileToolbarCommands", ["editor:insert-link"]);
    app.mobileToolbar.compileToolbar();

    expect(app.mobileToolbar.optionsListEl.children).toHaveLength(1);

    app.vault.setConfig("mobileToolbarCommands", ["editor:insert-link", "editor:toggle-bold"]);
    app.mobileToolbar.compileToolbar();

    expect(app.mobileToolbar.optionsListEl.children).toHaveLength(2);
  });
});
