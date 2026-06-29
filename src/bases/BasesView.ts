import type { App } from "../app/App";
import { Component } from "../core/Component";
import { FileView } from "../views/FileView";
import type { BasesViewContext } from "./BasesRegistry";
import type { BasesQueryResult } from "./BasesQueryResult";
import { BasesViewConfig, type BasesFileConfig, type BasesViewDefinition } from "./BasesViewConfig";
import type { PropertyValue } from "../properties/PropertyTypes";
import { DEFAULT_BASES_CONFIG } from "./BasesViewConfig";
import { normalizeBasesConfig, parseBasesConfig, serializeBasesConfig } from "./BasesConfigParser";
import { filterBasesRows, type BasesConfigFileFilter } from "./BasesFilter";
import { buildBasesQueryResult, formatValue, groupBasesQueryResult, type BasesQueryResult as RenderedBasesQueryResult } from "./BasesQueryResult";
import { parsePropertyId } from "./BasesProperty";
import { mergeFrontmatterValues, serializeFrontmatter } from "../properties/Frontmatter";
import { TFile } from "../vault/TAbstractFile";
import type { DragDropResult, DragSource, FileDragSource, FilesDragSource, LinkDragSource } from "../drag/DragManager";
import { getAttachmentFilesFromDataTransfer, hasDataTransferAttachmentFiles } from "../app/AttachmentImport";
import { QueryController } from "./QueryController";

export abstract class BasesView extends Component {
  abstract type: string;
  readonly app: App;
  readonly containerEl = document.createElement("div");
  config: BasesViewConfig;
  fileConfig: BasesFileConfig;
  allProperties: string[];
  data: BasesQueryResult;
  readonly controller: QueryController;

  constructor(readonly context: BasesViewContext | QueryController) {
    super();
    this.controller = context instanceof QueryController ? context : new QueryController(context);
    this.app = this.controller.app;
    this.config = this.controller.config;
    this.fileConfig = this.controller.baseConfig;
    this.data = this.controller.data;
    this.allProperties = this.controller.allProperties;
    this.containerEl.className = "bases-custom-view";
  }

  updateContext(context: BasesViewContext): void {
    this.controller.updateContext(context);
    this.config = this.controller.config;
    this.fileConfig = this.controller.baseConfig;
    this.data = this.controller.data;
    this.allProperties = this.controller.allProperties;
    this.onDataUpdated();
  }

  createFileForView(values?: Record<string, PropertyValue>): Promise<TFile>;
  createFileForView(baseFileName?: string, frontmatterProcessor?: (frontmatter: any) => void): Promise<void>;
  async createFileForView(valuesOrBaseFileName: Record<string, PropertyValue> | string = {}, frontmatterProcessor?: (frontmatter: any) => void): Promise<TFile | void> {
    if (typeof valuesOrBaseFileName === "string") {
      const values: Record<string, PropertyValue> = {};
      frontmatterProcessor?.(values);
      await createFileForConfig(this.app, this.fileConfig, values, valuesOrBaseFileName || "Untitled");
      return;
    }
    return createFileForConfig(this.app, this.fileConfig, valuesOrBaseFileName);
  }

  abstract onDataUpdated(): void;
}

export class BasesFileView extends FileView {
  config: BasesFileConfig = structuredClone(DEFAULT_BASES_CONFIG);
  icon = "lucide-table";

  getViewType(): string { return "bases"; }
  getDisplayText(): string { return this.config.name; }

  async setState(state: unknown): Promise<void> {
    await super.setState(state);
    if (this.file) {
      const source = await this.app.vault.read(this.file);
      this.config = parseBasesConfig(source, this.file.path);
    } else if (state && typeof state === "object") {
      this.config = normalizeBasesConfig(state as Partial<BasesFileConfig>);
    }
    this.render();
  }

  async onOpen(): Promise<void> {
    this.contentEl.classList.add("bases-view");
    this.registerEvent(this.app.vault.on("modify", (file) => {
      const changedFile = file as { path?: string };
      if (changedFile.path === this.file?.path) void this.reloadFile();
    }));
    this.registerEvent(this.app.workspace.on("property-change", () => this.render()));
    this.registerEvent(this.app.workspace.on("property-rename", () => this.render()));
    this.registerEvent(this.app.workspace.on("property-delete", () => this.render()));
    this.render();
  }

  render(): void {
    this.contentEl.replaceChildren();
    this.updateHeader();
    renderBases(this.app, this.contentEl, this.config, this.file?.path ?? "", () => this.render(), (config) => this.saveConfig(config));
  }

  private async reloadFile(): Promise<void> {
    if (!this.file) return;
    const source = await this.app.vault.read(this.file);
    this.config = parseBasesConfig(source, this.file.path);
    this.render();
  }

  private async saveConfig(config = this.config): Promise<void> {
    if (!this.file) return;
    await this.app.vault.modify(this.file, serializeBasesConfig(config));
  }
}

export function renderBases(
  app: App,
  container: HTMLElement,
  config: BasesFileConfig,
  sourcePath = "",
  refresh = () => {},
  save?: (config: BasesFileConfig) => void | Promise<void>,
): void {
  container.classList.add("bases-view");
  const activeView = getActiveView(config);
  const viewConfig = new BasesViewConfig(config, activeView.id);
  const query = app.query.run(config.query);
  const filteredRows = filterBasesRows(query.rows, config.filter, config.formulas);
  let result = buildBasesQueryResult(filteredRows, config.columns, filteredRows.length, config.formulas);
  const group = viewConfig.getGroupBy();
  if (group) result = groupBasesQueryResult(result, group.property);

  renderToolbar(app, container, config, activeView, result.total, refresh, save);
  const bodyEl = document.createElement("div");
  bodyEl.className = "bases-view-body";
  app.dragManager.handleDrop(bodyEl, (event, source, hovering) => handleBasesDrop(app, event, source, hovering, bodyEl, config, sourcePath, refresh), true);
  const registration = app.bases.getView(activeView.type) ?? app.bases.getView("table");
  if (!registration) {
    bodyEl.textContent = `No Bases renderer registered for ${activeView.type}`;
    container.appendChild(bodyEl);
    return;
  }
  const context = {
    app,
    config,
    view: activeView,
    result,
    sourcePath,
    refresh,
  };
  const controller = new QueryController(context);
  const view = registration.factory(controller, bodyEl);
  if (view.containerEl.parentElement !== bodyEl) bodyEl.appendChild(view.containerEl);
  view.load();
  view.onDataUpdated();
  container.appendChild(bodyEl);
  renderSummaries(container, config, activeView, result);
}

function handleBasesDrop(
  app: App,
  event: DragEvent,
  source: DragSource | null,
  hovering: boolean,
  hoverEl: HTMLElement,
  config: BasesFileConfig,
  sourcePath: string,
  refresh: () => void,
): DragDropResult {
  if (source) {
    const files = collectInternalBaseDropFiles(app, source);
    if (!files.length) return undefined;
    if (!hovering) void applyFilesToBase(app, config, files, refresh);
    return {
      dropEffect: "copy",
      hoverEl,
      hoverClass: "is-being-dragged-over",
    };
  }

  if (!hasDataTransferAttachmentFiles(event.dataTransfer)) return undefined;
  if (!hovering) {
    const records = getAttachmentFilesFromDataTransfer(event.dataTransfer);
    const inferred = inferNewItem(config);
    const targetFolder = inferred.folder ? app.vault.getFolderByPath(inferred.folder) : null;
    const sourceFile = sourcePath ? app.vault.getFileByPath(sourcePath) : app.workspace.getActiveFile();
    void app.importAttachments(records, targetFolder, sourceFile)
      .then((files) => applyFilesToBase(app, config, files, refresh));
  }
  return {
    action: "Import attachments",
    dropEffect: "copy",
    hoverEl,
    hoverClass: "is-being-dragged-over",
  };
}

function collectInternalBaseDropFiles(app: App, source: DragSource): TFile[] {
  if (isFileDragSource(source) || isLinkDragSource(source)) return source.file instanceof TFile ? [source.file] : [];
  if (isFilesDragSource(source)) return source.files.filter((file): file is TFile => file instanceof TFile);
  if (isBookmarksDragSource(source)) {
    return source.items.flatMap((item) => {
      if (item.item.type !== "file" || typeof item.item.path !== "string") return [];
      const file = app.vault.getFileByPath(item.item.path);
      return file instanceof TFile ? [file] : [];
    });
  }
  return [];
}

async function applyFilesToBase(app: App, config: BasesFileConfig, files: TFile[], refresh: () => void): Promise<void> {
  const inferred = inferNewItem(config);
  const targetFolder = inferred.folder ? app.vault.getFolderByPath(inferred.folder) : null;
  const hasFrontmatterValues = Object.keys(inferred.values).length > 0;

  for (const file of files) {
    let current = file;
    if (current.extension === "md" && hasFrontmatterValues) {
      await app.fileManager.processFrontMatter(current, (frontmatter) => {
        mergeFrontmatterValues(frontmatter, inferred.values);
      });
    }

    if (targetFolder && current.parentPath !== targetFolder.path) {
      const folderPrefix = targetFolder.path && targetFolder.path !== "/" ? `${targetFolder.path}/` : "";
      const targetPath = app.vault.getAvailablePath(`${folderPrefix}${current.basename}`, current.extension);
      current = await app.fileManager.renameAbstractFile(current, targetPath) as TFile;
    }

    if (current.extension === "md") await app.metadataCache.computeFileMetadata(current);
  }

  refresh();
}

function isFileDragSource(source: DragSource): source is FileDragSource {
  return source.type === "file" && (source as Partial<FileDragSource>).file instanceof TFile;
}

function isFilesDragSource(source: DragSource): source is FilesDragSource {
  return source.type === "files" && Array.isArray((source as Partial<FilesDragSource>).files);
}

function isLinkDragSource(source: DragSource): source is LinkDragSource {
  return source.type === "link";
}

function isBookmarksDragSource(source: DragSource): source is DragSource & { type: "bookmarks"; items: Array<{ item: { type: string; path?: string } }> } {
  return source.type === "bookmarks" && Array.isArray((source as { items?: unknown }).items);
}


function renderToolbar(
  app: App,
  container: HTMLElement,
  config: BasesFileConfig,
  activeView: BasesViewDefinition,
  total: number,
  refresh: () => void,
  save?: (config: BasesFileConfig) => void | Promise<void>,
): void {
  const toolbarEl = document.createElement("div");
  toolbarEl.className = "bases-toolbar";
  const titleEl = document.createElement("div");
  titleEl.className = "bases-toolbar-title";
  titleEl.textContent = config.name;

  const viewSelectEl = document.createElement("select");
  viewSelectEl.className = "bases-view-select";
  for (const view of config.views ?? []) {
    const optionEl = document.createElement("option");
    optionEl.value = view.id;
    optionEl.textContent = view.name;
    optionEl.selected = view.id === activeView.id;
    viewSelectEl.appendChild(optionEl);
  }
  viewSelectEl.addEventListener("change", () => {
    config.activeView = viewSelectEl.value;
    const next = normalizeBasesConfig(config, config.sourcePath);
    Object.assign(config, next);
    void save?.(config);
    refresh();
  });

  const summaryEl = document.createElement("div");
  summaryEl.className = "bases-toolbar-summary";
  summaryEl.textContent = `${total} result${total === 1 ? "" : "s"}`;

  const filterEl = document.createElement("div");
  filterEl.className = "bases-toolbar-filter";
  filterEl.textContent = `${config.query.filters?.length ?? 0} filter${(config.query.filters?.length ?? 0) === 1 ? "" : "s"}`;

  const sortEl = document.createElement("div");
  sortEl.className = "bases-toolbar-sort";
  sortEl.textContent = `${config.query.sort?.length ?? 0} sort${(config.query.sort?.length ?? 0) === 1 ? "" : "s"}`;

  const addColumnButton = document.createElement("button");
  addColumnButton.textContent = "Add column";
  addColumnButton.addEventListener("click", () => {
    const property = window.prompt("Property");
    if (!property?.trim()) return;
    config.columns.push({
      id: property.trim(),
      property: property.trim(),
      title: property.trim(),
      type: app.metadataTypeManager.getAssignedWidget(property.trim()) ?? app.metadataTypeManager.inferType(property.trim()),
    });
    void save?.(config);
    refresh();
  });

  const newButton = document.createElement("button");
  newButton.textContent = "New";
  newButton.addEventListener("click", () => {
    void createFileForConfig(app, config).then((file) => app.workspace.openFile(file, { active: true }));
  });

  const saveButton = document.createElement("button");
  saveButton.textContent = "Save";
  saveButton.disabled = !save;
  saveButton.addEventListener("click", () => void save?.(config));

  toolbarEl.append(titleEl, viewSelectEl, summaryEl, filterEl, sortEl, addColumnButton, newButton, saveButton);
  container.appendChild(toolbarEl);
}

function getActiveView(config: BasesFileConfig): BasesViewDefinition {
  return config.views?.find((view) => view.id === config.activeView)
    ?? config.views?.[0]
    ?? { id: "table", name: "Table", type: "table", columns: config.columns };
}

async function createFileForConfig(app: App, config: BasesFileConfig, values: Record<string, PropertyValue> = {}, baseFileName = "Untitled"): Promise<TFile> {
  const inferred = inferNewItem(config);
  const folder = config.newItemFolder ?? inferred.folder ?? "";
  const file = await app.fileManager.createNewMarkdownFile(folder, baseFileName);
  let body = "";
  const frontmatter = { ...inferred.values, ...values };
  if (config.newItemTemplate) {
    const template = app.vault.getFileByPath(config.newItemTemplate);
    if (template) {
      body = await app.vault.read(template);
      if (!config.newItemFolder && !folder && template.parentPath) {
        const moved = await app.fileManager.renameAbstractFile(file, `${template.parentPath}/${file.name}`) as TFile;
        await app.vault.modify(moved, `${serializeFrontmatter(frontmatter)}${body}`);
        return moved;
      }
    }
  }
  await app.vault.modify(file, `${serializeFrontmatter(frontmatter)}${body}`);
  return file;
}

function inferNewItem(config: BasesFileConfig): { values: Record<string, PropertyValue>; folder?: string } {
  const values: Record<string, PropertyValue> = {};
  const activeView = getActiveView(config);
  const controller = new BasesViewConfig(config, activeView.id);
  for (const property of controller.getOrder()) {
    const parsed = parsePropertyId(property);
    if (parsed.type === "note" && !(parsed.name in values)) values[parsed.name] = null;
  }
  const inferred = inferFromFilter(config.filter);
  Object.assign(values, inferred.values);
  const queryInferred = inferFromQueryFilters(config.query.filters);
  Object.assign(values, queryInferred.values);
  return { values, folder: config.newItemFolder ?? inferred.folder ?? queryInferred.folder };
}

function inferFromQueryFilters(filters: BasesFileConfig["query"]["filters"]): { values: Record<string, PropertyValue>; folder?: string } {
  const result: { values: Record<string, PropertyValue>; folder?: string } = { values: {} };
  for (const filter of filters ?? []) {
    const parsed = parsePropertyId(filter.property);
    if (parsed.type === "file" && parsed.name === "folder" && filter.operator === "equals" && typeof filter.value === "string") {
      result.folder ??= filter.value;
    }
    if (parsed.type !== "note") continue;
    if (filter.operator === "exists" && !(parsed.name in result.values)) result.values[parsed.name] = null;
    if ((filter.operator === "equals" || filter.operator === "contains") && filter.value != null) {
      result.values[parsed.name] = parsed.name === "tags" ? [String(filter.value)] : filter.value;
    }
  }
  return result;
}

function inferFromFilter(filter: BasesConfigFileFilter | undefined): { values: Record<string, PropertyValue>; folder?: string } {
  const result: { values: Record<string, PropertyValue>; folder?: string } = { values: {} };
  if (!filter) return result;
  if (typeof filter === "string") return inferFromFilterString(filter);
  if ("and" in filter) {
    for (const child of filter.and) {
      const inferred = inferFromFilter(child);
      Object.assign(result.values, inferred.values);
      result.folder ??= inferred.folder;
    }
  }
  return result;
}

function inferFromFilterString(source: string): { values: Record<string, PropertyValue>; folder?: string } {
  const trimmed = source.trim();
  const result: { values: Record<string, PropertyValue>; folder?: string } = { values: {} };
  const hasTag = /^hasTag\(["'](.+)["']\)$/.exec(trimmed) ?? /^file\.hasTag\(["'](.+)["']\)$/.exec(trimmed);
  if (hasTag) result.values.tags = [hasTag[1]];
  const inFolder = /^inFolder\(["'](.+)["']\)$/.exec(trimmed) ?? /^file\.inFolder\(["'](.+)["']\)$/.exec(trimmed);
  if (inFolder) result.folder = inFolder[1];
  const hasProperty = /^hasProperty\(["'](.+)["']\)$/.exec(trimmed);
  if (hasProperty) {
    const parsed = parsePropertyId(hasProperty[1]);
    if (parsed.type === "note") result.values[parsed.name] = null;
  }
  const isEmpty = /^isEmpty\((.+)\)$/.exec(trimmed);
  if (isEmpty) {
    const parsed = parsePropertyId(isEmpty[1].trim());
    if (parsed.type === "note") result.values[parsed.name] = "";
  }
  const equals = /^(.+?)\s*={1,2}\s*["']?([^"']+)["']?$/.exec(trimmed);
  if (equals) {
    const parsed = parsePropertyId(equals[1].trim());
    if (parsed.type === "file" && parsed.name === "folder") result.folder = equals[2].trim();
    if (parsed.type === "note") result.values[parsed.name] = equals[2].trim();
  }
  return result;
}

function renderSummaries(container: HTMLElement, config: BasesFileConfig, activeView: BasesViewDefinition, result: RenderedBasesQueryResult): void {
  const summaries = activeView.summaries ?? {};
  const entries = Object.entries(summaries);
  if (entries.length === 0) return;
  const summaryEl = document.createElement("div");
  summaryEl.className = "bases-summary";
  for (const [property, summaryKey] of entries) {
    const itemEl = document.createElement("div");
    itemEl.className = "bases-summary-item";
    const labelEl = document.createElement("span");
    labelEl.className = "bases-summary-property";
    labelEl.textContent = property;
    const valueEl = document.createElement("span");
    valueEl.className = "bases-summary-value";
    try {
      valueEl.textContent = formatValue(computeSummary(result, property, summaryKey, config));
    } catch (error) {
      valueEl.className = "bases-formula-error";
      valueEl.textContent = error instanceof Error ? error.message : String(error);
    }
    itemEl.append(labelEl, valueEl);
    summaryEl.appendChild(itemEl);
  }
  container.appendChild(summaryEl);
}

function computeSummary(result: RenderedBasesQueryResult, property: string, summaryKey: string, config: BasesFileConfig): unknown {
  if (summaryKey === "count" || summaryKey === "sum" || summaryKey === "average" || summaryKey === "avg" || summaryKey === "min" || summaryKey === "max" || summaryKey === "unique" || summaryKey === "values") {
    return result.getSummaryValue(null, result.data, property, summaryKey);
  }
  return config.summaries?.[summaryKey] ?? summaryKey;
}
