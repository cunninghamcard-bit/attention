import type { App } from "../app/App";
import type { SettingTab } from "../app/SettingRegistry";
import type { InternalPluginDefinition } from "../plugin/InternalPlugin";
import type { InternalPluginWrapper } from "../plugin/InternalPluginWrapper";
import { setIcon } from "../ui/Icon";
import {
  buildPropertyListItems,
  readPropertySortOrder,
  RESERVED_PROPERTY_KEYS,
  type PropertyListItem,
  type PropertySortOrder,
} from "./PropertiesList";
import type { PropertyDefinition, PropertyValue } from "../properties/PropertyTypes";
import { Menu } from "../ui/Menu";
import { Modal } from "../ui/Modal";
import { Notice } from "../ui/Notice";
import { Setting, SettingGroup } from "../ui/Setting";
import { ItemView } from "../views/ItemView";
import type { WorkspaceLeaf } from "../workspace/WorkspaceLeaf";
import type { TFile } from "../vault/TAbstractFile";
const PROPERTY_SORT_STORAGE_KEY = "properties-sort-order";
const PROPERTY_SHOW_SEARCH_STORAGE_KEY = "properties-show-search";
const PROPERTY_SEARCH_QUERY_STORAGE_KEY = "properties-search-query";

export class PropertiesController {
  plugin: InternalPluginWrapper | null = null;

  constructor(readonly app: App) {}

  async onEnable(plugin: InternalPluginWrapper): Promise<void> {
    this.plugin = plugin;
    plugin.addSettingTab(new PropertiesSettingTab(this.app, this));
    plugin.registerEvent(this.app.workspace.on("property-change", () => this.refreshViews()));
    plugin.registerEvent(this.app.workspace.on("property-rename", () => this.refreshViews()));
    plugin.registerEvent(this.app.workspace.on("property-delete", () => this.refreshViews()));
  }

  openAllProperties(): void {
    void this.app.workspace.ensureSideLeaf("all-properties", "right", { active: true, reveal: true });
  }

  openFileProperties(path = this.app.workspace.activeEditor?.file?.path): void {
    if (!path) {
      new Notice("No active file");
      return;
    }
    void this.app.workspace.ensureSideLeaf("file-properties", "right", { active: true, reveal: true }).then((leaf) => {
      void leaf.setViewState({ type: "file-properties", state: { file: path }, active: true });
    });
  }

  async addPropertyToActiveFile(): Promise<void> {
    const path = this.app.workspace.activeEditor?.file?.path;
    if (!path) {
      new Notice("No active file");
      return;
    }
    const id = window.prompt("Property name");
    if (!id?.trim()) return;
    const definition = this.app.propertyRegistry.ensureDefinition(id.trim(), "");
    await this.app.properties.setProperty(path, definition.id, definition.type === "checkbox" ? false : "");
  }

  async addAliasToActiveFile(): Promise<void> {
    const path = this.app.workspace.activeEditor?.file?.path;
    if (!path) {
      new Notice("No active file");
      return;
    }
    const alias = window.prompt("Alias");
    if (!alias?.trim()) return;
    const current = this.app.properties.getPropertyValue(path, "aliases");
    const aliases = Array.isArray(current) ? current : current ? [String(current)] : [];
    if (!aliases.includes(alias.trim())) aliases.push(alias.trim());
    await this.app.properties.setProperty(path, "aliases", aliases);
  }

  async clearActiveFileProperties(): Promise<void> {
    const path = this.app.workspace.activeEditor?.file?.path;
    if (!path) {
      new Notice("No active file");
      return;
    }
    if (!window.confirm(`Clear all properties from ${path}?`)) return;
    await this.app.properties.clearFileProperties(path);
  }

  async renameProperty(propertyId: string): Promise<void> {
    const next = window.prompt("Rename property", propertyId);
    if (!next?.trim()) return;
    const trimmed = next.trim();
    if (trimmed === propertyId) return;
    if (RESERVED_PROPERTY_KEYS.has(propertyId.toLowerCase())) {
      new Notice(`${propertyId} is a built-in property`);
      return;
    }
    if (
      Object.prototype.hasOwnProperty.call(this.app.metadataCache.getAllPropertyInfos(), trimmed)
      && !window.confirm(`Property "${trimmed}" already exists. Merge "${propertyId}" into it?`)
    ) {
      return;
    }
    const count = await this.app.properties.renameProperty(propertyId, trimmed);
    new Notice(`Renamed ${propertyId} in ${count} file${count === 1 ? "" : "s"}`);
  }

  async deleteProperty(propertyId: string): Promise<void> {
    if (RESERVED_PROPERTY_KEYS.has(propertyId.toLowerCase())) {
      new Notice(`${propertyId} is a built-in property`);
      return;
    }
    if (!window.confirm(`Delete property "${propertyId}" from all files?`)) return;
    const count = await this.app.properties.deleteProperty(propertyId);
    new Notice(`Deleted ${propertyId} from ${count} file${count === 1 ? "" : "s"}`);
  }

  async changePropertyType(propertyId: string, type: PropertyDefinition["type"]): Promise<void> {
    this.app.metadataTypeManager.setType(propertyId, type);
    new Notice(`Changed ${propertyId} to ${type}`);
  }

  unsetPropertyType(propertyId: string): void {
    this.app.metadataTypeManager.unsetType(propertyId);
    new Notice(`Reset ${propertyId} to inferred type`);
  }

  renderPropertyValue(parent: HTMLElement, path: string, property: PropertyDefinition, value: PropertyValue, afterChange?: () => void): void {
    const widget = this.app.propertyRegistry.getTypeWidget(property.type);
    if (!widget) {
      parent.textContent = formatPropertyValue(value);
      return;
    }
    widget.render(parent, {
      property,
      value,
      onChange: (next) => {
        void this.app.properties.setProperty(path, property.id, next).then(() => afterChange?.());
      },
      onDelete: () => {
        void this.app.properties.clearProperty(path, property.id).then(() => afterChange?.());
      },
    });
  }

  listUsage(sortOrder: PropertySortOrder = "frequency", searchQuery = ""): PropertyListItem[] {
    return buildPropertyListItems(
      this.app.metadataTypeManager.getAllProperties(),
      (type) => this.app.metadataTypeManager.getTypeInfo(type),
      sortOrder,
      searchQuery,
    );
  }

  async openSearchForProperty(propertyName: string, event?: MouseEvent): Promise<void> {
    const query = `["${propertyName.replace(/"/g, '\\"')}"]`;
    if (event?.metaKey || event?.ctrlKey) {
      this.app.workspace.trigger("properties-search-toggle", propertyName, query);
      return;
    }
    const leaf = await this.app.workspace.ensureSideLeaf("search", "left", { active: true, reveal: true });
    const view = leaf.view as unknown as { focusSearch?: (query?: string) => void };
    if (view.focusSearch) view.focusSearch(query);
    else await leaf.setViewState({ type: "search", state: { query }, active: true });
  }

  private refreshViews(): void {
    for (const leaf of [...this.app.workspace.getLeavesOfType("all-properties"), ...this.app.workspace.getLeavesOfType("file-properties")]) {
      const view = leaf.view as unknown as { render?: () => void };
      view.render?.();
    }
  }
}

class PropertiesView extends ItemView {
  icon = "lucide-archive";
  private sortOrder: PropertySortOrder;
  private showSearch: boolean;
  private searchQuery: string;

  constructor(leaf: WorkspaceLeaf, readonly controller: PropertiesController) {
    super(leaf);
    this.sortOrder = readPropertySortOrder(this.app.loadLocalStorage<PropertySortOrder>(PROPERTY_SORT_STORAGE_KEY));
    this.showSearch = this.app.loadLocalStorage<boolean>(PROPERTY_SHOW_SEARCH_STORAGE_KEY) ?? false;
    this.searchQuery = this.app.loadLocalStorage<string>(PROPERTY_SEARCH_QUERY_STORAGE_KEY) ?? "";
  }

  getViewType(): string {
    return "all-properties";
  }

  getDisplayText(): string {
    return "All properties";
  }

  async onOpen(): Promise<void> {
    this.registerEvent(this.app.vault.on("delete", () => this.render()));
    this.registerEvent(this.app.metadataCache.on("finished", () => this.render()));
    this.registerEvent(this.app.metadataTypeManager.on("changed", () => this.render()));
    this.app.workspace.onLayoutReady(() => this.render());
    this.render();
  }

  render(): void {
    this.updateHeader();
    this.contentEl.replaceChildren();
    this.contentEl.className = "view-content metadata-properties-view";
    const toolbarEl = this.contentEl.ownerDocument.createElement("div");
    toolbarEl.className = "metadata-properties-toolbar";
    const searchButton = this.contentEl.ownerDocument.createElement("button");
    searchButton.className = "metadata-properties-search-toggle";
    searchButton.textContent = this.showSearch ? "Hide search" : "Search";
    searchButton.addEventListener("click", () => {
      this.showSearch = !this.showSearch;
      this.app.saveLocalStorage(PROPERTY_SHOW_SEARCH_STORAGE_KEY, this.showSearch);
      this.render();
    });
    const sortSelectEl = this.contentEl.ownerDocument.createElement("select");
    sortSelectEl.className = "metadata-properties-sort";
    for (const [value, label] of [
      ["frequency", "Most used"],
      ["frequencyReverse", "Least used"],
      ["alphabetical", "A to Z"],
      ["alphabeticalReverse", "Z to A"],
    ] as const) {
      const optionEl = this.contentEl.ownerDocument.createElement("option");
      optionEl.value = value;
      optionEl.textContent = label;
      optionEl.selected = value === this.sortOrder;
      sortSelectEl.appendChild(optionEl);
    }
    sortSelectEl.addEventListener("change", () => {
      this.sortOrder = readPropertySortOrder(sortSelectEl.value);
      this.app.saveLocalStorage(PROPERTY_SORT_STORAGE_KEY, this.sortOrder);
      this.render();
    });
    toolbarEl.append(searchButton, sortSelectEl);
    this.contentEl.appendChild(toolbarEl);

    if (this.showSearch) {
      const searchEl = this.contentEl.ownerDocument.createElement("input");
      searchEl.className = "metadata-properties-search-input";
      searchEl.type = "search";
      searchEl.placeholder = "Filter properties";
      searchEl.value = this.searchQuery;
      searchEl.addEventListener("input", () => {
        this.searchQuery = searchEl.value;
        this.app.saveLocalStorage(PROPERTY_SEARCH_QUERY_STORAGE_KEY, this.searchQuery);
        this.render();
      });
      this.contentEl.appendChild(searchEl);
    }

    const allProperties = this.app.metadataTypeManager.getAllProperties();
    if (Object.keys(allProperties).length === 0) {
      const emptyEl = this.contentEl.ownerDocument.createElement("div");
      emptyEl.className = "metadata-empty-state";
      emptyEl.textContent = "No properties in the vault";
      this.contentEl.appendChild(emptyEl);
      return;
    }

    const usage = this.controller.listUsage(this.sortOrder, this.searchQuery);
    if (usage.length === 0) {
      const emptyEl = this.contentEl.ownerDocument.createElement("div");
      emptyEl.className = "metadata-empty-state";
      emptyEl.textContent = "No matching properties";
      this.contentEl.appendChild(emptyEl);
      return;
    }

    for (const item of usage) this.renderUsage(item);
  }

  private renderUsage(item: PropertyListItem): void {
    const rowEl = this.contentEl.ownerDocument.createElement("div");
    rowEl.className = "tree-item nav-file metadata-property metadata-property-summary";
    rowEl.dataset.propertyKey = item.id;
    rowEl.addEventListener("click", (event) => {
      if ((event.target as HTMLElement).closest("button, input, select")) return;
      void this.controller.openSearchForProperty(item.name, event);
    });
    rowEl.addEventListener("contextmenu", (event) => this.openPropertyMenu(item, event));
    const keyEl = this.contentEl.ownerDocument.createElement("div");
    keyEl.className = "metadata-property-key";
    const iconEl = this.contentEl.ownerDocument.createElement("span");
    iconEl.className = "metadata-property-icon";
    iconEl.dataset.icon = item.icon ?? "lucide-list-plus";
    const nameEl = this.contentEl.ownerDocument.createElement("span");
    nameEl.textContent = item.name;
    keyEl.append(iconEl, nameEl);

    const valueEl = this.contentEl.ownerDocument.createElement("div");
    valueEl.className = "metadata-property-value";
    valueEl.textContent = String(item.occurrences);

    const actionsEl = this.contentEl.ownerDocument.createElement("div");
    actionsEl.className = "metadata-property-actions";
    const menuButton = this.actionButton("...", (event) => this.openPropertyMenu(item, event));
    menuButton.classList.add("clickable-icon");
    actionsEl.append(menuButton);

    rowEl.append(keyEl, valueEl, actionsEl);
    this.contentEl.appendChild(rowEl);
  }

  private actionButton(text: string, callback: (event: MouseEvent) => void): HTMLButtonElement {
    const buttonEl = this.contentEl.ownerDocument.createElement("button");
    buttonEl.textContent = text;
    buttonEl.addEventListener("click", (event) => {
      event.stopPropagation();
      callback(event);
    });
    return buttonEl;
  }

  private openPropertyMenu(item: PropertyListItem, event: MouseEvent): void {
    event.preventDefault();
    const menu = new Menu();
    menu.addItem((menuItem) => {
      menuItem.setTitle("Property type").setIcon("lucide-list-plus").setDisabled(item.reserved);
      const submenu = menuItem.setSubmenu();
      for (const type of this.app.metadataTypeManager.listTypes()) {
        submenu.addItem((typeItem) => typeItem
          .setTitle(type.name)
          .setIcon(type.icon)
          .setChecked(type.type === item.widget)
          .setDisabled(item.reserved)
          .onClick(() => void this.controller.changePropertyType(item.name, type.type)));
      }
      submenu.addSeparator();
      submenu.addItem((typeItem) => typeItem
        .setTitle("Infer type")
        .setIcon("lucide-rotate-ccw")
        .setDisabled(item.reserved)
        .onClick(() => this.controller.unsetPropertyType(item.name)));
    });
    menu.addSeparator();
    menu.addItem((menuItem) => menuItem
      .setTitle("Rename")
      .setIcon("lucide-pencil")
      .setDisabled(item.reserved)
      .onClick(() => void this.controller.renameProperty(item.name)));
    menu.addItem((menuItem) => menuItem
      .setTitle("Delete")
      .setIcon("lucide-trash")
      .setWarning(true)
      .setDisabled(item.reserved)
      .onClick(() => void this.controller.deleteProperty(item.name)));
    menu.showAtMouseEvent(event);
  }
}

class FilePropertiesView extends ItemView {
  icon = "lucide-list-plus";
  private path = "";

  constructor(leaf: WorkspaceLeaf, readonly controller: PropertiesController) {
    super(leaf);
  }

  getViewType(): string {
    return "file-properties";
  }

  getDisplayText(): string {
    return this.path ? `Properties: ${this.path}` : "File properties";
  }

  async setState(state: unknown): Promise<void> {
    await super.setState(state);
    if (state && typeof state === "object" && "file" in state) this.path = String((state as { file?: unknown }).file ?? "");
    this.render();
  }

  async onOpen(): Promise<void> {
    this.registerEvent(this.app.workspace.on("file-open", (file) => {
      const openedFile = file as { path?: string } | null;
      if (!this.path && openedFile?.path) {
        this.path = openedFile.path;
        this.render();
      }
    }));
    this.registerEvent(this.app.workspace.on("property-change", (path: string) => {
      if (path === this.path) this.render();
    }));
    this.registerEvent(this.app.workspace.on("property-clear-file", (path: string) => {
      if (path === this.path) this.render();
    }));
    this.render();
  }

  render(): void {
    this.updateHeader();
    this.contentEl.replaceChildren();
    this.contentEl.className = "view-content metadata-file-properties-view";
    const filePath = this.path || this.app.workspace.activeEditor?.file?.path;
    if (!filePath) {
      const emptyEl = document.createElement("div");
      emptyEl.className = "metadata-empty-state";
      emptyEl.textContent = "No file selected";
      this.contentEl.appendChild(emptyEl);
      return;
    }
    this.path = filePath;
    const containerEl = document.createElement("div");
    containerEl.className = "metadata-container show-properties";
    const properties = this.app.properties.getFileProperties(filePath);
    containerEl.dataset.propertyCount = String(Object.keys(properties.values).length);
    for (const [id, value] of Object.entries(properties.values)) {
      const definition = this.app.propertyRegistry.ensureDefinition(id, value);
      renderFilePropertyRow(containerEl, this.controller, filePath, definition, value, () => this.render());
    }
    const addButton = document.createElement("button");
    addButton.className = "metadata-add-button text-icon-button";
    addButton.textContent = "Add property";
    addButton.addEventListener("click", () => void this.addProperty(filePath));
    containerEl.appendChild(addButton);
    this.contentEl.appendChild(containerEl);
  }

  private async addProperty(path: string): Promise<void> {
    const id = window.prompt("Property name");
    if (!id?.trim()) return;
    await this.app.properties.setProperty(path, id.trim(), "");
    this.render();
  }
}

class FilePropertiesModal extends Modal {
  constructor(app: App, readonly controller: PropertiesController, readonly path: string) {
    super(app);
    this.setTitle(`Properties: ${path}`);
    this.modalEl.classList.add("mod-properties");
  }

  onOpen(): void {
    this.render();
  }

  private render(): void {
    this.contentEl.replaceChildren();
    const containerEl = document.createElement("div");
    containerEl.className = "metadata-container";
    const properties = this.app.properties.getFileProperties(this.path);
    for (const [id, value] of Object.entries(properties.values)) {
      const definition = this.app.propertyRegistry.ensureDefinition(id, value);
      renderFilePropertyRow(containerEl, this.controller, this.path, definition, value, () => this.render());
    }
    const addButton = document.createElement("button");
    addButton.className = "metadata-add-button";
    addButton.textContent = "Add property";
    addButton.addEventListener("click", () => void this.addProperty());
    containerEl.appendChild(addButton);
    this.contentEl.appendChild(containerEl);
  }

  private async addProperty(): Promise<void> {
    const id = window.prompt("Property name");
    if (!id?.trim()) return;
    await this.app.properties.setProperty(this.path, id.trim(), "");
    this.render();
  }
}

class PropertiesSettingTab implements SettingTab {
  readonly id = "properties";
  readonly name = "Properties";
  readonly icon = "lucide-list-plus";
  readonly section = "core-plugins" as const;
  readonly navEl = document.createElement("div");
  readonly containerEl = document.createElement("div");

  constructor(readonly app: App, readonly controller: PropertiesController) {
    this.navEl.className = "vertical-tab-nav-item tappable";
    const iconEl = document.createElement("div");
    iconEl.className = "vertical-tab-nav-item-icon";
    setIcon(iconEl, this.icon);
    const titleEl = document.createElement("div");
    titleEl.className = "vertical-tab-nav-item-title";
    titleEl.textContent = this.name;
    const chevronEl = document.createElement("div");
    chevronEl.className = "vertical-tab-nav-item-chevron";
    this.navEl.append(iconEl, titleEl, chevronEl);
    this.containerEl.className = "vertical-tab-content properties-settings";
  }

  display(): void {
    this.containerEl.replaceChildren();
    const group = new SettingGroup(this.containerEl).setHeading("Properties");
    new Setting(group.itemsEl)
      .setName("All properties")
      .setDesc("Open the vault-wide property list.")
      .addButton((button) => button.setButtonText("Open").onClick(() => this.controller.openAllProperties()));
    for (const usage of this.controller.listUsage()) {
      const setting = new Setting(group.itemsEl)
        .setName(usage.name)
        .setDesc(`${usage.occurrences} occurrence${usage.occurrences === 1 ? "" : "s"} · ${usage.widget}`);
      if (!usage.reserved) {
        setting
          .addButton((button) => button.setButtonText("Rename").onClick(() => void this.controller.renameProperty(usage.name).then(() => this.display())))
          .addButton((button) => button.setButtonText("Delete").onClick(() => void this.controller.deleteProperty(usage.name).then(() => this.display())));
      }
    }
  }

  hide(): void {
    this.containerEl.remove();
  }
}

export function renderFilePropertyRow(
  parent: HTMLElement,
  controller: PropertiesController,
  path: string,
  property: PropertyDefinition,
  value: PropertyValue,
  afterChange?: () => void,
): void {
  const rowEl = document.createElement("div");
  rowEl.className = "metadata-property";
  rowEl.dataset.propertyKey = property.id;
  const keyEl = document.createElement("div");
  keyEl.className = "metadata-property-key";
  const iconEl = document.createElement("span");
  iconEl.className = "metadata-property-icon";
  iconEl.dataset.icon = property.icon ?? "lucide-list-plus";
  const labelEl = document.createElement("span");
  labelEl.textContent = property.name;
  keyEl.append(iconEl, labelEl);

  const valueEl = document.createElement("div");
  valueEl.className = "metadata-property-value";
  valueEl.dataset.propertyType = property.type;
  controller.renderPropertyValue(valueEl, path, property, value, afterChange);

  const deleteButton = document.createElement("button");
  deleteButton.className = "metadata-property-delete";
  deleteButton.dataset.icon = "lucide-x";
  deleteButton.title = "Delete property";
  deleteButton.addEventListener("click", () => {
    void controller.app.properties.clearProperty(path, property.id).then(() => afterChange?.());
  });

  rowEl.append(keyEl, valueEl, deleteButton);
  parent.appendChild(rowEl);
}

export function createPropertiesPluginDefinition(): InternalPluginDefinition {
  let controller: PropertiesController | null = null;
  return {
    id: "properties",
    name: "Properties",
    description: "List, edit, rename, delete, and type frontmatter properties across the vault.",
    defaultOn: true,
    init(app: App, plugin: InternalPluginWrapper) {
      controller = new PropertiesController(app);
      plugin.instance = controller;
      plugin.registerViewType("all-properties", (leaf) => new PropertiesView(leaf, controller as PropertiesController));
      plugin.registerViewType("file-properties", (leaf) => new FilePropertiesView(leaf, controller as PropertiesController));
      plugin.registerGlobalCommand({
        id: "properties:open",
        name: "List properties in the vault",
        icon: "lucide-list-plus",
        callback: () => controller?.openAllProperties(),
      });
      plugin.registerGlobalCommand({
        id: "properties:open-local",
        name: "Show properties for file",
        icon: "lucide-list-plus",
        checkCallback: (checking) => {
          const file = app.workspace.activeEditor?.file;
          if (!file) return false;
          if (!checking) controller?.openFileProperties(file.path);
          return true;
        },
      });
      plugin.registerGlobalCommand({
        id: "markdown:add-metadata-property",
        name: "Add file property",
        icon: "lucide-plus-circle",
        hotkeys: [{ modifiers: ["Mod"], key: ";" }],
        checkCallback: (checking) => {
          const available = !!app.workspace.activeEditor?.file;
          if (!checking && available) void controller?.addPropertyToActiveFile();
          return available;
        },
      });
      plugin.registerGlobalCommand({
        id: "markdown:add-alias",
        name: "Add alias",
        icon: "lucide-forward",
        checkCallback: (checking) => {
          const available = !!app.workspace.activeEditor?.file;
          if (!checking && available) void controller?.addAliasToActiveFile();
          return available;
        },
      });
      plugin.registerGlobalCommand({
        id: "markdown:clear-metadata-properties",
        name: "Clear file properties",
        icon: "lucide-eraser",
        checkCallback: (checking) => {
          const available = !!app.workspace.activeEditor?.file;
          if (!checking && available) void controller?.clearActiveFileProperties();
          return available;
        },
      });
    },
    async onEnable(app: App, plugin: InternalPluginWrapper) {
      await controller?.onEnable(plugin);
      plugin.registerEvent(app.workspace.on<[Menu, TFile, string, WorkspaceLeaf]>("file-menu", (menu, file, source, leaf) => {
        if (source === "sidebar-context-menu" || isMobileRuntime() || file.extension !== "md" || !leaf) return;
        menu.addItem((item) => item
          .setSection("view.linked")
          .setTitle("Open file properties")
          .setIcon("lucide-info")
          .onClick(() => {
            const targetLeaf = app.workspace.splitLeafOrActive(leaf, "horizontal");
            void targetLeaf.setViewState({ type: "file-properties", state: { file: file.path }, active: true, group: leaf });
          }));
      }));
      app.workspace.onLayoutReady(() => void app.workspace.ensureSideLeaf("all-properties", "right", { reveal: false }));
    },
  };
}

function isMobileRuntime(): boolean {
  return document.body.classList.contains("is-mobile") || navigator.userAgent.includes("Mobile");
}

function formatPropertyValue(value: PropertyValue): string {
  if (Array.isArray(value)) return value.join(", ");
  if (value == null) return "";
  return String(value);
}
