import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "@web/app/App";
import { FilesSettingTab } from "@web/builtin/FilesSettingTab";

describe("FilesSettingTab", () => {
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

  it("renders URI callbacks in Files and links advanced settings and persists it", () => {
    const app = new App(document.createElement("div"));
    const tab = new FilesSettingTab(app);

    tab.display();

    expect(tab.id).toBe("file");
    expect(tab.icon).toBe("folder-cog");
    expect(tab.name).toBe("Files and links");
    expect(tab.containerEl.textContent).toContain("Advanced");
    expect(tab.containerEl.textContent).toContain("URI callbacks");

    const toggle = findSetting(tab.containerEl, "URI callbacks")?.querySelector<HTMLInputElement>(
      'input[type="checkbox"]',
    );
    expect(toggle).not.toBeNull();
    expect(toggle?.checked).toBe(false);
    expect(
      findSetting(tab.containerEl, "URI callbacks")
        ?.querySelector(".checkbox-container")
        ?.classList.contains("is-enabled"),
    ).toBe(false);

    toggle!.checked = true;
    toggle!.dispatchEvent(new Event("change"));

    expect(app.vault.getConfig("uriCallbacks")).toBe(true);

    tab.display();
    const rerenderedToggle = findSetting(
      tab.containerEl,
      "URI callbacks",
    )?.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(
      findSetting(tab.containerEl, "URI callbacks")
        ?.querySelector(".checkbox-container")
        ?.classList.contains("is-enabled"),
    ).toBe(true);

    rerenderedToggle!.checked = false;
    rerenderedToggle!.dispatchEvent(new Event("change"));

    expect(app.vault.getConfig("uriCallbacks")).toBe(false);
  });

  it("manages excluded files and writes an empty list back as null", () => {
    const app = new App(document.createElement("div"));
    const tab = new FilesSettingTab(app);

    tab.display();
    clickButton(tab.containerEl, "Manage");

    const modalEl = document.body.querySelector<HTMLElement>(".modal");
    expect(modalEl?.textContent).toContain("No excluded filters applied.");
    const input = modalEl?.querySelector<HTMLInputElement>('input[type="text"]');
    expect(input).not.toBeNull();
    input!.value = "Archive/";
    clickButton(modalEl!, "Add");

    expect(modalEl?.textContent).toContain("Excluded filters applied.");
    expect(modalEl?.textContent).toContain("Archive/");

    clickButton(modalEl!, "Save");

    expect(app.vault.getConfig("userIgnoreFilters")).toEqual(["Archive/"]);
    expect(tab.containerEl.textContent).toContain("Archive/");

    clickButton(tab.containerEl, "Manage");
    const secondModalEl = document.body.querySelector<HTMLElement>(".modal");
    secondModalEl?.querySelector<HTMLElement>(".excluded-filter-remove")?.click();
    clickButton(secondModalEl!, "Save");

    expect(app.vault.getConfig("userIgnoreFilters")).toBeNull();
  });

  it("reads and applies the config location override from localStorage", async () => {
    window.localStorage.setItem("obsidian-reconstructed-config", ".obsidian-custom");
    const app = new App(document.createElement("div"));
    const tab = new FilesSettingTab(app);
    const reload = vi
      .spyOn(tab as unknown as { reloadWindow: () => void }, "reloadWindow")
      .mockImplementation(() => {});

    expect(app.vault.configDir).toBe(".obsidian-custom");

    tab.display();

    const input = tab.containerEl.querySelector<HTMLInputElement>('input[placeholder=".obsidian"]');
    expect(input?.value).toBe(".obsidian-custom");
    const relaunchButton = findButton(tab.containerEl, "Relaunch");
    expect(relaunchButton?.hidden).toBe(true);

    input!.value = ".obsidian-next";
    input!.dispatchEvent(new Event("input"));

    expect(relaunchButton?.hidden).toBe(false);

    clickButton(tab.containerEl, "Relaunch");
    await Promise.resolve();
    await Promise.resolve();

    expect(window.localStorage.getItem("obsidian-reconstructed-config")).toBe(".obsidian-next");
    expect(app.vault.configDir).toBe(".obsidian-next");
    expect(reload).toHaveBeenCalledOnce();
  });

  it("renders Files and links main settings and persists their config keys", () => {
    const app = new App(document.createElement("div"));
    const tab = new FilesSettingTab(app);

    tab.display();

    selectOption(tab.containerEl, "Default open action", "file");
    setTextAfterName(tab.containerEl, "Default open file", "Start.md");
    expect(app.vault.getConfig("openBehavior")).toBe("file:Start.md");

    selectOption(tab.containerEl, "New note location", "folder");
    setTextAfterName(tab.containerEl, "New file folder path", "Inbox");
    expect(app.vault.getConfig("newFileLocation")).toBe("folder");
    expect(app.vault.getConfig("newFileFolderPath")).toBe("Inbox");

    selectOption(tab.containerEl, "New attachment location", "subfolder");
    setTextAfterName(tab.containerEl, "Attachment subfolder path", "assets");
    expect(app.vault.getConfig("attachmentFolderPath")).toBe("./assets");

    selectOption(tab.containerEl, "New link format", "relative");
    setToggleAfterName(tab.containerEl, "Always update links", true);
    setToggleAfterName(tab.containerEl, "Use [[Wikilinks]]", false);
    setToggleAfterName(tab.containerEl, "Detect all file extensions", true);
    expect(app.vault.getConfig("newLinkFormat")).toBe("relative");
    expect(app.vault.getConfig("alwaysUpdateLinks")).toBe(true);
    expect(app.vault.getConfig("useMarkdownLinks")).toBe(true);
    expect(app.vault.getConfig("showUnsupportedFiles")).toBe(true);

    setToggleAfterName(tab.containerEl, "Confirm file deletion", false);
    selectOption(tab.containerEl, "Delete unlinked attachments", "never");
    selectOption(tab.containerEl, "Deleted files", "local");
    expect(app.vault.getConfig("promptDelete")).toBe(false);
    expect(app.vault.getConfig("deleteUnlinkedAttachments")).toBe("never");
    expect(app.vault.getConfig("trashOption")).toBe("local");
  });

  it("reindexes metadata cache before reloading the window", async () => {
    const app = new App(document.createElement("div"));
    const tab = new FilesSettingTab(app);
    const clear = vi.spyOn(app.metadataCache, "clear").mockResolvedValue();
    const reload = vi
      .spyOn(tab as unknown as { reloadWindow: () => void }, "reloadWindow")
      .mockImplementation(() => {});

    tab.display();
    clickButton(tab.containerEl, "Reindex");
    await Promise.resolve();
    await Promise.resolve();

    expect(clear).toHaveBeenCalledOnce();
    expect(reload).toHaveBeenCalledOnce();
  });
});

function clickButton(parent: HTMLElement, text: string): void {
  const button = findButton(parent, text);
  expect(button).toBeDefined();
  button?.click();
}

function findButton(parent: HTMLElement, text: string): HTMLButtonElement | undefined {
  return [...parent.querySelectorAll("button")].find((item) => item.textContent === text);
}

function selectOption(parent: HTMLElement, name: string, value: string): void {
  const select = findSetting(parent, name)?.querySelector<HTMLSelectElement>("select");
  expect(select).not.toBeNull();
  select!.value = value;
  select!.dispatchEvent(new Event("change"));
}

function setTextAfterName(parent: HTMLElement, name: string, value: string): void {
  const input = findSetting(parent, name)?.querySelector<HTMLInputElement>('input[type="text"]');
  expect(input).not.toBeNull();
  input!.value = value;
  input!.dispatchEvent(new Event("input"));
}

function setToggleAfterName(parent: HTMLElement, name: string, value: boolean): void {
  const input = findSetting(parent, name)?.querySelector<HTMLInputElement>(
    'input[type="checkbox"]',
  );
  expect(input).not.toBeNull();
  input!.checked = value;
  input!.dispatchEvent(new Event("change"));
}

function findSetting(parent: HTMLElement, name: string): HTMLElement | undefined {
  return [...parent.querySelectorAll<HTMLElement>(".setting-item")].find(
    (item) => item.querySelector(".setting-item-name")?.textContent === name,
  );
}
