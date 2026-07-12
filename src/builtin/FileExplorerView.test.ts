import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../app/App";
import type { DragSource, FileDragSource, FilesDragSource, FolderDragSource } from "../ui/drag/DragManager";
import { Menu } from "../ui/Menu";
import { TAbstractFile, TFile, TFolder } from "../vault/TAbstractFile";
import { FileExplorerView } from "./FileExplorerView";

describe("FileExplorerView external folder drops", () => {
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
    vi.useRealTimers();
  });

  it("imports external dropped files into the target folder", async () => {
    const app = new App(document.createElement("div"));
    await app.vault.createFolder("Assets");
    await app.vault.createBinary("Assets/image.png", new ArrayBuffer(1));
    const view = await openFileExplorerView(app);
    const folderTitleEl = queryRequired<HTMLElement>(view.contentEl, '.nav-folder-title[data-path="Assets"]');
    const folderEl = closestRequired<HTMLElement>(folderTitleEl, ".tree-item.nav-folder");
    const image = createBrowserFile("image.png", [1, 2, 3]);
    const imageArrayBuffer = vi.spyOn(image, "arrayBuffer");
    const dataTransfer = createDropDataTransfer([image]);

    const dragover = dispatchDragEvent(folderTitleEl, "dragover", dataTransfer);

    expect(dragover.defaultPrevented).toBe(true);
    expect(dataTransfer.dropEffect).toBe("copy");
    expect(folderEl.classList.contains("is-being-dragged-over")).toBe(true);
    expect(imageArrayBuffer).not.toHaveBeenCalled();

    const drop = dispatchDragEvent(folderTitleEl, "drop", dataTransfer);

    expect(drop.defaultPrevented).toBe(true);
    expect(imageArrayBuffer).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => {
      expect(app.vault.getFileByPath("Assets/image 1.png")).not.toBeNull();
    });
  });

  it("keeps non-file internal drag sources out of external folder import", async () => {
    const app = new App(document.createElement("div"));
    await app.vault.createFolder("Assets");
    const file = await app.vault.create("Note.md", "");
    const view = await openFileExplorerView(app);
    const folderTitleEl = queryRequired<HTMLElement>(view.contentEl, '.nav-folder-title[data-path="Assets"]');
    const dataTransfer = createDropDataTransfer([createBrowserFile("external.png", [1])]);
    const source: DragSource = {
      type: "tab-header",
      source: "workspace",
      payload: file,
      elements: [],
    };
    app.dragManager.setSource(source);

    const dragover = dispatchDragEvent(folderTitleEl, "dragover", dataTransfer);

    expect(dragover.defaultPrevented).toBe(false);
    expect(dataTransfer.dropEffect).toBe("none");
    app.dragManager.clearSource();
  });

  it("moves an internal file drag into a target folder", async () => {
    const app = new App(document.createElement("div"));
    await app.vault.createFolder("Assets");
    const note = await app.vault.create("Note.md", "");
    const view = await openFileExplorerView(app);
    const folderTitleEl = queryRequired<HTMLElement>(view.contentEl, '.nav-folder-title[data-path="Assets"]');
    const folderEl = closestRequired<HTMLElement>(folderTitleEl, ".tree-item.nav-folder");
    const dataTransfer = createDropDataTransfer([]);
    app.dragManager.setSource(createFileSource(note));

    const dragover = dispatchDragEvent(folderTitleEl, "dragover", dataTransfer);

    expect(dragover.defaultPrevented).toBe(true);
    expect(dataTransfer.dropEffect).toBe("move");
    expect(folderEl.classList.contains("is-being-dragged-over")).toBe(true);

    const drop = dispatchDragEvent(folderTitleEl, "drop", dataTransfer);

    expect(drop.defaultPrevented).toBe(true);
    await vi.waitFor(() => {
      expect(app.vault.getFileByPath("Assets/Note.md")).not.toBeNull();
    });
    expect(app.vault.getFileByPath("Note.md")).toBeNull();
  });

  it("does not move an internal file when dropped onto its current parent", async () => {
    const app = new App(document.createElement("div"));
    const folder = await app.vault.createFolder("Assets");
    const note = await app.vault.create("Assets/Note.md", "");
    const rename = vi.spyOn(app.fileManager, "renameAbstractFile");
    const view = await openFileExplorerView(app);
    const folderTitleEl = queryRequired<HTMLElement>(view.contentEl, '.nav-folder-title[data-path="Assets"]');
    const dataTransfer = createDropDataTransfer([]);
    app.dragManager.setSource(createFileSource(note));

    const dragover = dispatchDragEvent(folderTitleEl, "dragover", dataTransfer);
    const drop = dispatchDragEvent(folderTitleEl, "drop", dataTransfer);

    expect(note.parent).toBe(folder);
    expect(dragover.defaultPrevented).toBe(false);
    expect(drop.defaultPrevented).toBe(false);
    expect(rename).not.toHaveBeenCalled();
    app.dragManager.clearSource();
  });

  it("rejects dropping a folder into one of its descendants", async () => {
    const app = new App(document.createElement("div"));
    const parent = await app.vault.createFolder("Parent");
    await app.vault.createFolder("Parent/Child");
    const view = await openFileExplorerView(app);
    const childTitleEl = queryRequired<HTMLElement>(view.contentEl, '.nav-folder-title[data-path="Parent/Child"]');
    const dataTransfer = createDropDataTransfer([]);
    app.dragManager.setSource(createFolderSource(parent));

    const dragover = dispatchDragEvent(childTitleEl, "dragover", dataTransfer);

    expect(dragover.defaultPrevented).toBe(false);
    expect(dataTransfer.dropEffect).toBe("none");
    app.dragManager.clearSource();
  });

  it("filters selected descendants when moving multi-file explorer drags", async () => {
    const app = new App(document.createElement("div"));
    await app.vault.createFolder("Target");
    const parent = await app.vault.createFolder("Parent");
    const child = await app.vault.create("Parent/Child.md", "");
    const view = await openFileExplorerView(app);
    const targetTitleEl = queryRequired<HTMLElement>(view.contentEl, '.nav-folder-title[data-path="Target"]');
    const dataTransfer = createDropDataTransfer([]);
    app.dragManager.setSource(createFilesSource([parent, child]));

    const drop = dispatchDragEvent(targetTitleEl, "drop", dataTransfer);

    expect(drop.defaultPrevented).toBe(true);
    await vi.waitFor(() => {
      expect(app.vault.getFolderByPath("Target/Parent")).not.toBeNull();
    });
    expect(app.vault.getFileByPath("Target/Parent/Child.md")).not.toBeNull();
    expect(app.vault.getFileByPath("Target/Child.md")).toBeNull();
  });

  it("moves internal file drags back to the root container", async () => {
    const app = new App(document.createElement("div"));
    await app.vault.createFolder("Folder");
    const note = await app.vault.create("Folder/Note.md", "");
    const view = await openFileExplorerView(app);
    const rootEl = queryRequired<HTMLElement>(view.contentEl, ".nav-files-container.node-insert-event");
    const dataTransfer = createDropDataTransfer([]);
    app.dragManager.setSource(createFileSource(note));

    const drop = dispatchDragEvent(rootEl, "drop", dataTransfer);

    expect(drop.defaultPrevented).toBe(true);
    await vi.waitFor(() => {
      expect(app.vault.getFileByPath("Note.md")).not.toBeNull();
    });
    expect(app.vault.getFileByPath("Folder/Note.md")).toBeNull();
  });

  it("auto-expands collapsed folders after a folder drop hover delay", async () => {
    vi.useFakeTimers();
    const app = new App(document.createElement("div"));
    await app.vault.createFolder("Folder");
    const loose = await app.vault.create("Loose.md", "");
    const view = await openFileExplorerView(app);
    const folderTitleEl = queryRequired<HTMLElement>(view.contentEl, '.nav-folder-title[data-path="Folder"]');
    folderTitleEl.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(queryRequired<HTMLElement>(view.contentEl, ".tree-item.nav-folder").classList.contains("is-collapsed")).toBe(true);
    app.dragManager.setSource(createFileSource(loose));

    dispatchDragEvent(queryRequired<HTMLElement>(view.contentEl, '.nav-folder-title[data-path="Folder"]'), "dragover", createDropDataTransfer([]));
    await vi.advanceTimersByTimeAsync(749);
    expect(queryRequired<HTMLElement>(view.contentEl, ".tree-item.nav-folder").classList.contains("is-collapsed")).toBe(true);
    await vi.advanceTimersByTimeAsync(1);

    expect(queryRequired<HTMLElement>(view.contentEl, ".tree-item.nav-folder").classList.contains("is-collapsed")).toBe(false);
    app.dragManager.clearSource();
  });

  it("opens files-menu from a multi-selected file explorer context", async () => {
    const app = new App(document.createElement("div"));
    await app.vault.createFolder("Folder");
    const note = await app.vault.create("Folder/Note.md", "");
    const other = await app.vault.create("Other.md", "");
    const view = await openFileExplorerView(app);
    const folderTitleEl = queryRequired<HTMLElement>(view.contentEl, '.nav-folder-title[data-path="Folder"]');
    const otherTitleEl = queryRequired<HTMLElement>(view.contentEl, '.nav-file-title[data-path="Other.md"]');
    const events: Array<{ paths: string[]; source: string }> = [];
    app.workspace.on("files-menu", (menu, files, source) => {
      events.push({ paths: (files as TAbstractFile[]).map((file) => file.path), source: source as string });
      (menu as Menu).addItem((item) => item.setTitle("Plugin batch action"));
    });

    folderTitleEl.dispatchEvent(new MouseEvent("click", { bubbles: true, altKey: true }));
    otherTitleEl.dispatchEvent(new MouseEvent("click", { bubbles: true, altKey: true }));
    otherTitleEl.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));

    expect(events).toEqual([{ paths: ["Folder", "Other.md"], source: "file-explorer-context-menu" }]);
    expect(document.body.textContent).toContain("New folder with selection (2 items)");
    expect(document.body.querySelector<HTMLElement>(".menu-item.is-warning .menu-item-title")?.textContent).toBe("Delete");
    expect(document.body.textContent).toContain("Plugin batch action");
    expect(app.vault.getFileByPath(note.path)).toBe(note);
  });

  it("creates a new folder with the selected files and starts inline rename", async () => {
    const app = new App(document.createElement("div"));
    await app.vault.createFolder("Folder");
    await app.vault.create("Folder/Note.md", "");
    await app.vault.create("Other.md", "");
    const view = await openFileExplorerView(app);
    const folderTitleEl = queryRequired<HTMLElement>(view.contentEl, '.nav-folder-title[data-path="Folder"]');
    const otherTitleEl = queryRequired<HTMLElement>(view.contentEl, '.nav-file-title[data-path="Other.md"]');

    folderTitleEl.dispatchEvent(new MouseEvent("click", { bubbles: true, altKey: true }));
    otherTitleEl.dispatchEvent(new MouseEvent("click", { bubbles: true, altKey: true }));
    otherTitleEl.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
    clickMenuItem("New folder with selection (2 items)");

    await vi.waitFor(() => {
      expect(app.vault.getFolderByPath("Untitled")).not.toBeNull();
      expect(app.vault.getFolderByPath("Untitled/Folder")).not.toBeNull();
      expect(app.vault.getFileByPath("Untitled/Folder/Note.md")).not.toBeNull();
      expect(app.vault.getFileByPath("Untitled/Other.md")).not.toBeNull();
    });
    expect(queryRequired<HTMLElement>(view.contentEl, '.nav-folder-title[data-path="Untitled"]').classList.contains("is-being-renamed")).toBe(true);
    expect(queryRequired<HTMLElement>(view.contentEl, '.nav-folder-title[data-path="Untitled/Folder"]').classList.contains("is-selected")).toBe(false);
    expect(queryRequired<HTMLElement>(view.contentEl, '.nav-file-title[data-path="Untitled/Other.md"]').classList.contains("is-selected")).toBe(false);
  });

  it("uses filtered root count when creating a folder with selected descendants", async () => {
    const app = new App(document.createElement("div"));
    await app.vault.createFolder("Folder");
    await app.vault.create("Folder/Note.md", "");
    const view = await openFileExplorerView(app);
    const folderTitleEl = queryRequired<HTMLElement>(view.contentEl, '.nav-folder-title[data-path="Folder"]');
    const noteTitleEl = queryRequired<HTMLElement>(view.contentEl, '.nav-file-title[data-path="Folder/Note.md"]');

    folderTitleEl.dispatchEvent(new MouseEvent("click", { bubbles: true, altKey: true }));
    noteTitleEl.dispatchEvent(new MouseEvent("click", { bubbles: true, altKey: true }));
    noteTitleEl.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));

    expect(document.body.textContent).toContain("New folder with selection (1 item)");
    clickMenuItem("New folder with selection (1 item)");

    await vi.waitFor(() => {
      expect(app.vault.getFolderByPath("Folder/Untitled")).not.toBeNull();
      expect(app.vault.getFolderByPath("Folder/Untitled/Folder")).toBeNull();
    });
  });

  it("renames files inline from the file explorer context menu", async () => {
    const app = new App(document.createElement("div"));
    const note = await app.vault.create("Note.md", "");
    const view = await openFileExplorerView(app);
    const fileTitleEl = queryRequired<HTMLElement>(view.contentEl, '.nav-file-title[data-path="Note.md"]');
    const events: Array<{ path: string; source: string }> = [];
    app.workspace.on("file-menu", (menu, file, source) => {
      events.push({ path: (file as TAbstractFile).path, source: source as string });
      (menu as Menu).addItem((item) => item.setTitle("Plugin file action"));
    });

    fileTitleEl.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
    expect(events).toEqual([{ path: note.path, source: "file-explorer-context-menu" }]);
    const menuTitles = [...document.body.querySelectorAll(".menu-item-title")].map((el) => el.textContent);
    expect(menuTitles).toContain("Open in new tab");
    expect(menuTitles).toContain("Open to the right");
    expect(menuTitles).toContain("Make copy");
    expect(menuTitles).toContain("Rename");
    expect(menuTitles).toContain("Delete");
    expect(menuTitles).toContain("Plugin file action");
    clickMenuItem("Rename");
    await vi.waitFor(() => {
      expect(queryRequired<HTMLElement>(view.contentEl, '.nav-file-title[data-path="Note.md"]').classList.contains("is-being-renamed")).toBe(true);
    });
    const innerEl = queryRequired<HTMLElement>(view.contentEl, '.nav-file-title[data-path="Note.md"] .nav-file-title-content');

    expect(innerEl.getAttribute("contenteditable")).toBe("true");
    expect(innerEl.getAttribute("spellcheck")).toBe(String(app.vault.getConfig("spellcheck") ?? false));

    innerEl.textContent = "Unsafe#Name";
    innerEl.dispatchEvent(new InputEvent("input", { bubbles: true }));
    expect(innerEl.classList.contains("mod-warning")).toBe(true);
    expect(innerEl.title).toContain("unsafe characters");

    innerEl.textContent = "Renamed";
    innerEl.dispatchEvent(new InputEvent("input", { bubbles: true }));
    expect(innerEl.classList.contains("mod-warning")).toBe(false);
    innerEl.dispatchEvent(new FocusEvent("blur"));

    expect(fileTitleEl.classList.contains("is-being-renamed")).toBe(false);
    expect(innerEl.hasAttribute("contenteditable")).toBe(false);
    expect(innerEl.hasAttribute("spellcheck")).toBe(false);

    await vi.waitFor(() => {
      expect(app.vault.getFileByPath("Renamed.md")).not.toBeNull();
    });
    expect(app.vault.getFileByPath("Note.md")).toBeNull();
  });

  it("keeps file explorer inline rename open for hard validation errors", async () => {
    const app = new App(document.createElement("div"));
    await app.vault.create("Note.md", "");
    await app.vault.create("Other.md", "");
    const view = await openFileExplorerView(app);
    const fileTitleEl = queryRequired<HTMLElement>(view.contentEl, '.nav-file-title[data-path="Note.md"]');

    fileTitleEl.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
    clickMenuItem("Rename");
    await vi.waitFor(() => {
      expect(queryRequired<HTMLElement>(view.contentEl, '.nav-file-title[data-path="Note.md"]').classList.contains("is-being-renamed")).toBe(true);
    });
    const innerEl = queryRequired<HTMLElement>(view.contentEl, '.nav-file-title[data-path="Note.md"] .nav-file-title-content');

    innerEl.textContent = "Other";
    innerEl.dispatchEvent(new InputEvent("input", { bubbles: true }));
    innerEl.dispatchEvent(new FocusEvent("blur"));

    expect(innerEl.classList.contains("mod-error")).toBe(true);
    expect(innerEl.title).toBe("File already exists");
    expect(innerEl.getAttribute("contenteditable")).toBe("true");
    expect(app.vault.getFileByPath("Note.md")).not.toBeNull();
    expect(app.vault.getFileByPath("Other.md")).not.toBeNull();
  });

  it("builds root and folder context menus through the file explorer file-menu hook", async () => {
    const app = new App(document.createElement("div"));
    const folder = await app.vault.createFolder("Folder");
    await app.vault.create("Folder/Note.md", "");
    const view = await openFileExplorerView(app);
    const events: Array<{ path: string; source: string }> = [];
    app.workspace.on("file-menu", (menu, file, source) => {
      events.push({ path: (file as TAbstractFile).path, source: source as string });
      (menu as Menu).addItem((item) => item.setTitle("Plugin file action"));
    });

    queryRequired<HTMLElement>(view.contentEl, ".nav-header")
      .dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));

    let menuTitles = [...document.body.querySelectorAll(".menu-item-title")].map((el) => el.textContent);
    expect(events.at(-1)).toEqual({ path: "/", source: "file-explorer-context-menu" });
    expect(menuTitles).toContain("New note");
    expect(menuTitles).toContain("New folder");
    expect(menuTitles).not.toContain("Rename");
    expect(menuTitles).not.toContain("Delete");
    expect(menuTitles).toContain("Plugin file action");

    document.body.querySelector<HTMLElement>(".menu")?.remove();
    queryRequired<HTMLElement>(view.contentEl, '.nav-folder-title[data-path="Folder"]')
      .dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));

    menuTitles = [...document.body.querySelectorAll(".menu-item-title")].map((el) => el.textContent);
    expect(events.at(-1)).toEqual({ path: folder.path, source: "file-explorer-context-menu" });
    expect(menuTitles).toContain("New note");
    expect(menuTitles).toContain("New folder");
    expect(menuTitles).toContain("Rename");
    expect(menuTitles).toContain("Make copy");
    expect(menuTitles).toContain("Delete");
    expect(document.body.querySelector<HTMLElement>(".menu-item.is-warning .menu-item-title")?.textContent).toBe("Delete");

    clickMenuItem("Make copy");
    await vi.waitFor(() => {
      expect(app.vault.getFolderByPath("Folder 1")).not.toBeNull();
    });
  });

  it("starts inline folder rename after creating a new folder from the file explorer action", async () => {
    const app = new App(document.createElement("div"));
    const view = await openFileExplorerView(app);
    const newFolderButton = queryRequired<HTMLElement>(view.contentEl, '.nav-action-button[aria-label="New folder"]');

    newFolderButton.click();

    await vi.waitFor(() => {
      expect(queryRequired<HTMLElement>(view.contentEl, '.nav-folder-title[data-path="Untitled"]').classList.contains("is-being-renamed")).toBe(true);
    });
    const innerEl = queryRequired<HTMLElement>(view.contentEl, '.nav-folder-title[data-path="Untitled"] .nav-folder-title-content');
    innerEl.textContent = "Projects";
    innerEl.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));

    await vi.waitFor(() => {
      expect(app.vault.getFolderByPath("Projects")).not.toBeNull();
    });
    expect(app.vault.getFolderByPath("Untitled")).toBeNull();
  });

  it("restores a file basename and exits inline rename on Escape", async () => {
    const app = new App(document.createElement("div"));
    await app.vault.create("Note.md", "");
    const view = await openFileExplorerView(app);
    const fileTitleEl = queryRequired<HTMLElement>(view.contentEl, '.nav-file-title[data-path="Note.md"]');

    fileTitleEl.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
    clickMenuItem("Rename");
    await vi.waitFor(() => {
      expect(queryRequired<HTMLElement>(view.contentEl, '.nav-file-title[data-path="Note.md"]').classList.contains("is-being-renamed")).toBe(true);
    });
    const innerEl = queryRequired<HTMLElement>(view.contentEl, '.nav-file-title[data-path="Note.md"] .nav-file-title-content');

    innerEl.textContent = "Draft";
    innerEl.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));

    expect(innerEl.textContent).toBe("Note");
    expect(fileTitleEl.classList.contains("is-being-renamed")).toBe(false);
    expect(innerEl.hasAttribute("contenteditable")).toBe(false);
    expect(app.vault.getFileByPath("Note.md")).not.toBeNull();
    expect(app.vault.getFileByPath("Draft.md")).toBeNull();
  });

  it("starts inline rename for the focused tree item on F2", async () => {
    const app = new App(document.createElement("div"));
    await app.vault.create("Alpha.md", "");
    await app.vault.create("Beta.md", "");
    const view = await openFileExplorerView(app);
    const betaEl = queryRequired<HTMLElement>(view.contentEl, '.nav-file-title[data-path="Beta.md"]');

    betaEl.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, altKey: true }));
    view.contentEl.dispatchEvent(new KeyboardEvent("keydown", { key: "F2", bubbles: true, cancelable: true }));

    await vi.waitFor(() => {
      expect(queryRequired<HTMLElement>(view.contentEl, '.nav-file-title[data-path="Beta.md"]').classList.contains("is-being-renamed")).toBe(true);
    });
    expect(queryRequired<HTMLElement>(view.contentEl, '.nav-file-title[data-path="Alpha.md"]').classList.contains("is-being-renamed")).toBe(false);
  });

  it("keeps normal file clicks separate from tree focus and selection", async () => {
    const app = new App(document.createElement("div"));
    const note = await app.vault.create("Note.md", "");
    const view = await openFileExplorerView(app);
    const openFile = vi.spyOn(app.workspace, "openFile");
    const noteEl = queryRequired<HTMLElement>(view.contentEl, '.nav-file-title[data-path="Note.md"]');

    noteEl.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    expect(openFile).toHaveBeenCalledTimes(1);
    expect(noteEl.classList.contains("is-selected")).toBe(false);
    expect(noteEl.classList.contains("has-focus")).toBe(false);
    view.contentEl.dispatchEvent(new KeyboardEvent("keydown", { key: "F2", bubbles: true, cancelable: true }));
    expect(noteEl.classList.contains("is-being-renamed")).toBe(false);

    await vi.waitFor(() => {
      expect(app.workspace.activeEditor?.file).toBe(note);
    });
    const activeNoteEl = queryRequired<HTMLElement>(view.contentEl, '.nav-file-title[data-path="Note.md"]');
    activeNoteEl.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    expect(openFile).toHaveBeenCalledTimes(1);
    expect(activeNoteEl.classList.contains("is-selected")).toBe(false);
    expect(activeNoteEl.classList.contains("has-focus")).toBe(true);
  });

  it("starts inline folder rename from the newFile view state", async () => {
    const app = new App(document.createElement("div"));
    const folder = await app.vault.createFolder("State Folder");
    const view = await openFileExplorerView(app);

    await view.setState({ newFile: folder.path });

    await vi.waitFor(() => {
      expect(queryRequired<HTMLElement>(view.contentEl, '.nav-folder-title[data-path="State Folder"]').classList.contains("is-being-renamed")).toBe(true);
    });
  });

  it("opens newly created notes with rename ephemeral state", async () => {
    const app = new App(document.createElement("div"));
    const view = await openFileExplorerView(app);
    const newNoteButton = queryRequired<HTMLElement>(view.contentEl, '.nav-action-button[aria-label="New note"]');
    const openFile = vi.spyOn(app.workspace, "openFile");

    newNoteButton.click();

    await vi.waitFor(() => {
      expect(openFile).toHaveBeenCalled();
    });
    expect(openFile.mock.calls[0]?.[1]).toMatchObject({
      active: true,
      state: { mode: "source" },
      eState: { rename: "all" },
    });
  });

  it("renders Obsidian tree item wrappers for files and folders", async () => {
    const app = new App(document.createElement("div"));
    await app.vault.createFolder("Folder");
    await app.vault.create("Folder/Note.md", "");
    const view = await openFileExplorerView(app);

    const folderEl = queryRequired<HTMLElement>(view.contentEl, ".tree-item.nav-folder");
    const folderTitleEl = queryRequired<HTMLElement>(folderEl, ".tree-item-self.nav-folder-title.is-clickable");
    const fileEl = queryRequired<HTMLElement>(view.contentEl, ".tree-item.nav-file");
    const fileTitleEl = queryRequired<HTMLElement>(fileEl, ".tree-item-self.nav-file-title.is-clickable");

    expect(folderEl.dataset.path).toBeUndefined();
    expect(folderTitleEl.dataset.path).toBe("Folder");
    expect(folderTitleEl.querySelector(".tree-item-icon.collapse-icon")).not.toBeNull();
    expect(folderTitleEl.querySelector(".tree-item-inner.nav-folder-title-content")?.textContent).toBe("Folder");
    expect(fileEl.dataset.path).toBeUndefined();
    expect(fileTitleEl.dataset.path).toBe("Folder/Note.md");
    expect(fileTitleEl.querySelector(".tree-item-inner.nav-file-title-content")?.textContent).toBe("Note.md");
  });

  it("creates file and folder drag sources from tree titles", async () => {
    const app = new App(document.createElement("div"));
    await app.vault.createFolder("Folder");
    const note = await app.vault.create("Folder/Note.md", "");
    const view = await openFileExplorerView(app);
    const folderTitleEl = queryRequired<HTMLElement>(view.contentEl, '.nav-folder-title[data-path="Folder"]');
    const fileTitleEl = queryRequired<HTMLElement>(view.contentEl, '.nav-file-title[data-path="Folder/Note.md"]');

    dispatchDragEvent(fileTitleEl, "dragstart", createDropDataTransfer([]));
    const fileSource = app.dragManager.getSource() as FileDragSource;
    expect(fileSource.type).toBe("file");
    expect(fileSource.source).toBeUndefined();
    expect(fileSource.file).toBe(note);
    expect(fileTitleEl.classList.contains("is-being-dragged")).toBe(true);
    app.dragManager.clearSource();

    dispatchDragEvent(folderTitleEl, "dragstart", createDropDataTransfer([]));
    const folderSource = app.dragManager.getSource() as FolderDragSource;
    expect(folderSource.type).toBe("folder");
    expect(folderSource.source).toBeUndefined();
    expect(folderSource.file.path).toBe("Folder");
    expect(folderTitleEl.classList.contains("is-being-dragged")).toBe(true);
  });

  it("uses Alt/Shift tree selection and drags selected files in visual order", async () => {
    const app = new App(document.createElement("div"));
    await app.vault.create("Alpha.md", "");
    await app.vault.create("Beta.md", "");
    await app.vault.create("Gamma.md", "");
    const view = await openFileExplorerView(app);
    const alphaEl = queryRequired<HTMLElement>(view.contentEl, '.nav-file-title[data-path="Alpha.md"]');
    const betaEl = queryRequired<HTMLElement>(view.contentEl, '.nav-file-title[data-path="Beta.md"]');
    const gammaEl = queryRequired<HTMLElement>(view.contentEl, '.nav-file-title[data-path="Gamma.md"]');
    setOffsetTop(alphaEl, 30);
    setOffsetTop(betaEl, 10);
    setOffsetTop(gammaEl, 20);

    alphaEl.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, altKey: true }));
    gammaEl.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, shiftKey: true }));

    expect(alphaEl.classList.contains("has-focus")).toBe(true);
    expect(gammaEl.classList.contains("has-focus")).toBe(false);
    expect([alphaEl, betaEl, gammaEl].every((el) => el.classList.contains("is-selected"))).toBe(true);

    dispatchDragEvent(alphaEl, "dragstart", createDropDataTransfer([]));

    const source = app.dragManager.getSource() as FilesDragSource;
    expect(source.type).toBe("files");
    expect(source.source).toBeUndefined();
    expect(source.files.map((file) => file.path)).toEqual(["Beta.md", "Gamma.md", "Alpha.md"]);
    expect([alphaEl, betaEl, gammaEl].every((el) => !el.classList.contains("is-being-dragged"))).toBe(true);
    expect([alphaEl, betaEl, gammaEl].every((el) => el.closest(".tree-item")?.classList.contains("is-being-dragged"))).toBe(true);
  });
});

async function openFileExplorerView(app: App): Promise<FileExplorerView> {
  await app.corePluginsReady;
  const leaf = app.workspace.getLeaf(true);
  await leaf.setViewState({ type: "file-explorer", active: true });
  expect(leaf.view).toBeInstanceOf(FileExplorerView);
  return leaf.view as FileExplorerView;
}

function queryRequired<T extends Element>(parent: ParentNode, selector: string): T {
  const el = parent.querySelector<T>(selector);
  if (!el) throw new Error(`Missing selector: ${selector}`);
  return el;
}

function closestRequired<T extends Element>(el: Element, selector: string): T {
  const match = el.closest<T>(selector);
  if (!match) throw new Error(`Missing closest selector: ${selector}`);
  return match;
}

function clickMenuItem(title: string): void {
  const item = [...document.body.querySelectorAll<HTMLElement>(".menu-item")]
    .find((el) => el.querySelector(".menu-item-title")?.textContent === title);
  if (!item) throw new Error(`Missing menu item: ${title}`);
  item.click();
}

function dispatchDragEvent(target: HTMLElement, type: string, dataTransfer: DataTransfer): DragEvent {
  const event = new Event(type, { bubbles: true, cancelable: true }) as DragEvent;
  Object.defineProperty(event, "dataTransfer", { configurable: true, value: dataTransfer });
  target.dispatchEvent(event);
  return event;
}

function createDropDataTransfer(files: File[]): DataTransfer {
  const items = files.map((file) => ({
    kind: "file",
    type: file.type,
    getAsFile: () => file,
  })) as DataTransferItem[];
  return {
    dropEffect: "none",
    effectAllowed: "all",
    files: files as unknown as FileList,
    items: items as unknown as DataTransferItemList,
    types: [],
    clearData: () => {},
    getData: () => "",
    setData: () => {},
    setDragImage: () => {},
  } as unknown as DataTransfer;
}

function createBrowserFile(name: string, bytes: number[]): File {
  return new File([new Uint8Array(bytes)], name);
}

function createFileSource(file: TFile): FileDragSource {
  return {
    type: "file",
    payload: file,
    elements: [],
    file,
  };
}

function createFilesSource(files: Array<TFile | TFolder>): FilesDragSource {
  return {
    type: "files",
    payload: files,
    elements: [],
    files,
  };
}

function createFolderSource(file: TFolder): FolderDragSource {
  return {
    type: "folder",
    payload: file,
    elements: [],
    file,
  };
}

function setOffsetTop(el: HTMLElement, value: number): void {
  Object.defineProperty(el, "offsetTop", { configurable: true, value });
}
