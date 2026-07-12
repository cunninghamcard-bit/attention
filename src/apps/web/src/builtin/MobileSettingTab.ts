import type { App } from "../app/App";
import type { SettingTab } from "../app/SettingRegistry";
import type { Command } from "../app/commands/CommandManager";
import { fuzzyMatch, prepareFuzzyQuery, sortFuzzySuggestions } from "../ui/suggest/SuggestModal";
import { setIcon } from "../ui/Icon";

export class MobileSettingTab implements SettingTab {
  readonly id = "mobile";
  readonly name = "Mobile";
  readonly icon = "wrench";
  readonly section = "options" as const;
  readonly navEl = document.createElement("div");
  readonly containerEl = document.createElement("div");
  private query = "";

  constructor(readonly app: App) {
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
  }

  setQuery(query: string): void {
    this.query = query.trim().toLowerCase();
    this.applyQuery();
  }

  display(): void {
    const contentEl = this.containerEl;
    contentEl.replaceChildren();
    contentEl.className = "vertical-tab-content mobile-settings";
    const heading = document.createElement("h2");
    heading.textContent = "Mobile toolbar";
    const desc = document.createElement("p");
    desc.className = "setting-item-description";
    desc.textContent = "Configure commands shown above the mobile keyboard.";
    const selectedEl = document.createElement("div");
    selectedEl.className = "mobile-toolbar-selected-list";
    const moreHeading = document.createElement("h3");
    moreHeading.textContent = "More toolbar options";
    const moreEl = document.createElement("div");
    moreEl.className = "mobile-toolbar-more-list";
    const search = document.createElement("input");
    search.className = "prompt-input mobile-toolbar-command-search";
    search.placeholder = "Search commands...";
    const resultsEl = document.createElement("div");
    resultsEl.className = "suggestion-container mobile-toolbar-command-results";
    contentEl.append(heading, desc, selectedEl, moreHeading, moreEl, search, resultsEl);

    const renderSelected = () => {
      selectedEl.replaceChildren();
      const ids = this.getValidToolbarCommands();
      if (ids.length === 0) {
        const emptyEl = document.createElement("div");
        emptyEl.className = "mobile-option-setting-item";
        emptyEl.textContent = "No toolbar commands";
        selectedEl.appendChild(emptyEl);
        return;
      }
      for (const [index, id] of ids.entries()) {
        selectedEl.appendChild(
          this.createSelectedRow(id, index, renderSelected, renderMore, renderResults),
        );
      }
    };

    const renderMore = () => {
      moreEl.replaceChildren();
      const selected = new Set(this.getToolbarCommands());
      const moreCommands = this.app.commands
        .getEditorCommands()
        .filter((command) => !selected.has(command.id));
      if (moreCommands.length === 0) {
        const emptyEl = document.createElement("div");
        emptyEl.className = "mobile-option-setting-item";
        emptyEl.textContent = "No more commands";
        moreEl.appendChild(emptyEl);
        return;
      }
      for (const command of moreCommands) {
        moreEl.appendChild(this.createMoreRow(command, renderSelected, renderMore));
      }
    };

    const renderResults = () => {
      resultsEl.replaceChildren();
      const query = search.value.trim();
      if (!query) return;
      const selected = new Set(this.getToolbarCommands());
      const fuzzyQuery = prepareFuzzyQuery(query);
      const editorCommandIds = new Set(
        this.app.commands.getEditorCommands().map((command) => command.id),
      );
      const matches = this.app.commands.getCommands().flatMap((command) => {
        if (selected.has(command.id) || editorCommandIds.has(command.id)) return [];
        const match = fuzzyMatch(fuzzyQuery, command.name);
        return match ? [{ item: command, match }] : [];
      });
      sortFuzzySuggestions(matches);
      for (const { item: command } of matches.slice(0, 20)) {
        const itemEl = document.createElement("div");
        itemEl.className = "suggestion-item";
        itemEl.textContent = command.name;
        itemEl.addEventListener("click", () => {
          this.saveToolbarCommands([...this.getToolbarCommands(), command.id]);
          search.value = "";
          renderResults();
          renderSelected();
        });
        resultsEl.appendChild(itemEl);
      }
    };

    search.addEventListener("input", renderResults);
    renderSelected();
    renderMore();
    this.applyQuery();
  }

  hide(): void {
    this.containerEl.remove();
  }

  private createSelectedRow(
    id: string,
    index: number,
    renderSelected: () => void,
    renderMore: () => void,
    renderResults: () => void,
  ): HTMLElement {
    const command = this.app.commands.findCommand(id);
    const rowEl = document.createElement("div");
    rowEl.className = "mobile-option-setting-item";
    rowEl.dataset.commandId = id;
    rowEl.addEventListener("dragover", (event) => event.preventDefault());
    rowEl.addEventListener("drop", (event) => {
      event.preventDefault();
      const draggedId = event.dataTransfer?.getData("text/plain") || "";
      if (!draggedId) return;
      this.reorderCommand(draggedId, index);
      renderSelected();
    });
    const nameEl = document.createElement("div");
    nameEl.className = "mobile-option-setting-item-name";
    nameEl.textContent = command?.name ?? id;
    const deleteEl = this.makeIconButton("lucide-minus-circle", "Delete", () => {
      this.saveToolbarCommands(this.getToolbarCommands().filter((commandId) => commandId !== id));
      renderSelected();
      renderMore();
      renderResults();
    });
    deleteEl.classList.add(
      "mobile-option-setting-item-remove-icon",
      "mobile-option-setting-item-option-icon",
    );
    const upEl = this.makeIconButton("lucide-chevron-up", "Move up", () => {
      this.moveCommand(index, -1);
      renderSelected();
    });
    const downEl = this.makeIconButton("lucide-chevron-down", "Move down", () => {
      this.moveCommand(index, 1);
      renderSelected();
    });
    const dragEl = this.makeIconButton("lucide-menu", "Drag to rearrange");
    dragEl.classList.add(
      "mobile-option-setting-item-option-icon",
      "mobile-option-setting-drag-icon",
    );
    dragEl.draggable = true;
    dragEl.addEventListener("dragstart", (event) => {
      event.dataTransfer?.setData("text/plain", id);
    });
    rowEl.append(nameEl, deleteEl, upEl, downEl, dragEl);
    return rowEl;
  }

  private createMoreRow(
    command: Command,
    renderSelected: () => void,
    renderMore: () => void,
  ): HTMLElement {
    const rowEl = document.createElement("div");
    rowEl.className = "mobile-option-setting-item";
    rowEl.dataset.commandId = command.id;
    const addEl = this.makeIconButton("lucide-plus-circle", "Add", () => {
      this.saveToolbarCommands([...this.getToolbarCommands(), command.id]);
      renderSelected();
      renderMore();
    });
    addEl.classList.add(
      "mobile-option-setting-item-add-icon",
      "mobile-option-setting-item-option-icon",
    );
    const nameEl = document.createElement("div");
    nameEl.className = "mobile-option-setting-item-name";
    nameEl.textContent = command.name;
    rowEl.append(addEl, nameEl);
    return rowEl;
  }

  private makeIconButton(icon: string, label: string, callback?: () => void): HTMLElement {
    const buttonEl = document.createElement("div");
    buttonEl.className = "clickable-icon";
    buttonEl.setAttribute("aria-label", label);
    setIcon(buttonEl, icon);
    if (callback) buttonEl.addEventListener("click", callback);
    return buttonEl;
  }

  private getToolbarCommands(): string[] {
    const configured = this.app.vault.getConfig<unknown>("mobileToolbarCommands");
    return Array.isArray(configured)
      ? configured.filter((id): id is string => typeof id === "string")
      : [];
  }

  private getValidToolbarCommands(): string[] {
    const selected = this.getToolbarCommands();
    const valid = selected.filter((id) => this.app.commands.findCommand(id));
    if (valid.length !== selected.length) this.saveToolbarCommands(valid);
    return valid;
  }

  private saveToolbarCommands(ids: string[]): void {
    this.app.vault.setConfig("mobileToolbarCommands", ids);
    this.app.mobileToolbar.compileToolbar();
  }

  private moveCommand(index: number, direction: -1 | 1): void {
    const ids = this.getToolbarCommands();
    const target = index + direction;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    this.saveToolbarCommands(ids);
  }

  private reorderCommand(id: string, targetIndex: number): void {
    const ids = this.getToolbarCommands();
    const oldIndex = ids.indexOf(id);
    if (oldIndex === -1 || oldIndex === targetIndex) return;
    ids.splice(oldIndex, 1);
    ids.splice(targetIndex, 0, id);
    this.saveToolbarCommands(ids);
  }

  private applyQuery(): void {
    this.containerEl.querySelectorAll<HTMLElement>(".mobile-option-setting-item").forEach((row) => {
      if (!this.query) {
        row.style.display = "";
        return;
      }
      row.style.display = row.textContent?.toLowerCase().includes(this.query) ? "" : "none";
    });
  }
}
