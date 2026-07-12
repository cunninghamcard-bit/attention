import { createDiv, createEl, createFragment, createSpan } from "../../dom/dom";
import { setIcon } from "../../ui/Icon";
import { Menu } from "../../ui/Menu";
import { Notice } from "../../ui/Notice";
import { setTooltip } from "../../ui/Popover";
import { Setting, SettingGroup, type TextComponent } from "../../ui/Setting";

/**
 * The starter (vault chooser) page — the standalone window real Obsidian
 * serves as `starter.html`. Reverse-engineered from the real starter bundle:
 *
 * - `.starter-screen > .starter-screen-inner` splits into the
 *   `.recent-vaults` sidebar (hidden entirely when the registry is empty)
 *   and the `.splash` column (brand block + sliding action panes).
 * - The main pane (`.open-vault-options.mod-open-vault`) holds a
 *   "Quick start" block (only when there are no vaults) and the
 *   create/open-folder settings; "Create new vault" slides to the
 *   `.mod-create-vault` pane (180ms translateX, back-button returns).
 * - Every successful `vault-open` sendSync (`=== true`) closes the window —
 *   main never closes the starter.
 *
 * Product cuts vs real: no Obsidian Sync rows/panes (ArkLoop has no account
 * service), no language dropdown (no i18n layer), and no
 * `vault-message {action:"vault-setup"}` after create — our bootstrap seeds
 * welcome content into an empty vault already.
 */

export interface StarterIpc {
  sendSync(channel: string, ...args: unknown[]): unknown;
  invoke?(channel: string, ...args: unknown[]): Promise<unknown>;
}

export interface StarterScreenOptions {
  /** Real code paths call `window.close()`; tests observe instead. */
  closeWindow?: () => void;
  /** Trailing-dot vault names are invalid on Windows only. */
  isWindows?: boolean;
  showItemInFolder?: (path: string) => void;
}

interface VaultEntry {
  id: string;
  path: string;
  ts: number;
  open?: boolean;
}

const FAILED_TO_OPEN = "Failed to open.";

function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function dirname(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  const cut = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return cut > 0 ? trimmed.slice(0, cut) : trimmed;
}

function joinPath(parent: string, name: string): string {
  return `${parent.replace(/[\\/]+$/, "")}/${name}`;
}

export class StarterScreen {
  readonly containerEl: HTMLElement;
  private readonly listEl: HTMLElement;
  private readonly recentVaultsEl: HTMLElement;
  private readonly quickStartEl: HTMLElement;
  private readonly paneContainerEl: HTMLElement;
  private readonly mainPaneEl: HTMLElement;
  private readonly createPaneEl: HTMLElement;
  private activePaneEl: HTMLElement;
  private nameComponent!: TextComponent;
  private locationSetting!: Setting;
  private location = "";
  private readonly closeWindow: () => void;
  private readonly isWindows: boolean;
  private readonly showItemInFolder: (path: string) => void;

  constructor(
    parentEl: HTMLElement,
    private readonly ipc: StarterIpc,
    options: StarterScreenOptions = {},
  ) {
    const win = parentEl.ownerDocument.defaultView ?? window;
    this.closeWindow = options.closeWindow ?? (() => win.close());
    this.isWindows = options.isWindows ?? /win/i.test(win.navigator?.platform ?? "");
    this.showItemInFolder = options.showItemInFolder ?? ((path) => {
      const shell = (win as Window & { electron?: { shell?: { showItemInFolder?: (p: string) => void } } }).electron?.shell;
      shell?.showItemInFolder?.(path);
    });

    this.containerEl = createDiv("starter-screen", parentEl);
    const innerEl = createDiv("starter-screen-inner", this.containerEl);
    this.recentVaultsEl = createDiv("recent-vaults", innerEl);
    this.listEl = createDiv("recent-vaults-list", this.recentVaultsEl);

    const splashEl = createDiv("splash", innerEl);
    this.buildBrand(splashEl);
    this.paneContainerEl = createDiv("open-vault-options-container", splashEl);
    this.mainPaneEl = createDiv("open-vault-options mod-open-vault", this.paneContainerEl);
    this.activePaneEl = this.mainPaneEl;
    this.quickStartEl = createDiv("quick-start-container u-center-text", this.mainPaneEl);
    this.buildQuickStart();
    this.buildMainActions();
    this.createPaneEl = this.buildCreatePane();

    this.renderVaultList();
  }

  private buildBrand(splashEl: HTMLElement): void {
    const brandEl = createDiv("splash-brand", splashEl);
    const logoEl = createDiv("splash-brand-logo", brandEl);
    logoEl.style.setProperty("--icon-size", "90px");
    setIcon(logoEl, "vault");
    createDiv({ cls: "splash-brand-logo-text", text: "ArkLoop" }, brandEl);
    const version = this.ipc.sendSync("version");
    createDiv({ cls: "splash-brand-version", text: `Version ${String(version ?? "")}` }, brandEl);
  }

  /** Real quick-start block — shown only while the registry is empty. */
  private buildQuickStart(): void {
    const button = createEl("button", { cls: "mod-cta", text: "Quick start" }, this.quickStartEl);
    button.addEventListener("click", () => {
      const defaultPath = this.ipc.sendSync("get-default-vault-path");
      if (typeof defaultPath !== "string" || !defaultPath) return;
      // Real order: try create first; "Vault already exists" falls back to a
      // plain open of the same folder.
      let result = this.ipc.sendSync("vault-open", defaultPath, true);
      if (result !== true) result = this.ipc.sendSync("vault-open", defaultPath, false);
      if (result === true) this.closeWindow();
      else new Notice(`${FAILED_TO_OPEN} ${String(result)}.`);
    });
  }

  private buildMainActions(): void {
    const group = new SettingGroup(this.mainPaneEl);
    group.addSetting((setting) => setting
      .setName("Create new vault")
      .setDesc("Create a new vault under a folder.")
      .addButton((button) => button
        .setCta()
        .setButtonText("Create")
        .onClick(() => this.openCreatePane())));
    group.addSetting((setting) => setting
      .setName("Open folder as vault")
      .setDesc("Choose an existing folder of Markdown files.")
      .addButton((button) => button
        .setButtonText("Open")
        .onClick(() => void this.openFolderAsVault())));
  }

  private async openFolderAsVault(): Promise<void> {
    const folder = await this.pickFolder("Open folder as vault");
    if (!folder) return;
    const result = this.ipc.sendSync("vault-open", folder, false);
    if (result === true) this.closeWindow();
    else new Notice(`${FAILED_TO_OPEN} ${String(result)}.`);
  }

  private async pickFolder(title: string): Promise<string | null> {
    const picked = await this.ipc.invoke?.("dialog:open", { title, directory: true }) as string[] | undefined;
    return picked?.[0] ?? null;
  }

  // --- Create pane ---

  private buildCreatePane(): HTMLElement {
    // Detached until "Create new vault" slides it in — real keeps the
    // secondary panes off-DOM the same way.
    const paneEl = createDiv("open-vault-options mod-create-vault");
    const backEl = createDiv("back-button", paneEl);
    setIcon(backEl, "lucide-arrow-left");
    backEl.appendText("Back");
    backEl.addEventListener("click", () => this.showPane(this.mainPaneEl, "left"));

    const group = new SettingGroup(paneEl);
    group.setHeading("Create local vault");
    group.addSetting((setting) => setting
      .setName("Vault name")
      .setDesc("Pick a name for your awesome vault.")
      .addText((text) => {
        this.nameComponent = text;
        text.setPlaceholder("Vault name");
      }));
    group.addSetting((setting) => {
      this.locationSetting = setting;
      setting
        .setName("Location")
        .setDesc("Pick a place to put your new vault.")
        .addButton((button) => button
          .setButtonText("Browse")
          .onClick(async () => {
            const folder = await this.pickFolder("Location");
            if (folder) this.setLocation(folder);
          }));
    });

    const buttonContainerEl = createDiv("button-container", paneEl);
    const createButton = createEl("button", { cls: "mod-cta", text: "Create" }, buttonContainerEl);
    createButton.addEventListener("click", () => this.createVault());
    return paneEl;
  }

  private openCreatePane(): void {
    this.showPane(this.createPaneEl, "right");
  }

  private setLocation(folder: string): void {
    this.location = folder;
    this.locationSetting.setDesc(createFragment((frag) => {
      frag.appendChild(this.containerEl.ownerDocument.createTextNode("Your new vault will be placed in: "));
      createSpan({ cls: "u-pop", text: folder }, frag);
    }));
  }

  private createVault(): void {
    const name = this.nameComponent.getValue().trim();
    if (!name) {
      new Notice("Vault name cannot be empty.");
      return;
    }
    if (this.isWindows && name.endsWith(".")) {
      new Notice("Vault name cannot end with a dot.");
      return;
    }
    if (!this.location) {
      new Notice("Please pick a valid folder.");
      return;
    }
    try {
      // Real concatenates with a literal "/" (node normalizes on Windows).
      const result = this.ipc.sendSync("vault-open", `${this.location}/${name}`, true);
      if (result === true) this.closeWindow();
      else new Notice(`Failed to create vault. ${String(result)}.`);
    } catch {
      new Notice("Could not create vault at the given location. Please double check the location and permission.");
    }
  }

  /**
   * Real pane transition `X()`: 180ms translateX slide inside the absolutely
   * positioned pane stack; the outgoing pane detaches afterwards. `right`
   * navigates forward, `left` back. Falls back to an instant swap where the
   * Web Animations API is unavailable (jsdom).
   */
  private showPane(paneEl: HTMLElement, dir: "right" | "left"): void {
    const outgoing = this.activePaneEl;
    if (outgoing === paneEl) return;
    this.paneContainerEl.appendChild(paneEl);
    this.activePaneEl = paneEl;
    const detach = () => outgoing.remove();
    if (typeof paneEl.animate !== "function") {
      detach();
      return;
    }
    const sign = dir === "right" ? 1 : -1;
    outgoing.animate(
      [{ transform: "translateX(0)" }, { transform: `translateX(${-20 * sign}%)` }],
      { duration: 180, easing: "ease-out" },
    );
    const slideIn = paneEl.animate(
      [{ transform: `translateX(${100 * sign}%)` }, { transform: "translateX(0)" }],
      { duration: 180, easing: "cubic-bezier(0.33, 1, 0.68, 1)" },
    );
    slideIn.onfinish = detach;
  }

  // --- Recent vaults ---

  private readVaults(): VaultEntry[] {
    const raw = (this.ipc.sendSync("vault-list") ?? {}) as Record<string, { path?: string; ts?: number; open?: boolean }>;
    const entries: VaultEntry[] = [];
    for (const id of Object.keys(raw)) {
      const value = raw[id];
      if (!value?.path) continue;
      entries.push({ id, path: value.path, ts: value.ts ?? 0, open: value.open });
    }
    // Real sort: most recently opened first.
    entries.sort((left, right) => right.ts - left.ts);
    return entries;
  }

  renderVaultList(): void {
    const vaults = this.readVaults();
    this.listEl.replaceChildren();
    // Real empty state: no placeholder text — the sidebar disappears and the
    // Quick start block appears instead.
    const hasVaults = vaults.length > 0;
    this.recentVaultsEl.classList.toggle("is-hidden", !hasVaults);
    this.recentVaultsEl.style.display = hasVaults ? "" : "none";
    this.quickStartEl.style.display = hasVaults ? "none" : "";
    for (const vault of vaults) this.renderVaultItem(vault);
  }

  private renderVaultItem(vault: VaultEntry): void {
    const itemEl = createDiv("recent-vaults-list-item", this.listEl);
    setTooltip(itemEl, vault.path, { placement: "right" });
    const nameEl = createDiv({ cls: "recent-vaults-list-item-name", text: basename(vault.path) }, itemEl);
    createDiv({ cls: "recent-vaults-list-item-path", text: dirname(vault.path) }, itemEl);
    const optionEl = createDiv("recent-vaults-list-item-option-button", itemEl);
    setIcon(optionEl, "lucide-more-vertical");
    setTooltip(optionEl, "More options");

    const openMenu = (event: MouseEvent) => {
      event.preventDefault();
      if (itemEl.classList.contains("has-active-menu")) return;
      this.openVaultItemMenu(event, itemEl, nameEl, vault);
    };
    optionEl.addEventListener("click", openMenu);
    itemEl.addEventListener("contextmenu", openMenu);
    itemEl.addEventListener("click", (event) => {
      if (event.defaultPrevented) return;
      event.preventDefault();
      const result = this.ipc.sendSync("vault-open", vault.path, false);
      if (result === true) this.closeWindow();
      else new Notice(`${FAILED_TO_OPEN} ${String(result)}.`);
    });
  }

  private openVaultItemMenu(event: MouseEvent, itemEl: HTMLElement, nameEl: HTMLElement, vault: VaultEntry): void {
    const menu = Menu.forEvent(event);
    menu.addSections(["open", "info", "action", "system", "", "danger"]);
    menu.setParentElement(itemEl);
    menu.addItem((item) => item
      .setSection("action")
      .setIcon("lucide-edit-3")
      .setTitle("Rename vault...")
      .onClick(() => this.startInlineRename(nameEl, vault)));
    menu.addItem((item) => item
      .setSection("action")
      .setIcon("lucide-folder-tree")
      .setTitle("Move vault...")
      .onClick(async () => {
        const destination = await this.pickFolder("Select destination folder");
        if (destination) this.moveVault(vault, joinPath(destination, basename(vault.path)), "move");
      }));
    menu.addItem((item) => item
      .setSection("info")
      .setIcon("lucide-copy")
      .setTitle("Copy vault ID")
      .onClick(() => {
        void navigator.clipboard?.writeText(vault.id);
        new Notice("Copied to your clipboard");
      }));
    menu.addItem((item) => item
      .setSection("system")
      .setIcon("lucide-folder-open")
      .setTitle(this.isWindows ? "Reveal vault in system explorer" : "Reveal vault in Finder")
      .onClick(() => this.showItemInFolder(vault.path)));
    menu.addItem((item) => item
      .setSection("danger")
      .setIcon("lucide-x")
      .setWarning(true)
      .setTitle("Remove from list")
      .onClick(() => this.removeVault(vault)));
    menu.showAtMouseEvent(event);
  }

  /** Real inline rename: the name div becomes contenteditable in place. */
  private startInlineRename(nameEl: HTMLElement, vault: VaultEntry): void {
    const original = basename(vault.path);
    nameEl.contentEditable = "true";
    nameEl.tabIndex = -1;
    nameEl.focus();
    const doc = nameEl.ownerDocument;
    const range = doc.createRange();
    range.selectNodeContents(nameEl);
    const selection = doc.defaultView?.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    const finish = (commit: boolean) => {
      nameEl.removeEventListener("keydown", onKeyDown);
      nameEl.removeEventListener("blur", onBlur);
      nameEl.contentEditable = "false";
      nameEl.removeAttribute("contenteditable");
      const next = nameEl.textContent?.trim() ?? "";
      nameEl.textContent = original;
      if (commit && next && next !== original) {
        this.moveVault(vault, joinPath(dirname(vault.path), next), "rename");
      }
    };
    const onKeyDown = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key === "Enter") {
        keyEvent.preventDefault();
        finish(true);
      } else if (keyEvent.key === "Escape") {
        keyEvent.preventDefault();
        finish(false);
      }
    };
    const onBlur = () => finish(false);
    nameEl.addEventListener("keydown", onKeyDown);
    nameEl.addEventListener("blur", onBlur);
  }

  /**
   * Shared rename/move — real `d(newPath, verb)`. The target-exists check
   * stays main-side (fs.rename errors surface through the returned string;
   * this renderer keeps node off its import graph for browser tests).
   */
  private moveVault(vault: VaultEntry, newPath: string, verb: "rename" | "move"): void {
    if (newPath === vault.path) return;
    if (newPath.startsWith(`${vault.path}/`) || newPath.startsWith(`${vault.path}\\`)) {
      new Notice("Cannot move vault into a subfolder of itself.");
      return;
    }
    const result = this.ipc.sendSync("vault-move", vault.path, newPath);
    if (result === "EVAULTOPEN") {
      new Notice(verb === "rename" ? "Can't rename a currently open vault." : "Can't move a currently open vault.");
    } else if (result) {
      new Notice(`${verb === "rename" ? "Failed to rename vault." : "Failed to move vault."} ${String(result)}`);
    } else {
      new Notice(verb === "rename" ? "Successfully renamed vault." : "Successfully moved vault.");
    }
    this.renderVaultList();
  }

  private removeVault(vault: VaultEntry): void {
    const result = this.ipc.sendSync("vault-remove", vault.path);
    if (result !== true) {
      new Notice("Can't remove a currently open vault.");
      return;
    }
    // Real also drops the vault's IndexedDB databases; we keep only
    // localStorage state per vault, so that's the whole purge.
    const storage = this.containerEl.ownerDocument.defaultView?.localStorage;
    if (storage) {
      const doomed: string[] = [];
      for (let index = 0; index < storage.length; index++) {
        const key = storage.key(index);
        if (key?.startsWith(`${vault.id}-`)) doomed.push(key);
      }
      for (const key of doomed) storage.removeItem(key);
    }
    this.renderVaultList();
  }
}
