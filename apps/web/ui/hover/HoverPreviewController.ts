import type { App } from "../../app/App";
import { HoverPopover } from "../Popover";
import { MarkdownRenderer } from "../../markdown/MarkdownRenderer";
import type { TFile } from "../../vault/TAbstractFile";

export interface HoverPreviewRequest {
  source: string;
  linktext: string;
  sourcePath: string;
  state?: unknown;
  event?: MouseEvent;
}

export class HoverPreviewController {
  private active: HoverPopover | null = null;

  constructor(readonly app: App) {}

  async show(request: HoverPreviewRequest, anchor: HTMLElement): Promise<void> {
    this.hide();
    const source = this.app.workspace.hoverLinkSources.get(request.source);
    const file = this.app.metadataCache.getFirstLinkpathDest(request.linktext, request.sourcePath);
    const popover = new HoverPopover(anchor.ownerDocument.body);
    popover.contentEl.classList.add("hover-preview", "markdown-preview-view");
    popover.contentEl.dataset.source = source?.id ?? request.source;
    popover.showAt(anchor);
    this.active = popover;
    await this.renderPreview(popover.contentEl, file, request);
    this.app.workspace.trigger("hover-preview-open", request, file);
  }

  hide(): void {
    if (!this.active) return;
    this.active.hide();
    this.active = null;
    this.app.workspace.trigger("hover-preview-close");
  }

  private async renderPreview(
    container: HTMLElement,
    file: TFile | null,
    request: HoverPreviewRequest,
  ): Promise<void> {
    if (!file) {
      container.classList.add("mod-empty");
      container.textContent = `Missing target: ${request.linktext}`;
      return;
    }
    const source = await this.app.vault.read(file);
    await MarkdownRenderer.render(this.app, source, container, file.path);
  }
}
