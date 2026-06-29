import type { App } from "../app/App";
import type { SettingTab } from "../app/SettingRegistry";
import { CorePluginSettingTab, PluginSettingTab } from "../plugin/PluginSettingTab";
import { setIcon } from "../ui/Icon";
import { SearchComponent } from "../ui/Setting";
import { registerActiveCloseable, unregisterActiveCloseable, type ActiveCloseable } from "../ui/ActiveCloseableRegistry";

export type SettingsSectionId = "options" | "core-plugins" | "community-plugins";

export class SettingsRenderer {
  readonly containerEl: HTMLElement;
  readonly headerEl: HTMLElement;
  readonly searchContainerEl: HTMLElement;
  readonly searchComponent: SearchComponent;
  readonly contentContainerEl: HTMLElement;
  readonly tabContainer: HTMLElement;
  readonly corePluginTabHeaderGroup: HTMLElement;
  readonly corePluginTabContainer: HTMLElement;
  readonly communityPluginTabHeaderGroup: HTMLElement;
  readonly communityPluginTabContainer: HTMLElement;
  private activeTab: SettingTab | null = null;
  private activeTabCloseable: ActiveCloseable | null = null;
  private query = "";

  constructor(
    readonly app: App,
    parent: HTMLElement,
    readonly onTabOpen?: (tab: SettingTab) => void,
    readonly onTabClose?: () => void,
  ) {
    if (parent.classList.contains("vertical-tabs-container")) {
      this.containerEl = parent;
    } else {
      this.containerEl = document.createElement("div");
      this.containerEl.className = "vertical-tabs-container";
      parent.appendChild(this.containerEl);
    }

    this.headerEl = document.createElement("div");
    this.headerEl.className = "vertical-tab-header";
    this.searchContainerEl = document.createElement("div");
    this.searchContainerEl.className = "vertical-tab-header-search";
    this.searchComponent = new SearchComponent(this.searchContainerEl)
      .setPlaceholder("Search settings");
    this.searchContainerEl.addEventListener("input", () => this.setQuery(this.searchComponent.getValue()));
    this.headerEl.appendChild(this.searchContainerEl);
    const optionsGroup = this.createHeaderGroup("Options", "options");
    this.tabContainer = optionsGroup.itemsEl;
    const coreGroup = this.createHeaderGroup("Core plugins", "core-plugins");
    this.corePluginTabHeaderGroup = coreGroup.titleEl;
    this.corePluginTabContainer = coreGroup.itemsEl;
    const communityGroup = this.createHeaderGroup("Community plugins", "community-plugins");
    this.communityPluginTabHeaderGroup = communityGroup.titleEl;
    this.communityPluginTabContainer = communityGroup.itemsEl;

    this.contentContainerEl = document.createElement("div");
    this.contentContainerEl.className = "vertical-tab-content-container";
    this.containerEl.append(this.headerEl, this.contentContainerEl);
  }

  render(preferredTabId?: string): void {
    this.unregisterActiveTabCloseable();
    this.activeTab = null;
    this.tabContainer.replaceChildren();
    this.corePluginTabContainer.replaceChildren();
    this.communityPluginTabContainer.replaceChildren();
    this.contentContainerEl.replaceChildren();
    this.renderHeaders();

    const tabs = this.app.setting.getTabs();
    const preferred = tabs.find((tab) => tab.id === preferredTabId);
    const first = preferred ?? tabs[0];
    if (first) this.openSettingTab(first);
  }

  addSettingTab(tab: SettingTab): void {
    this.renderHeaders();
    if (!this.activeTab) this.openSettingTab(tab);
    else this.activeTab.navEl?.classList.add("is-active");
  }

  openTabById(id: string): SettingTab | null {
    const tab = this.app.setting.getTabById(id);
    if (!tab) return null;
    this.openSettingTab(tab);
    return tab;
  }

  removeSettingTab(tab: SettingTab): void {
    if (this.activeTab === tab) this.closeActiveTab();
    this.renderHeaders();
  }

  openSettingTab(tab: SettingTab): void {
    this.unregisterActiveTabCloseable();
    const previous = this.activeTab;
    if (previous && previous !== tab) {
      previous.navEl?.classList.remove("is-active");
      previous.hide?.();
    }
    this.activeTab = tab;
    this.headerEl.querySelectorAll(".vertical-tab-nav-item").forEach((item) => item.classList.remove("is-active"));
    const navEl = this.ensureNavEl(tab);
    navEl.classList.add("is-active");
    this.contentContainerEl.replaceChildren();
    const containerEl = tab.containerEl;
    if (containerEl) this.contentContainerEl.appendChild(containerEl);
    if (!tab.displayDeclarative?.()) tab.display?.();
    tab.setQuery?.(this.query);
    this.onTabOpen?.(tab);
    this.activeTabCloseable = {
      close: () => this.closeActiveTab(),
    };
    registerActiveCloseable(this.activeTabCloseable);
  }

  close(): void {
    this.closeActiveTab();
  }

  setQuery(query: string): void {
    this.query = query.trim().toLowerCase();
    if (this.activeTab && !this.matchesTab(this.activeTab)) {
      const next = this.findFirstMatchingTab();
      this.renderHeaders();
      if (next && next !== this.activeTab) this.openSettingTab(next);
      else this.activeTab?.setQuery?.(this.query);
    } else if (!this.activeTab) {
      const next = this.findFirstMatchingTab();
      this.renderHeaders();
      if (next) this.openSettingTab(next);
    } else {
      this.renderHeaders();
      this.activeTab?.setQuery?.(this.query);
    }
  }

  private closeActiveTab(): void {
    const tab = this.activeTab;
    if (!tab) return;
    this.unregisterActiveTabCloseable();
    tab.navEl?.classList.remove("is-active");
    this.contentContainerEl.replaceChildren();
    tab.hide?.();
    this.activeTab = null;
    this.onTabClose?.();
  }

  private unregisterActiveTabCloseable(): void {
    if (!this.activeTabCloseable) return;
    unregisterActiveCloseable(this.activeTabCloseable);
    this.activeTabCloseable = null;
  }

  private renderHeaders(): void {
    this.tabContainer.replaceChildren();
    this.corePluginTabContainer.replaceChildren();
    this.communityPluginTabContainer.replaceChildren();
    const tabs = this.app.setting.getTabs();
    const options = tabs.filter((tab) => getTabSection(tab) === "options");
    const core = tabs.filter((tab) => getTabSection(tab) === "core-plugins");
    const community = tabs.filter((tab) => getTabSection(tab) === "community-plugins");
    this.appendTabs(this.tabContainer, options);
    this.appendTabs(this.corePluginTabContainer, sortTabs(core));
    this.appendTabs(this.communityPluginTabContainer, sortTabs(community));
    this.corePluginTabHeaderGroup.style.display = core.length > 0 ? "" : "none";
    this.communityPluginTabHeaderGroup.style.display = community.length > 0 ? "" : "none";
  }

  private appendTabs(containerEl: HTMLElement, tabs: readonly SettingTab[]): void {
    for (const tab of tabs) {
      if (!this.matchesTab(tab)) continue;
      const navEl = this.ensureNavEl(tab);
      navEl.onclick = () => this.openSettingTab(tab);
      navEl.classList.toggle("is-active", tab === this.activeTab);
      containerEl.appendChild(navEl);
    }
  }

  private findFirstMatchingTab(): SettingTab | null {
    return this.app.setting.getTabs().find((tab) => this.matchesTab(tab)) ?? null;
  }

  private matchesTab(tab: SettingTab): boolean {
    if (!this.query) return true;
    const texts = [tab.name ?? "", tab.id ?? "", ...this.collectSettingSearchTexts(tab)];
    return texts.some((text) => text.toLowerCase().includes(this.query));
  }

  private collectSettingSearchTexts(tab: SettingTab): string[] {
    const items = tab.settingItems ?? tab.getSettingDefinitions?.() ?? [];
    const texts: string[] = [];
    const visit = (item: unknown): void => {
      if (!item || typeof item !== "object") return;
      const record = item as Record<string, unknown>;
      if (!evaluateSearchBoolean(record.visible, true)) return;
      const type = record.type;
      const isGroup = type === "group" || type === "list";
      const isPage = type === "page";
      if (isGroup) {
        if (typeof record.heading === "string") texts.push(record.heading);
      } else if (isPage) {
        if (typeof record.name === "string") texts.push(record.name);
        texts.push(getSearchText(record.desc));
        texts.push(getDisplayValueSearchText(record.displayValue));
      } else if (evaluateSearchBoolean(record.searchable, true)) {
        if (typeof record.name === "string") texts.push(record.name);
        texts.push(getSearchText(record.desc));
        if (Array.isArray(record.aliases)) texts.push(...record.aliases.filter((alias): alias is string => typeof alias === "string"));
      }
      const children = Array.isArray(record.items) ? record.items : [];
      for (const child of children) visit(child);
    };
    for (const item of items) visit(item);
    return texts;
  }

  private createHeaderGroup(title: string, section: SettingsSectionId): { titleEl: HTMLElement; itemsEl: HTMLElement } {
    const groupEl = document.createElement("div");
    groupEl.className = "vertical-tab-header-group";
    const titleEl = document.createElement("div");
    titleEl.className = "vertical-tab-header-group-title";
    titleEl.textContent = title;
    const itemsEl = document.createElement("div");
    itemsEl.className = "vertical-tab-header-group-items";
    itemsEl.dataset.section = section;
    groupEl.append(titleEl, itemsEl);
    this.headerEl.appendChild(groupEl);
    return { titleEl, itemsEl };
  }

  private ensureNavEl(tab: SettingTab): HTMLElement {
    if (tab.navEl) {
      if (tab.id) tab.navEl.dataset.settingId = tab.id;
      return tab.navEl;
    }
    const navEl = document.createElement("div");
    navEl.className = "vertical-tab-nav-item tappable";
    if (tab.id) navEl.dataset.settingId = tab.id;
    if (tab.icon) {
      const iconEl = document.createElement("div");
      iconEl.className = "vertical-tab-nav-item-icon";
      setIcon(iconEl, tab.icon);
      navEl.appendChild(iconEl);
    }
    const titleEl = document.createElement("div");
    titleEl.className = "vertical-tab-nav-item-title";
    titleEl.textContent = tab.name ?? tab.id ?? "Settings";
    const chevronEl = document.createElement("div");
    chevronEl.className = "vertical-tab-nav-item-chevron";
    setIcon(chevronEl, "lucide-chevron-right");
    navEl.append(titleEl, chevronEl);
    tab.navEl = navEl;
    return navEl;
  }
}

function evaluateSearchBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "function") {
    try {
      return value() !== false;
    } catch {
      return fallback;
    }
  }
  if (typeof value === "boolean") return value;
  return fallback;
}

function getSearchText(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && "textContent" in value) {
    const text = (value as { textContent?: unknown }).textContent;
    return typeof text === "string" ? text : "";
  }
  return "";
}

function getDisplayValueSearchText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value !== "function") return "";
  try {
    const result = value();
    return typeof result === "string" ? result : "";
  } catch {
    return "";
  }
}

function sortTabs(tabs: readonly SettingTab[]): SettingTab[] {
  return [...tabs].sort((left, right) => (left.name ?? left.id ?? "").localeCompare(right.name ?? right.id ?? ""));
}

function getTabSection(tab: SettingTab): SettingsSectionId {
  if (tab instanceof PluginSettingTab) return "community-plugins";
  if (tab instanceof CorePluginSettingTab) return "core-plugins";
  if (tab.section) return tab.section;
  if (tab.id === "appearance" || tab.id === "editor") return "options";
  if (tab.id === "community-plugins") return "community-plugins";
  return "core-plugins";
}
