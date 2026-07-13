import type { GraphPluginOptions } from "./GraphOptions";
import { cssColorToGraphColor, graphColorToCss } from "./GraphOptions";

export interface GraphControlsCallbacks {
  isLocal: boolean;
  isAnimating: () => boolean;
  onChange: () => void;
  onResetPan: () => void;
  onToggleAnimate: () => void;
}

export class GraphControls {
  private rootEl: HTMLElement | null = null;
  private searchInputEl: HTMLInputElement | null = null;
  private closed = false;

  constructor(
    private readonly options: GraphPluginOptions,
    private readonly callbacks: GraphControlsCallbacks,
  ) {
    this.closed = this.options.close.controls ?? false;
  }

  render(parentEl: HTMLElement): void {
    if (!this.rootEl) {
      this.rootEl = document.createElement("div");
      this.rootEl.className = "graph-controls";
      parentEl.prepend(this.rootEl);
    }
    this.sync();
  }

  focusSearch(): void {
    this.searchInputEl?.focus();
    this.searchInputEl?.select();
  }

  private sync(): void {
    if (!this.rootEl) return;
    this.rootEl.classList.toggle("is-close", this.closed);
    this.rootEl.replaceChildren();

    const headerEl = document.createElement("div");
    headerEl.className = "graph-controls-header";
    const closeButtonEl = this.button(
      this.closed ? "Open controls" : "Close controls",
      this.closed ? "mod-open" : "mod-close",
      () => {
        this.closed = !this.closed;
        this.options.close.controls = this.closed;
        this.callbacks.onChange();
        this.sync();
      },
    );
    const resetButtonEl = this.button("Reset pan", "mod-reset", this.callbacks.onResetPan);
    headerEl.append(closeButtonEl, resetButtonEl);

    if (!this.callbacks.isLocal) {
      const animateButtonEl = this.button(
        this.callbacks.isAnimating() ? "Stop animation" : "Animate graph",
        "mod-animate",
        this.callbacks.onToggleAnimate,
      );
      headerEl.appendChild(animateButtonEl);
    }
    this.rootEl.appendChild(headerEl);

    const bodyEl = document.createElement("div");
    bodyEl.className = "graph-controls-body";
    bodyEl.hidden = this.closed;
    bodyEl.append(
      this.renderFilters(),
      this.renderGroups(),
      this.renderDisplay(),
      this.renderForces(),
    );
    this.rootEl.appendChild(bodyEl);
  }

  private renderFilters(): HTMLElement {
    const { sectionEl, bodyEl } = this.section("Filters", "filters");
    this.searchInputEl = document.createElement("input");
    this.searchInputEl.className = "search-input graph-search-input";
    this.searchInputEl.type = "search";
    this.searchInputEl.placeholder = "Search files...";
    this.searchInputEl.value = this.options.filterOptions.query;
    this.searchInputEl.addEventListener("input", () => {
      this.options.filterOptions.query = this.searchInputEl?.value ?? "";
      this.callbacks.onChange();
    });
    bodyEl.appendChild(this.searchInputEl);

    if (this.callbacks.isLocal) {
      bodyEl.append(
        this.slider(
          "Depth",
          this.options.filterOptions.localJumps,
          1,
          5,
          1,
          (value) => (this.options.filterOptions.localJumps = Math.round(value)),
        ),
        this.checkbox(
          "Backlinks",
          this.options.filterOptions.localBacklinks,
          (checked) => (this.options.filterOptions.localBacklinks = checked),
        ),
        this.checkbox(
          "Forelinks",
          this.options.filterOptions.localForelinks,
          (checked) => (this.options.filterOptions.localForelinks = checked),
        ),
        this.checkbox(
          "Neighbor links",
          this.options.filterOptions.localInterlinks,
          (checked) => (this.options.filterOptions.localInterlinks = checked),
        ),
      );
    }

    bodyEl.append(
      this.checkbox(
        "Tags",
        this.options.filterOptions.showTags,
        (checked) => (this.options.filterOptions.showTags = checked),
      ),
      this.checkbox(
        "Attachments",
        this.options.filterOptions.showAttachments,
        (checked) => (this.options.filterOptions.showAttachments = checked),
      ),
      this.checkbox(
        "Existing files only",
        this.options.filterOptions.hideUnresolved,
        (checked) => (this.options.filterOptions.hideUnresolved = checked),
      ),
    );

    if (!this.callbacks.isLocal) {
      bodyEl.appendChild(
        this.checkbox(
          "Orphans",
          this.options.filterOptions.showOrphans,
          (checked) => (this.options.filterOptions.showOrphans = checked),
        ),
      );
    }

    return sectionEl;
  }

  private renderGroups(): HTMLElement {
    const { sectionEl, bodyEl } = this.section("Groups", "color-groups");
    const groupsEl = document.createElement("div");
    groupsEl.className = "graph-color-groups-container";

    this.options.colorGroups.forEach((group, index) => {
      const groupEl = document.createElement("div");
      groupEl.className = "graph-color-group";
      groupEl.draggable = true;

      const queryEl = document.createElement("input");
      queryEl.className = "graph-color-group-query";
      queryEl.placeholder = "Query";
      queryEl.value = group.query;
      queryEl.addEventListener("input", () => {
        group.query = queryEl.value;
        this.callbacks.onChange();
      });

      const colorEl = document.createElement("input");
      colorEl.className = "graph-color-group-color";
      colorEl.type = "color";
      colorEl.value = graphColorToCss(group.color);
      colorEl.addEventListener("input", () => {
        group.color = cssColorToGraphColor(colorEl.value, group.color.a);
        this.callbacks.onChange();
      });

      const deleteEl = this.button("Delete group", "mod-delete", () => {
        this.options.colorGroups.splice(index, 1);
        this.callbacks.onChange();
        this.sync();
      });

      groupEl.addEventListener("dragstart", (event) => {
        event.dataTransfer?.setData("text/graph-color-group", String(index));
        groupEl.classList.add("is-being-dragged");
      });
      groupEl.addEventListener("dragend", () => groupEl.classList.remove("is-being-dragged"));
      groupEl.addEventListener("dragover", (event) => event.preventDefault());
      groupEl.addEventListener("drop", (event) => {
        event.preventDefault();
        const sourceIndex = Number(event.dataTransfer?.getData("text/graph-color-group"));
        if (!Number.isInteger(sourceIndex) || sourceIndex === index) return;
        const [source] = this.options.colorGroups.splice(sourceIndex, 1);
        this.options.colorGroups.splice(index, 0, source);
        this.callbacks.onChange();
        this.sync();
      });

      groupEl.append(queryEl, colorEl, deleteEl);
      groupsEl.appendChild(groupEl);
    });

    const newGroupEl = this.button("New group", "mod-new-group", () => {
      this.options.colorGroups.push({ query: "", color: { a: 1, rgb: 0x7f6df2 } });
      this.callbacks.onChange();
      this.sync();
    });

    bodyEl.append(groupsEl, newGroupEl);
    return sectionEl;
  }

  private renderDisplay(): HTMLElement {
    const { sectionEl, bodyEl } = this.section("Display", "display");
    bodyEl.append(
      this.checkbox(
        "Show arrows",
        this.options.displayOptions.showArrow,
        (checked) => (this.options.displayOptions.showArrow = checked),
      ),
      this.slider(
        "Text fade",
        this.options.displayOptions.textFadeMultiplier,
        0,
        1,
        0.05,
        (value) => (this.options.displayOptions.textFadeMultiplier = value),
      ),
      this.slider(
        "Node size",
        this.options.displayOptions.nodeSizeMultiplier,
        0.2,
        3,
        0.1,
        (value) => (this.options.displayOptions.nodeSizeMultiplier = value),
      ),
      this.slider(
        "Link thickness",
        this.options.displayOptions.lineSizeMultiplier,
        0.2,
        3,
        0.1,
        (value) => (this.options.displayOptions.lineSizeMultiplier = value),
      ),
    );
    return sectionEl;
  }

  private renderForces(): HTMLElement {
    const { sectionEl, bodyEl } = this.section("Forces", "forces");
    bodyEl.append(
      this.slider(
        "Center force",
        this.options.forceOptions.centerStrength,
        0,
        1,
        0.01,
        (value) => (this.options.forceOptions.centerStrength = value),
      ),
      this.slider(
        "Repel force",
        this.options.forceOptions.repelStrength,
        0,
        50,
        1,
        (value) => (this.options.forceOptions.repelStrength = value),
      ),
      this.slider(
        "Link force",
        this.options.forceOptions.linkStrength,
        0,
        2,
        0.01,
        (value) => (this.options.forceOptions.linkStrength = value),
      ),
      this.slider(
        "Link distance",
        this.options.forceOptions.linkDistance,
        40,
        500,
        5,
        (value) => (this.options.forceOptions.linkDistance = value),
      ),
    );
    return sectionEl;
  }

  private section(title: string, key: string): { sectionEl: HTMLElement; bodyEl: HTMLElement } {
    const sectionEl = document.createElement("div");
    sectionEl.className = `tree-item graph-control-section mod-${key}`;
    const closeKey = `collapse-${key}`;
    const collapsed = this.options.close[closeKey] === true;
    sectionEl.classList.toggle("is-collapsed", collapsed);

    const titleEl = document.createElement("button");
    titleEl.className = "tree-item-self graph-control-section-header";
    titleEl.type = "button";
    titleEl.setAttribute("aria-expanded", String(!collapsed));
    const collapseEl = document.createElement("span");
    collapseEl.className = "collapse-indicator collapse-icon";
    collapseEl.dataset.icon = collapsed ? "lucide-chevron-right" : "lucide-chevron-down";
    const titleTextEl = document.createElement("span");
    titleTextEl.className = "graph-control-section-title";
    titleTextEl.textContent = title;
    titleEl.append(collapseEl, titleTextEl);
    titleEl.addEventListener("click", () => {
      this.options.close[closeKey] = !collapsed;
      this.callbacks.onChange();
      this.sync();
    });

    const bodyEl = document.createElement("div");
    bodyEl.className = "graph-control-section-body";
    bodyEl.hidden = collapsed;
    sectionEl.append(titleEl, bodyEl);
    return { sectionEl, bodyEl };
  }

  private checkbox(
    label: string,
    checked: boolean,
    update: (checked: boolean) => void,
  ): HTMLElement {
    const rowEl = document.createElement("label");
    rowEl.className = "graph-control-row setting-item";
    const inputEl = document.createElement("input");
    inputEl.type = "checkbox";
    inputEl.checked = checked;
    inputEl.addEventListener("change", () => {
      update(inputEl.checked);
      this.callbacks.onChange();
    });
    const labelEl = document.createElement("span");
    labelEl.textContent = label;
    rowEl.append(inputEl, labelEl);
    return rowEl;
  }

  private slider(
    label: string,
    value: number,
    min: number,
    max: number,
    step: number,
    update: (value: number) => void,
  ): HTMLElement {
    const rowEl = document.createElement("label");
    rowEl.className = "graph-control-row setting-item mod-slider";
    const labelEl = document.createElement("span");
    labelEl.textContent = label;
    const inputEl = document.createElement("input");
    inputEl.type = "range";
    inputEl.min = String(min);
    inputEl.max = String(max);
    inputEl.step = String(step);
    inputEl.value = String(value);
    const valueEl = document.createElement("span");
    valueEl.className = "graph-control-value";
    valueEl.textContent = String(value);
    inputEl.addEventListener("input", () => {
      const next = Number(inputEl.value);
      valueEl.textContent = inputEl.value;
      update(next);
      this.callbacks.onChange();
    });
    rowEl.append(labelEl, inputEl, valueEl);
    return rowEl;
  }

  private button(title: string, modifier: string, callback: () => void): HTMLButtonElement {
    const buttonEl = document.createElement("button");
    buttonEl.className = `graph-controls-button ${modifier}`;
    buttonEl.type = "button";
    buttonEl.title = title;
    buttonEl.textContent = title;
    buttonEl.addEventListener("click", callback);
    return buttonEl;
  }
}
