import type { App } from "../../app/App";
import { TFile, TFolder } from "../../vault/TAbstractFile";

export interface DragSource {
  type: string;
  source?: string;
  icon?: string;
  title?: string;
  payload: unknown;
  elements: HTMLElement[];
}

export type FileDragSource = DragSource & {
  type: "file";
  file: TFile;
};

export type FilesDragSource = DragSource & {
  type: "files";
  files: Array<TFile | TFolder>;
};

export type FolderDragSource = DragSource & {
  type: "folder";
  file: TFolder;
};

export type LinkDragSource = DragSource & {
  type: "link";
  linktext: string;
  sourcePath: string;
  file: TFile | null;
};

export type DragDropResult = {
  action?: string;
  dropEffect?: DataTransfer["dropEffect"];
  hoverEl?: HTMLElement;
  hoverClass?: string;
} | void;

export class DragManager {
  readonly overlayEl = document.createElement("div");
  readonly actionEl = document.createElement("div");
  private source: DragSource | null = null;
  private sourceDraggingClass = "is-being-dragged";
  private hoverEl: HTMLElement | null = null;
  private hoverClass = "";

  constructor(readonly app: App) {
    this.overlayEl.className = "workspace-drop-overlay";
    this.actionEl.className = "drag-ghost-action";
    this.actionEl.style.position = "fixed";
    this.actionEl.style.pointerEvents = "none";
    this.actionEl.style.zIndex = "var(--layer-popover)";
  }

  setSource(source: DragSource, draggingClass = "is-being-dragged"): void {
    if (this.source) this.clearSource();
    this.source = source;
    this.sourceDraggingClass = draggingClass;
    for (const el of source.elements) el.classList.add(draggingClass);
    document.body.classList.add("is-grabbing");
  }

  clearSource(): void {
    if (this.source) {
      for (const el of this.source.elements) el.classList.remove(this.sourceDraggingClass);
    }
    this.source = null;
    this.sourceDraggingClass = "is-being-dragged";
    this.clearPreview();
    document.body.classList.remove("is-grabbing");
  }

  getSource(): DragSource | null {
    return this.source;
  }

  handleDrag(el: HTMLElement, createSource: (event: DragEvent) => DragSource | null): void {
    el.draggable = true;
    el.addEventListener("dragstart", (event) => {
      const source = createSource(event);
      if (!source) {
        event.preventDefault();
        return;
      }
      if (!event.dataTransfer?.getData("text/plain")) this.writeFallbackData(event, source.title || "-");
      if (event.dataTransfer) event.dataTransfer.effectAllowed = "all";
      this.setSource(source);
    });
    el.addEventListener("dragend", () => this.clearSource());
  }

  handleDrop(el: HTMLElement, callback: (event: DragEvent, source: DragSource | null, hovering: boolean) => DragDropResult, allowExternal = false): void {
    const preview = (event: DragEvent): void => {
      if (!this.source && !allowExternal) return;
      const result = callback(event, this.source, true);
      if (!result) {
        this.clearPreview();
        return;
      }
      event.preventDefault();
      if (result.dropEffect) setAllowedDropEffect(event, result.dropEffect);
      this.setAction(result.action ?? null, el.ownerDocument);
      this.updateActionPosition(event);
      this.updateHover(result.hoverEl ?? null, result.hoverClass ?? "");
    };
    el.addEventListener("dragover", preview);
    el.addEventListener("dragenter", preview);
    el.addEventListener("dragleave", () => this.clearPreview());
    el.addEventListener("drop", (event) => {
      if (!this.source && !allowExternal) return;
      const result = callback(event, this.source, false);
      if (result) {
        event.preventDefault();
        if (result.dropEffect) setAllowedDropEffect(event, result.dropEffect);
      }
      if (this.source) this.clearSource();
      else this.clearPreview();
    });
  }

  dragFile(event: DragEvent, file: TFile, source?: string, elements: HTMLElement[] = []): FileDragSource {
    this.writeUriList(event, this.app.getObsidianUrl(file));
    return {
      ...(source === undefined ? {} : { source }),
      type: "file",
      icon: "lucide-file",
      title: file.basename,
      payload: file,
      elements,
      file,
    };
  }

  dragFiles(event: DragEvent, files: Array<TFile | TFolder>, source?: string, elements: HTMLElement[] = []): FilesDragSource {
    const urls = files.filter((file): file is TFile => file instanceof TFile).map((file) => this.app.getObsidianUrl(file));
    if (urls.length > 0) this.writeUriList(event, urls.join("\n"));
    return {
      ...(source === undefined ? {} : { source }),
      type: "files",
      icon: "lucide-files",
      title: `${files.length} ${files.length === 1 ? "file" : "files"}`,
      payload: files,
      elements,
      files,
    };
  }

  dragFolder(event: DragEvent, folder: TFolder, source?: string, elements: HTMLElement[] = []): FolderDragSource {
    this.writeFallbackData(event, folder.name);
    return {
      ...(source === undefined ? {} : { source }),
      type: "folder",
      icon: "lucide-folder-open",
      title: folder.name,
      payload: folder,
      elements,
      file: folder,
    };
  }

  dragLink(event: DragEvent, linktext: string, sourcePath: string, source = "markdown", elements: HTMLElement[] = []): LinkDragSource {
    const parsedPath = linktext.split("|", 1)[0]?.split("#", 1)[0] ?? linktext;
    const file = this.app.metadataCache.getFirstLinkpathDest(parsedPath, sourcePath);
    this.writeUriList(event, file ? this.app.getObsidianUrl(file) : linktext);
    return {
      source,
      type: "link",
      icon: "lucide-link",
      title: file?.basename ?? linktext,
      payload: { linktext, sourcePath, file },
      elements,
      linktext,
      sourcePath,
      file,
    };
  }

  updateHover(el: HTMLElement | null, hoverClass: string): void {
    if (this.hoverEl && this.hoverClass) this.hoverEl.classList.remove(this.hoverClass);
    this.hoverEl = el;
    this.hoverClass = hoverClass;
    if (this.hoverEl && this.hoverClass) this.hoverEl.classList.add(this.hoverClass);
  }

  clearPreview(): void {
    this.updateHover(null, "");
    this.hideOverlay();
    this.setAction(null);
  }

  showOverlay(rect: DOMRect | { x: number; y: number; width: number; height: number }): void {
    this.overlayEl.style.transform = `translate(${rect.x}px, ${rect.y}px)`;
    this.overlayEl.style.width = `${rect.width}px`;
    this.overlayEl.style.height = `${rect.height}px`;
    document.body.appendChild(this.overlayEl);
  }

  hideOverlay(): void {
    this.overlayEl.remove();
  }

  setAction(action: string | null | undefined, ownerDocument: Document = document): void {
    const label = action?.trim() ?? "";
    if (!label) {
      this.actionEl.textContent = "";
      this.actionEl.remove();
      return;
    }
    this.actionEl.textContent = label;
    ownerDocument.body.appendChild(this.actionEl);
  }

  private updateActionPosition(event: DragEvent): void {
    if (!this.actionEl.isConnected) return;
    this.actionEl.style.left = `${event.clientX + 12}px`;
    this.actionEl.style.top = `${event.clientY + 12}px`;
  }

  private writeUriList(event: DragEvent, value: string): void {
    event.dataTransfer?.setData("text/plain", value);
    event.dataTransfer?.setData("text/uri-list", value);
  }

  private writeFallbackData(event: DragEvent, value: string): void {
    event.dataTransfer?.setData("text/plain", value);
  }
}

export function setAllowedDropEffect(event: DragEvent, effect: DataTransfer["dropEffect"]): void {
  if (!event.dataTransfer || !isDropEffectAllowed(event.dataTransfer.effectAllowed, effect)) return;
  event.dataTransfer.dropEffect = effect;
}

export function isDropEffectAllowed(effectAllowed: DataTransfer["effectAllowed"], effect: DataTransfer["dropEffect"]): boolean {
  if (effect === "none") return false;
  if (effectAllowed === "all") return true;
  if (!effectAllowed || effectAllowed === "none" || effectAllowed === "uninitialized") return false;
  if (effectAllowed === effect) return true;
  if (effectAllowed === "copyMove") return effect === "copy" || effect === "move";
  if (effectAllowed === "copyLink") return effect === "copy" || effect === "link";
  if (effectAllowed === "linkMove") return effect === "link" || effect === "move";
  return false;
}
