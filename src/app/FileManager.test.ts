import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

describe("FileManager", () => {
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
    document.body.querySelectorAll(".modal-container").forEach((el) => el.remove());
  });

  it("uses Files and links settings for new note location", async () => {
    const app = new App(document.createElement("div"));
    app.vault.setConfig("newFileLocation", "folder");
    app.vault.setConfig("newFileFolderPath", "Inbox");

    const file = await app.fileManager.createNewMarkdownFile(null);

    expect(file.path).toBe("Inbox/Untitled.md");
  });

  it("falls back to Markdown parent creation for unregistered extensions", async () => {
    const app = new App(document.createElement("div"));
    await app.vault.create("Notes/Source.md", "");
    app.vault.setConfig("newFileLocation", "folder");
    app.vault.setConfig("newFileFolderPath", "Inbox");
    app.vault.setConfig("attachmentFolderPath", "./assets");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(app.fileManager.getNewFileParent("Notes/Source.md", "Draft.md").path).toBe("Inbox");
    expect(app.fileManager.getNewFileParent("Notes/Source.md", "Board.canvas").path).toBe("Inbox");
    expect(app.fileManager.getNewFileParent("Notes/Source.md", "image.png").path).toBe("Inbox");
    expect(consoleError).toHaveBeenCalledWith("No file creator assigned to create file with extension canvas. Falling back to Markdown file creator.");
    expect(consoleError).toHaveBeenCalledWith("No file creator assigned to create file with extension png. Falling back to Markdown file creator.");

    app.vault.setConfig("newFileLocation", "current");
    expect(app.fileManager.getNewFileParent("Notes/Source.md", "clip.webm").path).toBe("Notes");
  });

  it("supports Obsidian's file parent creator registry by extension", async () => {
    const app = new App(document.createElement("div"));
    const folder = await app.vault.createFolder("Drawings");

    expect(app.fileManager.canCreateFileWithExt("md")).toBe(true);
    expect(app.fileManager.canCreateFileWithExt("excalidraw")).toBe(false);

    app.fileManager.registerFileParentCreator("excalidraw", () => folder);

    expect(app.fileManager.canCreateFileWithExt("excalidraw")).toBe(true);
    expect(app.fileManager.getNewFileParent("Notes/Source.md", "Sketch.excalidraw")).toBe(folder);

    app.fileManager.registerFileParentCreator(".map", () => folder);
    expect(app.fileManager.canCreateFileWithExt(".map")).toBe(true);
    expect(app.fileManager.canCreateFileWithExt("map")).toBe(false);

    app.fileManager.unregisterFileCreator("excalidraw");

    expect(app.fileManager.canCreateFileWithExt("excalidraw")).toBe(false);
    expect(app.fileManager.canCreateFileWithExt(".map")).toBe(true);
  });

  it("creates files with explicit extension and initial data", async () => {
    const app = new App(document.createElement("div"));
    const folder = await app.vault.createFolder("Drafts");

    const file = await app.fileManager.createNewFile(folder, "Seed.md", "md", "# Seed");
    const sibling = await app.fileManager.createNewFile("Drafts", "Seed.md", "md", "# Next");
    // A registered creator keeps its extension (the real coercion gate).
    app.fileManager.registerFileParentCreator("json", () => app.vault.getRoot());
    const dataFile = await app.fileManager.createNewFile("Data", "payload", "json", "{\"ok\":true}");

    expect(file.path).toBe("Drafts/Seed.md");
    expect(await app.vault.read(file)).toBe("# Seed");
    expect(sibling.path).toBe("Drafts/Seed 1.md");
    expect(await app.vault.read(sibling)).toBe("# Next");
    expect(dataFile.path).toBe("Data/payload.json");
    expect(await app.vault.read(dataFile)).toBe("{\"ok\":true}");
  });

  it("creates markdown files from linktext using source-relative parent rules", async () => {
    const app = new App(document.createElement("div"));
    app.vault.setConfig("newFileLocation", "current");
    await app.vault.createFolder("Notes");

    const file = await app.fileManager.createNewMarkdownFileFromLinktext("Missing#Heading|Alias", "Notes/Source.md");
    const nested = await app.fileManager.createNewMarkdownFileFromLinktext("Projects/New note.md", "Notes/Source.md");

    expect(file.path).toBe("Notes/Missing.md");
    expect(nested.path).toBe("Projects/New note.md");
    await expect(app.fileManager.createNewMarkdownFileFromLinktext("Bad:Name", "Notes/Source.md")).rejects.toThrow(/invalid characters/i);
  });

  it("generates links from link format and markdown-link settings", async () => {
    const app = new App(document.createElement("div"));
    const file = await app.vault.create("Notes/Target.md", "");

    expect(app.fileManager.generateMarkdownLink(file, "Notes/Source.md")).toBe("[[Target]]");

    app.vault.setConfig("newLinkFormat", "relative");
    app.vault.setConfig("useMarkdownLinks", true);

    expect(app.fileManager.generateMarkdownLink(file, "Daily/Today.md", "#Heading", "Alias")).toBe("[Alias](../Notes/Target.md#Heading)");
  });

  it("generates Obsidian linktext separately from full markdown links", async () => {
    const app = new App(document.createElement("div"));
    const note = await app.vault.create("Notes/Target.md", "");
    const image = await app.vault.createBinary("Assets/image.png", new ArrayBuffer(1));

    expect(app.fileManager.fileToLinktext(note, "Daily/Today.md", true)).toBe("Target");
    expect(app.fileManager.fileToLinktext(image, "Daily/Today.md", true)).toBe("image.png");

    app.vault.setConfig("newLinkFormat", "relative");

    expect(app.fileManager.fileToLinktext(note, "Daily/Today.md", true)).toBe("../Notes/Target");
    expect(app.fileManager.fileToLinktext(image, "Daily/Today.md", true)).toBe("../Assets/image.png");
    expect(app.fileManager.generateMarkdownLink(note, "Daily/Today.md")).toBe("[[../Notes/Target.md]]");
  });

  it("merges inserted frontmatter into one properties block", async () => {
    const app = new App(document.createElement("div"));
    const file = await app.vault.create("Merge.md", "---\ntags:\n  - old\nstatus: draft\n---\nExisting");

    await app.fileManager.insertIntoFile(file, "---\ntags:\n  - new\naliases:\n  - Alias\n---\nIncoming");

    expect(await app.vault.read(file)).toBe([
      "---",
      "tags:",
      "  - old",
      "  - new",
      "status: draft",
      "aliases:",
      "  - Alias",
      "---",
      "Existing",
      "",
      "Incoming",
    ].join("\n"));
  });

  it("moves deleted files to the vault trash folder when trashOption is local", async () => {
    const app = new App(document.createElement("div"));
    app.vault.setConfig("trashOption", "local");
    const file = await app.vault.create("Delete me.md", "");

    const deletion = app.fileManager.deleteFile(file);
    const modal = await waitForModal();

    expect(modal.textContent).toContain("Delete file");
    expect(modal.textContent).toContain("vault trash");
    clickModalButton("Delete");
    await deletion;

    expect(app.vault.getFileByPath("Delete me.md")).toBeNull();
    expect(app.vault.getFileByPath(".trash/Delete me.md")).not.toBeNull();
  });

  it("cancels deletion from the delete confirmation modal", async () => {
    const app = new App(document.createElement("div"));
    const file = await app.vault.create("Keep.md", "");

    const deletion = app.fileManager.deleteFile(file);
    await waitForModal();

    clickModalButton("Cancel");

    await expect(deletion).resolves.toBe(false);
    expect(app.vault.getFileByPath("Keep.md")).toBe(file);
  });

  it("can disable future delete confirmations from the delete modal", async () => {
    const app = new App(document.createElement("div"));
    const first = await app.vault.create("First.md", "");
    const second = await app.vault.create("Second.md", "");

    const firstDeletion = app.fileManager.deleteFile(first);
    const modal = await waitForModal();
    modal.querySelector<HTMLInputElement>(".delete-confirm-checkbox input")!.checked = true;
    clickModalButton("Delete");
    await firstDeletion;

    expect(app.vault.getConfig("promptDelete")).toBe(false);

    await app.fileManager.deleteFile(second);

    expect(app.vault.getFileByPath("Second.md")).toBeNull();
  });

  it("shows non-empty folder warnings in the delete confirmation modal", async () => {
    const app = new App(document.createElement("div"));
    const folder = await app.vault.createFolder("Folder");
    await app.vault.create("Folder/Child.md", "");

    const deletion = app.fileManager.deleteFile(folder);
    const modal = await waitForModal();

    expect(modal.textContent).toContain("Delete folder");
    expect(modal.textContent).toContain("not empty");
    expect(modal.textContent).toContain("delete all files inside");
    clickModalButton("Cancel");
    await deletion;
  });

  it("shows backlink warnings in the delete confirmation modal", async () => {
    const app = new App(document.createElement("div"));
    const target = await app.vault.create("Target.md", "");
    const source = await app.vault.create("Source.md", "[[Target]]");
    await app.metadataCache.computeFileMetadata(source);

    const deletion = app.fileManager.deleteFile(target);
    const modal = await waitForModal();

    expect(modal.textContent).toContain("1 existing backlink points");
    clickModalButton("Cancel");
    await deletion;
  });

  it("updates internal wiki, embed, and markdown links after renaming when enabled", async () => {
    const app = new App(document.createElement("div"));
    app.vault.setConfig("alwaysUpdateLinks", true);
    app.vault.setConfig("newLinkFormat", "relative");
    const target = await app.vault.create("Notes/Old target.md", "# Heading");
    const source = await app.vault.create("Daily/Source.md", [
      "[[../Notes/Old target]]",
      "![[../Notes/Old target#Heading|Shown]]",
      "[markdown](../Notes/Old%20target.md#Heading)",
    ].join("\n"));
    await app.metadataCache.computeFileMetadata(target);
    await app.metadataCache.computeFileMetadata(source);

    await app.fileManager.renameFile(target, "Notes/New target.md");

    expect(await app.vault.read(source)).toBe([
      "[[../Notes/New target]]",
      "![[../Notes/New target#Heading|Shown]]",
      "[markdown](../Notes/New%20target.md#Heading)",
    ].join("\n"));
  });

  it("matches the public renameFile contract by resolving void", async () => {
    const app = new App(document.createElement("div"));
    const file = await app.vault.create("Old.md", "");

    await expect(app.fileManager.renameFile(file, "New.md")).resolves.toBeUndefined();

    expect(app.vault.getFileByPath("Old.md")).toBeNull();
    expect(app.vault.getFileByPath("New.md")).not.toBeNull();
  });

  it("prompts for deletion and leaves the file when cancelled", async () => {
    const app = new App(document.createElement("div"));
    const file = await app.vault.create("Prompt.md", "");

    const prompt = app.fileManager.promptForDeletion(file);
    await waitForModal();
    clickModalButton("Cancel");

    await expect(prompt).resolves.toBe(false);
    expect(app.vault.getFileByPath("Prompt.md")).toBe(file);
  });

  it("prompts for deletion and deletes when confirmed", async () => {
    const app = new App(document.createElement("div"));
    const file = await app.vault.create("Prompt.md", "");

    const prompt = app.fileManager.promptForDeletion(file);
    await waitForModal();
    clickModalButton("Delete");

    await expect(prompt).resolves.toBe(true);
    expect(app.vault.getFileByPath("Prompt.md")).toBeNull();
  });

  it("opens Obsidian's file rename prompt contract", async () => {
    const app = new App(document.createElement("div"));
    const file = await app.vault.create("Old name.md", "");

    await expect(app.fileManager.promptForFileRename(file)).resolves.toBeUndefined();
    const modal = await waitForModal();
    const input = modal.querySelector<HTMLTextAreaElement>("textarea.rename-textarea");

    expect(modal.classList.contains("mod-file-rename")).toBe(true);
    expect(modal.textContent).toContain("Rename file");
    expect(input).not.toBeNull();
    expect(input?.value).toBe("Old name");
  });

  it("renames from the file rename prompt", async () => {
    const app = new App(document.createElement("div"));
    const file = await app.vault.create("Old.md", "");

    await app.fileManager.promptForFileRename(file);
    const modal = await waitForModal();
    setRenamePromptValue(modal, "New");
    clickModalButton("Save");
    await waitForFileRename(app, "Old.md", "New.md", file);

    expect(app.vault.getFileByPath("Old.md")).toBeNull();
    expect(app.vault.getFileByPath("New.md")).toBe(file);
  });

  it("blocks duplicate names from the file rename prompt", async () => {
    const app = new App(document.createElement("div"));
    const file = await app.vault.create("Old.md", "");
    await app.vault.create("Existing.md", "");

    await app.fileManager.promptForFileRename(file);
    const modal = await waitForModal();
    const input = setRenamePromptValue(modal, "Existing");
    clickModalButton("Save");

    expect(input.classList.contains("mod-error")).toBe(true);
    expect(input.title).toContain("already exists");
    expect(document.body.querySelector(".modal")).toBe(modal);
    expect(app.vault.getFileByPath("Old.md")).toBe(file);
  });

  it("treats unsafe rename characters as blocking in the file rename prompt", async () => {
    const app = new App(document.createElement("div"));
    const file = await app.vault.create("Old.md", "");

    await app.fileManager.promptForFileRename(file);
    const modal = await waitForModal();
    const input = setRenamePromptValue(modal, "Unsafe#Name");
    clickModalButton("Save");

    expect(input.classList.contains("mod-error")).toBe(true);
    expect(input.title).toContain("# ^ [ ] |");
    expect(document.body.querySelector(".modal")).toBe(modal);
    expect(app.vault.getFileByPath("Old.md")).toBe(file);
    expect(app.vault.getFileByPath("Unsafe#Name.md")).toBeNull();
  });

  it("passes write options through processFrontMatter", async () => {
    const app = new App(document.createElement("div"));
    const file = await app.vault.create("Properties.md", ["---", "title: Old", "---", "Body"].join("\n"), { ctime: 10, mtime: 20 });

    await app.fileManager.processFrontMatter(file, (frontmatter) => {
      frontmatter.title = "New";
      frontmatter.tags = ["chat"];
    }, { mtime: 30 });

    const source = await app.vault.read(file);
    expect(source).toContain("title: New");
    expect(source).toContain("tags:");
    expect(file.stat).toEqual({ ctime: 10, mtime: 30, size: source.length });
  });

  it("leaves non-markdown files untouched when processing frontmatter", async () => {
    const app = new App(document.createElement("div"));
    const file = await app.vault.create("data.json", "{\"title\":\"Old\"}", { ctime: 10, mtime: 20 });

    await app.fileManager.processFrontMatter(file, (frontmatter) => {
      frontmatter.title = "New";
    }, { mtime: 30 });

    expect(await app.vault.read(file)).toBe("{\"title\":\"Old\"}");
    expect(file.stat).toEqual({ ctime: 10, mtime: 20, size: 15 });
  });

  it("resolves a unique attachment path from a source path", async () => {
    const app = new App(document.createElement("div"));
    const source = await app.vault.create("Notes/Source.md", "");
    app.vault.setConfig("attachmentFolderPath", "./assets");
    await app.fileManager.getAvailablePathForAttachment("image.png", source.path);
    await app.vault.createBinary("Notes/assets/image.png", new ArrayBuffer(1));

    await expect(app.fileManager.getAvailablePathForAttachment("image.png", source.path)).resolves.toBe("Notes/assets/image 1.png");
  });

  it("renames properties from metadata cache and merges existing targets", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    const file = await app.vault.create("Note.md", [
      "---",
      "target:",
      "  - existing",
      "old:",
      "  - existing",
      "  - incoming",
      "after: true",
      "---",
      "Body",
    ].join("\n"));
    await app.metadataCache.computeFileMetadata(file);

    await expect(app.fileManager.renameProperty("old", "target")).resolves.toBe(1);

    expect(await app.vault.read(file)).toBe([
      "---",
      "target:",
      "  - existing",
      "  - incoming",
      "after: true",
      "---",
      "Body",
    ].join("\n"));
  });

  it("updates internal links just once from the update links modal", async () => {
    const app = new App(document.createElement("div"));
    const target = await app.vault.create("Old.md", "");
    const source = await app.vault.create("Source.md", "[[Old]]");
    await app.metadataCache.computeFileMetadata(target);
    await app.metadataCache.computeFileMetadata(source);

    const rename = app.fileManager.renameFile(target, "New.md");
    const modal = await waitForModal();

    expect(modal.textContent).toContain("Update links");
    clickModalButton("Just once");
    await rename;

    expect(await app.vault.read(source)).toBe("[[New]]");
    expect(app.vault.getConfig("alwaysUpdateLinks")).toBe(false);
  });

  it("can persist alwaysUpdateLinks from the update links modal", async () => {
    const app = new App(document.createElement("div"));
    const target = await app.vault.create("Old.md", "");
    const source = await app.vault.create("Source.md", "[[Old]]");
    await app.metadataCache.computeFileMetadata(target);
    await app.metadataCache.computeFileMetadata(source);

    const rename = app.fileManager.renameFile(target, "New.md");
    await waitForModal();

    clickModalButton("Always update");
    await rename;

    expect(await app.vault.read(source)).toBe("[[New]]");
    expect(app.vault.getConfig("alwaysUpdateLinks")).toBe(true);
  });

  it("leaves internal links unchanged when the update links modal is declined", async () => {
    const app = new App(document.createElement("div"));
    const target = await app.vault.create("Old.md", "");
    const source = await app.vault.create("Source.md", "[[Old]]");
    await app.metadataCache.computeFileMetadata(target);
    await app.metadataCache.computeFileMetadata(source);

    const rename = app.fileManager.renameFile(target, "New.md");
    await waitForModal();

    clickModalButton("Do not update");
    await rename;

    expect(await app.vault.read(source)).toBe("[[Old]]");
    expect(app.vault.getFileByPath("New.md")).not.toBeNull();
  });

  it("keeps unlinked attachments when deleteUnlinkedAttachments is never", async () => {
    const app = new App(document.createElement("div"));
    app.vault.setConfig("promptDelete", false);
    app.vault.setConfig("trashOption", "none");
    app.vault.setConfig("deleteUnlinkedAttachments", "never");
    const note = await app.vault.create("Note.md", "![[image.png]]");
    const image = await app.vault.createBinary("image.png", new ArrayBuffer(1));

    await app.fileManager.deleteFile(note);

    expect(app.vault.getFileByPath(note.path)).toBeNull();
    expect(app.vault.getFileByPath(image.path)).toBe(image);
  });

  it("deletes only orphaned attachments when deleteUnlinkedAttachments is always", async () => {
    const app = new App(document.createElement("div"));
    app.vault.setConfig("promptDelete", false);
    app.vault.setConfig("trashOption", "none");
    app.vault.setConfig("deleteUnlinkedAttachments", "always");
    const note = await app.vault.create("Note.md", "![[orphan.png]]\n![[shared.png]]");
    const other = await app.vault.create("Other.md", "![[shared.png]]");
    const orphan = await app.vault.createBinary("orphan.png", new ArrayBuffer(1));
    const shared = await app.vault.createBinary("shared.png", new ArrayBuffer(1));
    await app.metadataCache.computeFileMetadata(note);
    await app.metadataCache.computeFileMetadata(other);

    await app.fileManager.deleteFile(note);

    expect(app.vault.getFileByPath(orphan.path)).toBeNull();
    expect(app.vault.getFileByPath(shared.path)).toBe(shared);
  });

  it("asks which orphaned attachments to delete when deleteUnlinkedAttachments is ask", async () => {
    const app = new App(document.createElement("div"));
    app.vault.setConfig("promptDelete", false);
    app.vault.setConfig("trashOption", "none");
    app.vault.setConfig("deleteUnlinkedAttachments", "ask");
    const note = await app.vault.create("Note.md", "![[delete.png]]\n![[keep.png]]");
    const deleteMe = await app.vault.createBinary("delete.png", new ArrayBuffer(1));
    const keepMe = await app.vault.createBinary("keep.png", new ArrayBuffer(1));
    await app.metadataCache.computeFileMetadata(note);

    const deletion = app.fileManager.deleteFile(note);
    const modal = await waitForModal();

    expect(modal.textContent).toContain("Delete unlinked attachments");
    modal.querySelector<HTMLInputElement>('[data-path="keep.png"] input')?.click();
    clickModalButton("Delete");
    await deletion;

    expect(app.vault.getFileByPath(deleteMe.path)).toBeNull();
    expect(app.vault.getFileByPath(keepMe.path)).toBe(keepMe);
  });
});

function clickModalButton(text: string): void {
  const button = [...document.body.querySelectorAll<HTMLButtonElement>(".modal button")]
    .find((item) => item.textContent === text);
  expect(button).toBeDefined();
  button?.click();
}

function setRenamePromptValue(modal: HTMLElement, value: string): HTMLTextAreaElement {
  const input = modal.querySelector<HTMLTextAreaElement>("textarea.rename-textarea");
  expect(input).not.toBeNull();
  input!.value = value;
  input!.dispatchEvent(new Event("input", { bubbles: true }));
  return input!;
}

async function waitForModal(): Promise<HTMLElement> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const modal = document.body.querySelector<HTMLElement>(".modal");
    if (modal) return modal;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Modal did not open");
}

async function waitForModalClose(): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (!document.body.querySelector(".modal")) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Modal did not close");
}

async function waitForFileRename(app: App, oldPath: string, newPath: string, file: unknown): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (!document.body.querySelector(".modal") && app.vault.getFileByPath(oldPath) === null && app.vault.getFileByPath(newPath) === file) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("File did not finish renaming");
}

describe("createNewFile extension coercion (real fileParentCreatorByType gate)", () => {
  it("coerces an unregistered extension to md before de-suffixing the name", async () => {
    const app = new App(document.createElement("div"));
    // "xyz" has no registered creator → md; the dotted name survives intact.
    const file = await app.fileManager.createNewFile(null, "Note.xyz", "xyz");
    expect(file.path).toBe("Note.xyz.md");
    expect(file.extension).toBe("md");
  });

  it("keeps an extension that has a registered creator", async () => {
    const app = new App(document.createElement("div"));
    app.fileManager.registerFileParentCreator("canvas", () => app.vault.getRoot());
    const file = await app.fileManager.createNewFile(null, "Board", "canvas");
    expect(file.path).toBe("Board.canvas");
  });
});
