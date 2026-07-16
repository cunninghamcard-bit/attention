import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "@web/app/App";
import { ThemeMarketplaceModal } from "@web/builtin/theme-market/ThemeMarketplaceModal";
import type { ThemeMarketplaceEntry } from "@web/builtin/theme-market/ThemeMarketplace";
import { closeTopActiveCloseable } from "@web/ui/ActiveCloseableRegistry";

describe("ThemeMarketplaceModal", () => {
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
    document.body.replaceChildren();
  });

  afterEach(() => {
    while (closeTopActiveCloseable()) {
      // Drain active modal/detail closeables between tests.
    }
    document.body.replaceChildren();
  });

  it("renders the Obsidian-style theme manager", async () => {
    const { app, modal } = await openModal([
      entry("Alpha", "Ada", "A focused theme.", "ada/alpha", 20),
      entry("Beta", "Bea", "A calm theme.", "bea/beta", 10),
    ]);

    expect(modal.modalEl.classList.contains("mod-community-modal")).toBe(true);
    expect(modal.contentEl.querySelector(".modal-sidebar")).not.toBeNull();
    expect(modal.contentEl.querySelector(".community-modal-controls")).not.toBeNull();
    expect(modal.contentEl.querySelector(".community-modal-details")).toBeNull();
    expect(modal.contentEl.querySelector(".search-input-container input")).not.toBeNull();
    expect(
      modal.contentEl.querySelector(".community-modal-controls .setting-item.mod-toggle"),
    ).not.toBeNull();
    expect(modal.contentEl.querySelectorAll(".community-item")).toHaveLength(3);
    expect(modal.contentEl.textContent).toContain("Default");
    expect(modal.contentEl.textContent).toContain("Alpha");
    expect(
      modal.contentEl.querySelector<HTMLImageElement>(
        '[data-theme-id="Alpha"] img.community-item-screenshot',
      )?.src,
    ).toBe("https://raw.githubusercontent.com/ada/alpha/HEAD/screenshot.png");
    const alphaCard = modal.contentEl.querySelector<HTMLElement>('[data-theme-id="Alpha"]');
    clickTheme(modal, "Alpha");
    await flushAsync();
    expect(modal.contentEl.querySelector('[data-theme-id="Alpha"]')).toBe(alphaCard);
    expect(modal.contentEl.querySelector(".community-modal-details")).not.toBeNull();
    expect(modal.contentEl.querySelector(".community-modal-info-author")?.textContent).toBe(
      "By Ada",
    );
    expect(modal.contentEl.querySelector(".community-modal-info-repo")?.textContent).toContain(
      "github.com/ada/alpha",
    );
    expect(modal.contentEl.querySelector(".community-modal-readme")?.textContent).toContain(
      "A focused theme.",
    );
    expect(
      modal.contentEl.querySelector<HTMLImageElement>(".community-modal-readme img")?.src,
    ).toBe("https://raw.githubusercontent.com/ada/alpha/HEAD/dark.png");
    expect(
      modal.contentEl.querySelector<HTMLImageElement>('.community-modal-readme img[alt="External"]')
        ?.src,
    ).toBe("https://img.example.com/preview.png");
    expect(modal.contentEl.querySelector(".community-modal-readme h1")?.textContent).toBe("Alpha");
    expect(
      modal.contentEl.querySelector<HTMLAnchorElement>(
        '.community-modal-readme a[href="https://obsidian.md"]',
      ),
    ).not.toBeNull();
    expect(app.themeMarketplace.loadCatalog).toHaveBeenCalled();
  });

  it("resolves root-relative README images to the repo raw base", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    app.themeMarketplace.registerEntry({
      manifest: {
        id: "Minimal",
        name: "Minimal",
        version: "1.0.0",
        author: "kepano",
        modes: ["light", "dark"],
      },
      repository: "kepano/obsidian-minimal",
      screenshot: "screenshot.png",
      // Real Minimal README uses root-relative markdown images plus HTML blocks.
      readme:
        '![](/cover.png)\n\n![](docs/rel.png)\n\n<p align="center"><img src="/html-root.png"></p>',
      detailsState: "loaded",
    });
    vi.spyOn(app.themeMarketplace, "loadCatalog").mockResolvedValue(1);
    const modal = new ThemeMarketplaceModal(app);
    modal.open();
    await flushAsync();
    clickTheme(modal, "Minimal");
    await flushAsync();

    const base = "https://raw.githubusercontent.com/kepano/obsidian-minimal/HEAD/";
    const srcs = [
      ...modal.contentEl.querySelectorAll<HTMLImageElement>(".community-modal-readme img"),
    ].map((img) => img.src);
    expect(srcs).toContain(`${base}cover.png`);
    expect(srcs).toContain(`${base}docs/rel.png`);
    expect(srcs).toContain(`${base}html-root.png`);
  });

  it("filters and sorts theme manager entries", async () => {
    const { app, modal } = await openModal([
      entry("Beta", "Bea", "A calm theme.", "bea/beta", 30),
      entry("Alpha", "Ada", "A focused theme.", "ada/alpha", 20),
      entry("Gamma", "Gia", "A bright theme.", "gia/gamma", 10),
    ]);
    await app.themeInstaller.install(themePackage("Alpha"));
    modal.render();
    expect(themeIds(modal)).toEqual(["", "Beta", "Alpha", "Gamma"]);

    let searchEl = modal.contentEl.querySelector<HTMLInputElement>(
      ".search-input-container input",
    )!;
    searchEl.value = "bta";
    searchEl.dispatchEvent(new Event("input"));
    expect(themeIds(modal)).toEqual(["Beta"]);
    expect(
      modal.contentEl.querySelector('[data-theme-id="Beta"] .community-item-name')?.children.length,
    ).toBeGreaterThan(0);

    searchEl = modal.contentEl.querySelector<HTMLInputElement>(".search-input-container input")!;
    expect(document.activeElement).toBe(searchEl);
    searchEl.value = "gia";
    searchEl.dispatchEvent(new Event("input"));
    expect(themeIds(modal)).toEqual(["Gamma"]);
    expect(
      modal.contentEl.querySelector(
        '[data-theme-id="Gamma"] .community-item-author .suggestion-highlight',
      )?.textContent,
    ).toBe("Gia");

    searchEl = modal.contentEl.querySelector<HTMLInputElement>(".search-input-container input")!;
    searchEl.value = "";
    searchEl.dispatchEvent(new Event("input"));
    modal.contentEl.querySelector<HTMLButtonElement>(".community-modal-controls button")!.click();
    clickButton(document.body, "Alphabetical");
    expect(window.localStorage.getItem("communityThemeSortOrder")).toBe("alphabetical");
    expect(themeIds(modal)).toEqual(["", "Alpha", "Beta", "Gamma"]);

    modal.contentEl.querySelector<HTMLButtonElement>(".community-modal-controls button")!.click();
    clickButton(document.body, "Recently released");
    expect(themeIds(modal)).toEqual(["", "Gamma", "Alpha", "Beta"]);

    const installedOnly = modal.contentEl.querySelector<HTMLInputElement>(
      ".community-modal-controls .setting-item.mod-toggle input",
    )!;
    installedOnly.checked = true;
    installedOnly.dispatchEvent(new Event("change"));
    expect(themeIds(modal)).toEqual(["", "Alpha"]);
  });

  it("installs and uses a theme from the manager", async () => {
    const { app, modal } = await openModal([
      entry("Alpha", "Ada", "A focused theme.", "ada/alpha"),
    ]);
    vi.spyOn(app.themeMarketplace, "downloadPackage").mockResolvedValue(themePackage("Alpha"));

    clickTheme(modal, "Alpha");
    clickButton(modal.contentEl, "Install and use");
    await flushAsync();

    expect(app.vault.getConfig("cssTheme")).toBe("Alpha");
    expect(await app.vault.readText(".obsidian/themes/Alpha/theme.css")).toContain("alpha-marker");
    expect(modal.contentEl.textContent).toContain("Stop using");
  });

  it("updates a theme from the update-only manager", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    app.themeMarketplace.registerEntry(entry("Alpha", "Ada", "A focused theme.", "ada/alpha"));
    app.themes.registerTheme({
      id: "Alpha",
      name: "Alpha",
      version: "0.9.0",
      variables: {},
    });
    vi.spyOn(app.themeMarketplace, "loadCatalog").mockResolvedValue(1);
    const update = vi.spyOn(app.themeInstaller, "update").mockResolvedValue({
      id: "Alpha",
      version: "1.0.0",
      installedAt: "now",
      enabled: false,
    });
    const modal = new ThemeMarketplaceModal(app, new Set(["Alpha"]));
    modal.open();
    await flushAsync();

    expect(themeIds(modal)).toEqual(["Alpha"]);
    clickTheme(modal, "Alpha");
    clickButton(modal.contentEl, "Update");
    await flushAsync();

    expect(update).toHaveBeenCalledWith("Alpha");
  });

  it("uses and uninstalls an installed theme", async () => {
    const { app, modal } = await openModal([
      entry("Alpha", "Ada", "A focused theme.", "ada/alpha"),
    ]);
    await app.themeInstaller.install(themePackage("Alpha"));
    modal.render();

    clickTheme(modal, "Alpha");
    clickButton(modal.contentEl, "Use");
    expect(app.vault.getConfig("cssTheme")).toBe("Alpha");
    clickButton(modal.contentEl, "Uninstall");
    await flushAsync();

    expect(app.vault.getConfig("cssTheme")).toBe("");
    expect(app.vault.getAbstractFileByPath(".obsidian/themes/Alpha")).toBeNull();
    expect(modal.contentEl.querySelector('[data-theme-id="Alpha"] .flair')).toBeNull();
  });

  it("retries a failed theme catalog load", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    const loadCatalog = vi
      .spyOn(app.themeMarketplace, "loadCatalog")
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(1);
    const modal = new ThemeMarketplaceModal(app);
    modal.open();
    await flushAsync();

    expect(modal.contentEl.querySelector(".community-modal-empty-state.mod-error")).not.toBeNull();
    expect(modal.contentEl.textContent).toContain("Failed to load community themes: offline");

    app.themeMarketplace.registerEntry(entry("Retry", "Ada", "Loaded after retry.", "ada/retry"));
    clickButton(modal.contentEl, "Retry");
    await flushAsync();

    expect(loadCatalog).toHaveBeenCalledTimes(2);
    expect(modal.contentEl.textContent).toContain("Retry");
  });

  it("handles a theme without a screenshot", async () => {
    const { modal } = await openModal([entry("Plain", "Ada", "No image.")]);

    clickTheme(modal, "Plain");

    expect(
      modal.contentEl.querySelector(
        '[data-theme-id="Plain"] .community-item-screenshot.mod-unavailable',
      ),
    ).not.toBeNull();
    expect(buttonTexts(modal.contentEl)).toContain("Install and use");
  });
});

async function openModal(entries: ThemeMarketplaceEntry[]): Promise<{
  app: App;
  modal: ThemeMarketplaceModal;
}> {
  const app = new App(document.createElement("div"));
  await app.ready;
  for (const item of entries) app.themeMarketplace.registerEntry(item);
  vi.spyOn(app.themeMarketplace, "loadCatalog").mockResolvedValue(entries.length);
  const modal = new ThemeMarketplaceModal(app);
  modal.open();
  await flushAsync();
  return { app, modal };
}

function entry(
  name: string,
  author: string,
  description: string,
  repository?: string,
  downloads?: number,
): ThemeMarketplaceEntry {
  return {
    manifest: {
      id: name,
      name,
      version: "1.0.0",
      author,
      description,
      modes: ["light", "dark"],
    },
    repository,
    downloads,
    screenshot: repository ? "screenshot.png" : undefined,
    readme: repository
      ? `<a href="https://www.buymeacoffee.com/kepano"></a><h1 align="center">${name}</h1><h3>Personal theme for <a href="https://obsidian.md">Obsidian</a> :3</h3><br><p align="center"><img src="dark.png" alt="Preview"><img src="https://img.example.com/preview.png" alt="External"></p><p>${description}</p>`
      : description,
    detailsState: "loaded",
  };
}

function themePackage(name: string) {
  return {
    manifest: {
      id: name,
      name,
      version: "1.0.0",
      author: "Ada",
      modes: ["light", "dark"] as Array<"light" | "dark">,
    },
    cssText: `body { --${name.toLowerCase()}-marker: yes; }`,
  };
}

function clickTheme(modal: ThemeMarketplaceModal, id: string): void {
  const item = modal.contentEl.querySelector<HTMLElement>(`[data-theme-id="${id}"]`);
  if (!item) throw new Error(`Theme not found: ${id}`);
  item.click();
}

function clickButton(root: HTMLElement, text: string): void {
  const button = [...root.querySelectorAll<HTMLElement>("button, .menu-item")].find(
    (item) => item.textContent?.trim() === text,
  );
  if (!button) throw new Error(`Button not found: ${text}`);
  button.click();
}

function themeIds(modal: ThemeMarketplaceModal): string[] {
  return [...modal.contentEl.querySelectorAll<HTMLElement>(".community-item")].map(
    (item) => item.dataset.themeId ?? "",
  );
}

function buttonTexts(root: HTMLElement): string[] {
  return [...root.querySelectorAll<HTMLButtonElement>("button")].map(
    (button) => button.textContent?.trim() ?? "",
  );
}

function flushAsync(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}
