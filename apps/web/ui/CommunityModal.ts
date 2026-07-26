/**
 * Input: ../app/App, ../core/ApiUtils, ../dom/dom, ./ActiveCloseableRegistry, ./Icon, ./Menu, ./Modal, ./Setting
 * Output: CommunityModal, CommunityModalItem, CommunitySortOrder, withLoading, withButtonLoading
 * Pos: Application code
 *
 * 🔄 Self-reference: When this file changes, update this header
 */

import type { App } from "../app/App";
import { debounce } from "../core/ApiUtils";
import { createDiv } from "../dom/dom";
import {
  registerActiveCloseable,
  unregisterActiveCloseable,
  type ActiveCloseable,
} from "./ActiveCloseableRegistry";
import { setIcon } from "./Icon";
import { Menu } from "./Menu";
import { Modal } from "./Modal";
import { Setting, type SearchComponent, type ToggleComponent } from "./Setting";

export type CommunitySortOrder = "download" | "update" | "release" | "alphabetical";

/**
 * One row of a community browser. `el` is created once when the catalog loads and
 * is re-parented — never rebuilt — on every search, sort or filter change.
 */
export interface CommunityModalItem {
  id: string;
  name: string;
  downloads: number;
  updated: number;
  el: HTMLElement;
  init: boolean;
}

const SORT_LABELS: Record<CommunitySortOrder, string> = {
  download: "Most downloaded",
  update: "Recently updated",
  release: "Recently released",
  alphabetical: "Alphabetical",
};

/** Items rendered eagerly before the rest are handed to the scroll-gated queue. */
const EAGER_ITEM_COUNT = 20;
const RENDER_BATCH_SIZE = 10;

/** Obsidian's `is-loading` affordance: the class is on for the duration of the work. */
export async function withLoading<T>(el: Element, action: () => Promise<T> | T): Promise<T> {
  el.addClass("is-loading");
  try {
    return await action();
  } finally {
    el.removeClass("is-loading");
  }
}

/** Same, for a button that owns the pending action. */
export async function withButtonLoading<T>(el: Element, action: () => Promise<T> | T): Promise<T> {
  el.addClass("mod-loading");
  try {
    return await action();
  } finally {
    el.removeClass("mod-loading");
  }
}

/**
 * The sidebar-layout browser shared by community plugins and community themes.
 *
 * Items are built once in {@link loadItems} and kept; {@link update} only swaps the
 * children of the results list, so typing in the search box never rebuilds the
 * controls or the rows that are already on screen.
 */
export abstract class CommunityModal<T extends CommunityModalItem> extends Modal {
  readonly sidebarEl: HTMLElement;
  readonly detailsEl: HTMLElement;
  readonly controlsEl: HTMLElement;
  readonly resultsWrapperEl: HTMLElement;
  readonly emptyStateEl: HTMLElement;
  readonly listStatusEl: HTMLElement;
  readonly listEl: HTMLElement;
  readonly searchSummaryEl: HTMLElement;
  readonly search: SearchComponent;
  readonly installedOnlyToggle: ToggleComponent;
  readonly installedOnlyToggleSetting: Setting;

  protected items = new Map<string, T>();
  protected itemsVisible: T[] = [];
  protected selectedItemId: string | null = null;
  protected sortOrder: CommunitySortOrder = "download";
  protected sortOrderOptions: readonly CommunitySortOrder[] = [
    "download",
    "update",
    "release",
    "alphabetical",
  ];
  protected emptyResultsText = "No results found.";

  private selectedItemCloseable: ActiveCloseable | null = null;
  private renderQueue: Array<() => void> = [];
  private renderScheduled = false;

  constructor(app: App) {
    super(app);
    this.modalEl.addClasses(["mod-community-modal", "mod-sidebar-layout"]);
    this.sidebarEl = this.contentEl.createDiv("modal-sidebar");
    this.detailsEl = createDiv("community-modal-details");
    this.controlsEl = this.sidebarEl.createDiv("community-modal-controls");

    let search: SearchComponent | null = null;
    let installedOnlyToggle: ToggleComponent | null = null;
    new Setting(this.controlsEl)
      .addSearch((component) => {
        search = component.onChange(debounce(() => this.update(), 300));
      })
      .addButton((button) =>
        button
          .setIcon("lucide-sort-asc")
          .setTooltip("Change sort order")
          .setClass("clickable-icon")
          .onClick((event) => this.showSortMenu(event)),
      );
    this.installedOnlyToggleSetting = new Setting(this.controlsEl)
      .setName("Show installed only")
      .addToggle((toggle) => {
        installedOnlyToggle = toggle.setValue(false).onChange(() => this.update());
      });
    this.search = search!;
    this.installedOnlyToggle = installedOnlyToggle!;
    this.addCustomControls(this.controlsEl);
    this.searchSummaryEl = this.controlsEl.createDiv("community-modal-search-summary u-muted");

    this.resultsWrapperEl = this.sidebarEl.createDiv("community-modal-search-results-wrapper");
    this.emptyStateEl = this.resultsWrapperEl.createDiv("community-modal-empty-state");
    this.listStatusEl = this.resultsWrapperEl.createDiv("community-modal-search-results-status");
    this.listEl = this.resultsWrapperEl.createDiv("community-modal-search-results");
    this.resultsWrapperEl.addEventListener("scroll", () => this.drainRenderQueue(), {
      passive: true,
    });
  }

  /** Build every item element once. Rejections surface as the retryable error state. */
  protected abstract loadItems(): Promise<Map<string, T>>;

  /** Filter, sort and (re)render the visible items; returns them in display order. */
  protected abstract updateItems(): T[];

  /** Fill the details pane for the selected item. */
  protected abstract showItem(item: T): void | Promise<void>;

  /** Extra controls between the installed-only toggle and the search summary. */
  protected addCustomControls(_controlsEl: HTMLElement): void {}

  override async onOpen(): Promise<void> {
    this.listEl.hide();
    this.emptyStateEl.show();
    try {
      this.items = await withLoading(this.emptyStateEl, () => this.loadItems());
      this.listEl.show();
      this.emptyStateEl.hide();
      this.emptyStateEl.empty();
      this.update();
      if (this.selectedItemId !== null) this.selectItem(this.selectedItemId);
    } catch (error) {
      this.listEl.hide();
      const message = error instanceof Error ? error.message : String(error);
      const buttonsEl = createDiv("button-container");
      const retryEl = buttonsEl.createEl("button", { cls: "mod-cta", text: "Retry" });
      retryEl.addEventListener("click", () => void withButtonLoading(retryEl, () => this.onOpen()));
      this.emptyStateEl.setChildrenInPlace([createDiv({ text: message }), buttonsEl]);
      this.emptyStateEl.show();
    }
  }

  override onClose(): void {
    this.unregisterSelectedItemCloseable();
  }

  override onEscapeKey(event: KeyboardEvent): void {
    if (this.selectedItemId !== null) {
      event.preventDefault();
      this.returnToGridView();
      return;
    }
    super.onEscapeKey(event);
  }

  /** Re-run the filters and swap the list children — never rebuilds an item. */
  update(): void {
    this.itemsVisible = this.updateItems();
    this.listEl.setChildrenInPlace(
      this.itemsVisible.length === 0
        ? [createDiv({ cls: "community-item", text: this.emptyResultsText })]
        : this.itemsVisible.map((item) => item.el),
    );
  }

  selectItem(id: string | null): void {
    if (this.detailsEl.hasClass("is-loading")) return;
    if (this.selectedItemId !== null)
      this.items.get(this.selectedItemId)?.el.removeClass("is-selected");
    this.detailsEl.empty();
    this.unregisterSelectedItemCloseable();
    const item = id === null ? null : (this.items.get(id) ?? null);
    if (!item) {
      this.selectedItemId = null;
      this.detailsEl.detach();
      return;
    }
    if (!this.detailsEl.parentElement) this.contentEl.append(this.detailsEl);
    this.selectedItemId = item.id;
    item.el.addClass("is-selected");
    this.selectedItemCloseable = { close: () => this.returnToGridView() };
    registerActiveCloseable(this.selectedItemCloseable);
    void withLoading(this.detailsEl, () => {
      this.detailsEl.createDiv("modal-setting-nav-bar", (navEl) => {
        navEl.createDiv("clickable-icon", (backEl) => {
          backEl.setAttribute("aria-label", "Back");
          setIcon(backEl, "lucide-chevron-left");
          backEl.addEventListener("click", () => this.returnToGridView());
        });
      });
      return this.showItem(item);
    });
  }

  returnToGridView(): void {
    this.selectItem(null);
  }

  protected sortItems(items: T[]): void {
    if (this.sortOrder === "release") {
      items.reverse();
      return;
    }
    if (this.sortOrder === "update") {
      items.sort((left, right) => right.updated - left.updated);
      return;
    }
    if (this.sortOrder === "alphabetical") {
      items.sort((left, right) =>
        left.name.localeCompare(right.name, undefined, { sensitivity: "base" }),
      );
      return;
    }
    items.sort((left, right) => right.downloads - left.downloads);
  }

  /**
   * Render the first screenful now and defer the rest until the reader scrolls
   * near the bottom — a 6k-entry catalog must not build 6k rows per keystroke.
   */
  protected queueRender(items: readonly T[], render: (item: T) => void): void {
    this.renderQueue = [];
    items.forEach((item, index) => {
      item.el.hide();
      if (index < EAGER_ITEM_COUNT) render(item);
      else this.renderQueue.push(() => render(item));
    });
    this.drainRenderQueue();
  }

  private drainRenderQueue(): void {
    if (this.renderScheduled || this.renderQueue.length === 0) return;
    const wrapperEl = this.resultsWrapperEl;
    const remainingBelow = wrapperEl.scrollHeight - wrapperEl.scrollTop - wrapperEl.clientHeight;
    if (remainingBelow > wrapperEl.clientHeight / 2) return;
    this.renderScheduled = true;
    this.containerEl.win.requestAnimationFrame(() => {
      this.renderScheduled = false;
      for (let index = 0; index < RENDER_BATCH_SIZE; index += 1) this.renderQueue.shift()?.();
      this.drainRenderQueue();
    });
  }

  protected scrollIntoView(id: string): void {
    // ponytail: optional call — jsdom has no scrollIntoView, and this is decoration.
    this.items.get(id)?.el.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
  }

  private showSortMenu(event: MouseEvent): void {
    event.preventDefault();
    const targetEl = event.currentTarget as HTMLElement | null;
    if (targetEl?.hasClass("has-active-menu")) return;
    const menu = new Menu();
    for (const sortOrder of this.sortOrderOptions) {
      menu.addItem((item) =>
        item
          .setTitle(SORT_LABELS[sortOrder])
          .setChecked(sortOrder === this.sortOrder)
          .onClick(() => {
            this.sortOrder = sortOrder;
            this.update();
          }),
      );
    }
    if (targetEl) menu.setParentElement(targetEl);
    menu.showAtMouseEvent(event);
  }

  private unregisterSelectedItemCloseable(): void {
    if (!this.selectedItemCloseable) return;
    unregisterActiveCloseable(this.selectedItemCloseable);
    this.selectedItemCloseable = null;
  }
}
