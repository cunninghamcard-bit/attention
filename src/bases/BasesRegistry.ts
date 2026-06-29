import type { App } from "../app/App";
import { BasesView } from "./BasesView";
import { formatValue, type BasesQueryResult, type BasesEntryGroup } from "./BasesQueryResult";
import { BasesViewConfig, type BasesFileConfig, type BasesViewDefinition } from "./BasesViewConfig";
import type { QueryController } from "./QueryController";

export interface BasesViewContext {
  app: App;
  config: BasesFileConfig;
  view: BasesViewDefinition;
  result: BasesQueryResult;
  sourcePath: string;
  refresh(): void;
}

export type BasesViewFactory = (controller: QueryController, containerEl: HTMLElement) => BasesView;

export interface BasesViewRegistration {
  name: string;
  icon: string;
  factory: BasesViewFactory;
  options?: (config: BasesViewConfig) => unknown[];
}

export interface InternalBasesViewRegistration {
  id: string;
  name: string;
  icon?: string;
  factory: BasesViewFactory;
  options?: (config: BasesViewConfig) => unknown[];
}

export class BasesRegistry {
  private registrations = new Map<string, InternalBasesViewRegistration>();

  constructor(readonly app: App) {
    this.registrations.set("table", {
      id: "table",
      name: "Table",
      icon: "lucide-table",
      factory: (controller) => new TableBasesView(controller),
    });
    this.registrations.set("cards", {
      id: "cards",
      name: "Cards",
      icon: "lucide-layout-grid",
      factory: (controller) => new CardsBasesView(controller),
    });
    this.registrations.set("list", {
      id: "list",
      name: "List",
      icon: "lucide-list",
      factory: (controller) => new ListBasesView(controller),
    });
  }

  registerBasesView(id: string, registration: BasesViewRegistration): void {
    const normalized = id.trim();
    if (!normalized) return;
    this.registrations.set(normalized, { ...registration, id: normalized });
    this.app.workspace.trigger("bases-view-register", normalized);
  }

  registerView(id: string, registration: BasesViewRegistration): void {
    this.registerBasesView(id, registration);
  }

  unregisterBasesView(id: string): void {
    this.registrations.delete(id);
    this.app.workspace.trigger("bases-view-unregister", id);
  }

  deregisterView(id: string): void {
    this.unregisterBasesView(id);
  }

  getView(id: string): InternalBasesViewRegistration | null {
    return this.registrations.get(id) ?? null;
  }

  getRegistration(id: string): InternalBasesViewRegistration | null {
    return this.getView(id);
  }

  getViewFactory(id: string): BasesViewFactory | null {
    return this.getView(id)?.factory ?? null;
  }

  listViews(): readonly InternalBasesViewRegistration[] {
    return [...this.registrations.values()];
  }

  getRegistrations(): readonly InternalBasesViewRegistration[] {
    return this.listViews();
  }
}

class TableBasesView extends BasesView {
  type = "table";

  onDataUpdated(): void {
    this.containerEl.replaceChildren();
    renderTable(this.containerEl, contextFromController(this.controller));
  }
}

class CardsBasesView extends BasesView {
  type = "cards";

  onDataUpdated(): void {
    this.containerEl.replaceChildren();
    renderCards(this.containerEl, contextFromController(this.controller));
  }
}

class ListBasesView extends BasesView {
  type = "list";

  onDataUpdated(): void {
    this.containerEl.replaceChildren();
    renderList(this.containerEl, contextFromController(this.controller));
  }
}

function contextFromController(controller: QueryController): BasesViewContext {
  return {
    app: controller.app,
    config: controller.baseConfig,
    view: controller.view,
    result: controller.data,
    sourcePath: controller.sourcePath,
    refresh: () => controller.refresh(),
  };
}

function renderCards(container: HTMLElement, context: BasesViewContext): void {
  const controller = new BasesViewConfig(context.config, context.view.id);
  const root = document.createElement("div");
  root.className = "bases-cards";
  for (const group of context.result.groupedData) {
    renderGroupHeading(root, group, controller);
    const groupEl = document.createElement("div");
    groupEl.className = "bases-card-group";
    for (const entry of group.entries) {
      const cardEl = document.createElement("div");
      cardEl.className = "bases-card";
      const titleEl = document.createElement("div");
      titleEl.className = "bases-card-title";
      titleEl.textContent = formatValue(entry.getValue("file.name"));
      cardEl.appendChild(titleEl);
      for (const property of controller.getOrder()) {
        if (property === "file.name" || property === "file.file") continue;
        const rowEl = document.createElement("div");
        rowEl.className = "bases-card-property";
        const keyEl = document.createElement("div");
        keyEl.className = "bases-card-property-name";
        keyEl.textContent = controller.getDisplayName(property);
        const valueEl = document.createElement("div");
        valueEl.className = "bases-card-property-value";
        try {
          valueEl.textContent = formatValue(entry.getValue(property));
        } catch (error) {
          valueEl.className = "bases-formula-error";
          valueEl.textContent = error instanceof Error ? error.message : String(error);
        }
        rowEl.append(keyEl, valueEl);
        cardEl.appendChild(rowEl);
      }
      groupEl.appendChild(cardEl);
    }
    root.appendChild(groupEl);
  }
  container.appendChild(root);
}

function renderList(container: HTMLElement, context: BasesViewContext): void {
  const controller = new BasesViewConfig(context.config, context.view.id);
  const root = document.createElement("div");
  root.className = "bases-list";
  for (const group of context.result.groupedData) {
    renderGroupHeading(root, group, controller);
    for (const entry of group.entries) {
      const itemEl = document.createElement("div");
      itemEl.className = "bases-list-item";
      const titleEl = document.createElement("div");
      titleEl.className = "bases-list-item-title";
      titleEl.textContent = formatValue(entry.getValue("file.name"));
      const metaEl = document.createElement("div");
      metaEl.className = "bases-list-item-properties";
      const chunks: string[] = [];
      for (const property of controller.getOrder().filter((item) => item !== "file.name")) {
        try {
          chunks.push(`${controller.getDisplayName(property)}: ${formatValue(entry.getValue(property))}`);
        } catch (error) {
          const errorEl = document.createElement("span");
          errorEl.className = "bases-formula-error";
          errorEl.textContent = error instanceof Error ? error.message : String(error);
          metaEl.appendChild(errorEl);
        }
      }
      if (chunks.length > 0) metaEl.appendChild(document.createTextNode(chunks.join(" · ")));
      itemEl.append(titleEl, metaEl);
      root.appendChild(itemEl);
    }
  }
  container.appendChild(root);
}

function renderGroupHeading(container: HTMLElement, group: BasesEntryGroup, controller: BasesViewConfig): void {
  if (!group.hasKey()) return;
  const headingEl = document.createElement("div");
  headingEl.className = "bases-group-heading";
  const propertyEl = document.createElement("span");
  propertyEl.className = "bases-group-property";
  propertyEl.textContent = controller.getGroupBy() ? controller.getDisplayName(controller.getGroupBy()?.property ?? "") : "Group";
  const valueEl = document.createElement("span");
  valueEl.className = "bases-group-value";
  valueEl.textContent = formatValue(group.key);
  headingEl.append(propertyEl, valueEl);
  container.appendChild(headingEl);
}

function renderTable(container: HTMLElement, context: BasesViewContext): void {
  const result = context.result;
  const table = document.createElement("table");
  table.className = "bases-table";
  const head = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (const column of result.columns) {
    if (column.hidden) continue;
    const th = document.createElement("th");
    th.textContent = column.title;
    if (column.width) th.style.width = `${column.width}px`;
    headRow.appendChild(th);
  }
  head.appendChild(headRow);
  table.appendChild(head);
  const body = document.createElement("tbody");
  if (result.groups?.length) {
    for (const group of result.groups) {
      const groupRow = document.createElement("tr");
      groupRow.className = "bases-group-row";
      const cell = document.createElement("td");
      cell.colSpan = result.columns.filter((column) => !column.hidden).length || 1;
      cell.textContent = group.key;
      groupRow.appendChild(cell);
      body.appendChild(groupRow);
      for (const row of group.rows) renderRow(body, row, result.columns);
    }
  } else {
    for (const row of result.rows) renderRow(body, row, result.columns);
  }
  table.appendChild(body);
  container.appendChild(table);
}

function renderRow(body: HTMLElement, row: BasesQueryResult["rows"][number], columns: BasesQueryResult["columns"]): void {
  const tr = document.createElement("tr");
  tr.dataset.path = row.path;
  for (const cell of row.cells) {
    const column = columns.find((item) => item.id === cell.columnId);
    if (column?.hidden) continue;
    const td = document.createElement("td");
    td.dataset.columnId = cell.columnId;
    if (cell.error) {
      td.className = "bases-formula-error";
      td.textContent = cell.error;
    } else {
      td.textContent = cell.display ?? "";
    }
    tr.appendChild(td);
  }
  body.appendChild(tr);
}
