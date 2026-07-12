import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../app/App";
import { Platform } from "../../platform/Platform";
import { fuzzySearch, prepareQuery } from "../../search/SearchHelpers";
import { FuzzySuggestModal, fuzzyMatch, GroupedSuggestChooser, prepareFuzzyQuery, SuggestChooser, SuggestModal, type SuggestOwner } from "./SuggestModal";

class RecordingSuggestModal extends SuggestModal<string> {
  readonly chosen: Array<{ value: string; event: MouseEvent | KeyboardEvent }> = [];
  readonly selected: Array<{ value: string; event: MouseEvent | KeyboardEvent | null }> = [];

  constructor(app: App, readonly values: string[]) {
    super(app);
  }

  getSuggestions(): string[] {
    return this.values;
  }

  renderSuggestion(value: string, el: HTMLElement): void {
    el.textContent = value;
  }

  onChooseSuggestion(value: string, event: MouseEvent | KeyboardEvent): void {
    this.chosen.push({ value, event });
  }

  override onSelectedChange(value: string, event: MouseEvent | KeyboardEvent | null): void {
    this.selected.push({ value, event });
  }
}

class RecordingFuzzySuggestModal extends FuzzySuggestModal<string> {
  constructor(app: App, readonly values: string[]) {
    super(app);
  }

  getItems(): string[] {
    return this.values;
  }

  getItemText(item: string): string {
    return item;
  }

  onChooseItem(): void {}
}

describe("SuggestModal Obsidian chooser behavior", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
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
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
  });

  it("selects before choosing clicked suggestions and records mouse modifiers", () => {
    const app = new App(document.createElement("div"));
    const modal = new RecordingSuggestModal(app, ["Alpha", "Beta"]);
    modal.chooser.setSuggestions(["Alpha", "Beta"]);
    const betaEl = modal.resultContainerEl.querySelectorAll<HTMLElement>(".suggestion-item")[1];
    const event = new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true, shiftKey: true });

    betaEl.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(betaEl.classList.contains("is-selected")).toBe(true);
    expect(modal.selected.map((entry) => entry.value)).toEqual(["Alpha", "Beta"]);
    expect(modal.chosen).toEqual([{ value: "Beta", event }]);
    expect(app.keymap.modifiers).toBe("Ctrl,Shift");
  });

  it("applies array suggestions synchronously on input", () => {
    const app = new App(document.createElement("div"));
    const modal = new RecordingSuggestModal(app, ["Alpha", "Beta"]);

    modal.inputEl.value = "a";
    modal.inputEl.dispatchEvent(new Event("input"));

    expect([...modal.resultContainerEl.querySelectorAll(".suggestion-item")].map((el) => el.textContent)).toEqual(["Alpha", "Beta"]);
  });

  it("uses the shared Obsidian fuzzy helpers in FuzzySuggestModal", () => {
    const app = new App(document.createElement("div"));
    const modal = new RecordingFuzzySuggestModal(app, ["Quick Switcher", "Quiet Space", "Search files"]);
    const query = prepareFuzzyQuery("qs");

    expect(fuzzyMatch(query, "Quick Switcher")).toEqual(fuzzySearch(prepareQuery("qs"), "Quick Switcher"));

    const suggestions = modal.getSuggestions(" qs ");
    const scores = suggestions.map((suggestion) => suggestion.match.score);

    expect(suggestions.map((suggestion) => suggestion.item).sort()).toEqual(["Quick Switcher", "Quiet Space"]);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));

    const el = document.createElement("div");
    modal.renderSuggestion(suggestions[0], el);

    expect(el.querySelectorAll(".suggestion-highlight")).toHaveLength(suggestions[0].match.matches.length);
  });

  it("wraps keyboard selection and fires onSelectedChange", () => {
    const app = new App(document.createElement("div"));
    const modal = new RecordingSuggestModal(app, ["Alpha", "Beta"]);
    modal.chooser.setSuggestions(["Alpha", "Beta"]);
    const event = new KeyboardEvent("keydown", { key: "ArrowUp" });

    expect(modal.scope.handleKey(event)).toBe(false);

    expect(modal.chooser.selectedItem).toBe(1);
    expect(modal.selected.map((entry) => entry.value)).toEqual(["Alpha", "Beta"]);
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it("uses Obsidian scroll-page boundaries for PageUp and PageDown", () => {
    const app = new App(document.createElement("div"));
    const values = Array.from({ length: 10 }, (_, index) => `Item ${index}`);
    const modal = new RecordingSuggestModal(app, values);
    modal.chooser.setSuggestions(values);
    Object.defineProperty(modal.resultContainerEl, "clientHeight", { configurable: true, value: 80 });
    modal.resultContainerEl.scrollTop = 40;
    modal.resultContainerEl.style.paddingTop = "0px";
    for (const itemEl of modal.resultContainerEl.querySelectorAll<HTMLElement>(".suggestion-item")) {
      Object.defineProperty(itemEl, "clientHeight", { configurable: true, value: 20 });
    }

    expect(modal.scope.handleKey(new KeyboardEvent("keydown", { key: "PageDown" }))).toBe(false);
    expect(modal.chooser.selectedItem).toBe(5);

    expect(modal.scope.handleKey(new KeyboardEvent("keydown", { key: "PageDown" }))).toBe(false);
    expect(modal.chooser.selectedItem).toBe(9);

    expect(modal.scope.handleKey(new KeyboardEvent("keydown", { key: "PageUp" }))).toBe(false);
    expect(modal.chooser.selectedItem).toBe(2);

    expect(modal.scope.handleKey(new KeyboardEvent("keydown", { key: "PageUp" }))).toBe(false);
    expect(modal.chooser.selectedItem).toBe(0);
  });

  it("does not move arrow/page selection while composing", () => {
    const app = new App(document.createElement("div"));
    const modal = new RecordingSuggestModal(app, ["Alpha", "Beta"]);
    modal.chooser.setSuggestions(["Alpha", "Beta"]);

    expect(modal.scope.handleKey(new KeyboardEvent("keydown", { key: "ArrowDown", isComposing: true }))).toBeUndefined();
    expect(modal.chooser.selectedItem).toBe(0);
    expect(modal.scope.handleKey(new KeyboardEvent("keydown", { key: "PageDown", isComposing: true }))).toBeUndefined();
    expect(modal.chooser.selectedItem).toBe(0);
  });

  it("selects duplicate values by hovered DOM element rather than first matching value", () => {
    const selected: Array<{ value: string; event: MouseEvent | KeyboardEvent | null }> = [];
    const owner: SuggestOwner<string> = {
      renderSuggestion(value, el) {
        el.textContent = value;
      },
      selectSuggestion() {},
      onSelectedChange(value, event) {
        selected.push({ value, event });
      },
    };
    const containerEl = document.createElement("div");
    const chooser = new SuggestChooser(owner, containerEl);
    const values = ["Same", "Same"];

    chooser.setSuggestions(values);
    const second = containerEl.querySelectorAll<HTMLElement>(".suggestion-item")[1];
    second.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));

    expect(chooser.selectedItem).toBe(1);
    expect(selected.at(-1)?.value).toBe(values[1]);
  });

  it("uses modal scope Enter to choose the active suggestion", () => {
    const app = new App(document.createElement("div"));
    const modal = new RecordingSuggestModal(app, ["Alpha", "Beta"]);
    modal.chooser.setSuggestions(["Alpha", "Beta"]);
    modal.chooser.setSelectedItem(1, new KeyboardEvent("keydown", { key: "End" }));
    const event = new KeyboardEvent("keydown", { key: "Enter" });

    expect(modal.scope.handleKey(event)).toBe(false);

    expect(modal.chosen).toEqual([{ value: "Beta", event }]);
    expect(app.keymap.modifiers).toBe("");
  });

  it("uses Obsidian's platform prompt chrome and macOS Ctrl-p/Ctrl-n navigation", () => {
    const originalPhone = Platform.isPhone;
    const originalAndroid = Platform.isAndroidApp;
    const originalMac = Platform.isMacOS;
    const originalIos = Platform.isIosApp;
    try {
      Platform.isPhone = true;
      Platform.isAndroidApp = false;
      Platform.isMacOS = true;
      Platform.isIosApp = false;
      const app = new App(document.createElement("div"));
      const modal = new RecordingSuggestModal(app, ["Alpha", "Beta"]);

      expect(modal.inputEl.enterKeyHint).toBe("done");
      expect(modal.inputEl.parentElement?.classList.contains("mod-raised")).toBe(true);

      modal.chooser.setSuggestions(["Alpha", "Beta"]);

      expect(modal.scope.handleKey(new KeyboardEvent("keydown", { key: "p", ctrlKey: true }))).toBe(false);
      expect(modal.chooser.selectedItem).toBe(1);

      expect(modal.scope.handleKey(new KeyboardEvent("keydown", { key: "n", ctrlKey: true }))).toBe(false);
      expect(modal.chooser.selectedItem).toBe(0);
    } finally {
      Platform.isPhone = originalPhone;
      Platform.isAndroidApp = originalAndroid;
      Platform.isMacOS = originalMac;
      Platform.isIosApp = originalIos;
    }
  });

  it("renders grouped suggestions as suggestion-group wrappers with data-group", () => {
    interface GroupedValue {
      group: string;
      label: string;
    }

    const selected: GroupedValue[] = [];
    const owner: SuggestOwner<GroupedValue> = {
      renderSuggestion(value, el) {
        el.textContent = value.label;
      },
      selectSuggestion(value) {
        selected.push(value);
      },
      onSelectedChange() {},
    };
    const containerEl = document.createElement("div");
    const chooser = new GroupedSuggestChooser(owner, containerEl);

    chooser.setSuggestions([
      { group: "views", label: "Table" },
      { group: "views", label: "Cards" },
      { group: "actions", label: "Add view" },
    ]);

    const groups = [...containerEl.querySelectorAll<HTMLElement>(".suggestion-group")];

    expect(groups.map((group) => group.dataset.group)).toEqual(["views", "actions"]);
    expect(groups[0]?.querySelectorAll(".suggestion-item")).toHaveLength(2);
    expect(groups[1]?.querySelector(".suggestion-item")?.textContent).toBe("Add view");
    expect(containerEl.querySelector(".suggestion-item")?.classList.contains("is-selected")).toBe(true);

    groups[1]?.querySelector<HTMLElement>(".suggestion-item")?.click();

    expect(selected).toEqual([{ group: "actions", label: "Add view" }]);
  });
});
