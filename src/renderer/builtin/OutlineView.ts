import { ItemView } from "../views/ItemView";
import { TreeItem } from "../ui/TreeItem";
import type { CachedMetadata } from "../metadata/MetadataCache";
import type { TFile } from "../vault/TAbstractFile";
import { MarkdownView } from "../views/MarkdownView";
import { CodeFileView } from "../views/CodeFileView";
import type { CodeSymbol } from "../views/CodeSymbols";

export class OutlineView extends ItemView {
  private file: TFile | null = null;
  private codeView: CodeFileView | null = null;

  getViewType(): string {
    return "outline";
  }
  getDisplayText(): string {
    return "Outline";
  }
  getIcon(): string {
    return "lucide-list";
  }

  async onOpen(): Promise<void> {
    this.contentEl.classList.add("outline-view");
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => this.updateFromActiveFile()),
    );
    this.registerEvent(this.app.metadataCache.on("changed", () => this.render()));
    // Code files publish symbol changes (edits, language pack loaded) here.
    this.registerEvent(
      this.app.workspace.on("code-symbols-change", (view: CodeFileView) => {
        if (view === this.codeView) this.render();
      }),
    );
    this.updateFromActiveFile();
  }

  updateFromActiveFile(): void {
    // getActiveFileView resolves "the most recently active file leaf", so
    // focusing the outline (or any sidebar pane) does not blank the outline.
    const fileView = this.app.workspace.getActiveFileView();
    if (fileView instanceof CodeFileView) {
      this.codeView = fileView;
      this.file = fileView.file;
    } else {
      this.codeView = null;
      this.file = fileView instanceof MarkdownView ? fileView.file : null;
    }
    this.render();
  }

  render(): void {
    if (this.codeView) this.renderForCodeView(this.codeView);
    else this.renderForFile(this.file);
  }

  renderForFile(file: TFile | null): void {
    this.contentEl.replaceChildren();
    if (!file) {
      this.renderEmpty("No active file");
      return;
    }
    const cache = this.app.metadataCache.getFileCache(file);
    const headings = cache?.headings ?? [];
    if (headings.length === 0) {
      this.renderEmpty("No headings found");
      return;
    }

    const treeEl = this.contentEl.ownerDocument.createElement("div");
    treeEl.className = "outline tree-item-children";
    for (const heading of headings) this.renderHeading(file, heading, treeEl);
    this.contentEl.appendChild(treeEl);
  }

  private renderForCodeView(view: CodeFileView): void {
    this.contentEl.replaceChildren();
    const symbols = view.getSymbols();
    if (symbols.length === 0) {
      this.renderEmpty("No symbols found");
      return;
    }
    const treeEl = this.contentEl.ownerDocument.createElement("div");
    treeEl.className = "outline tree-item-children";
    for (const symbol of symbols) this.renderSymbol(view, symbol, treeEl);
    this.contentEl.appendChild(treeEl);
  }

  private renderSymbol(view: CodeFileView, symbol: CodeSymbol, parentEl: HTMLElement): void {
    const item = new TreeItem(parentEl, {
      itemClass: `outline-symbol mod-symbol-${symbol.kind}`,
      selfClass: "outline-heading-self tappable",
      innerClass: "outline-heading-title",
    });
    item.el.style.setProperty("--outline-heading-padding", `${symbol.depth * 14 + 8}px`);
    const kindEl = item.el.ownerDocument.createElement("span");
    kindEl.className = "outline-symbol-kind";
    kindEl.textContent = SYMBOL_KIND_BADGES[symbol.kind];
    item.innerEl.textContent = symbol.name;
    item.innerEl.before(kindEl);
    item.onSelfClick = () => view.revealLine(symbol.line);
  }

  private renderHeading(
    file: TFile,
    heading: NonNullable<CachedMetadata["headings"]>[number],
    parentEl: HTMLElement,
  ): void {
    const item = new TreeItem(parentEl, {
      itemClass: `outline-heading mod-heading-${heading.level}`,
      selfClass: "outline-heading-self tappable",
      innerClass: "outline-heading-title",
    });
    item.el.style.setProperty(
      "--outline-heading-padding",
      `${Math.max(0, heading.level - 1) * 14 + 8}px`,
    );
    item.innerEl.textContent = heading.heading;
    item.onSelfClick = () => {
      void this.app.workspace.openFile(file, {
        active: true,
        eState: heading.position ? { line: heading.position.line } : undefined,
      });
    };
  }

  private renderEmpty(text: string): void {
    const emptyEl = this.contentEl.ownerDocument.createElement("div");
    emptyEl.className = "empty-state";
    emptyEl.textContent = text;
    this.contentEl.appendChild(emptyEl);
  }
}

const SYMBOL_KIND_BADGES: Record<CodeSymbol["kind"], string> = {
  function: "ƒ",
  method: "ƒ",
  class: "C",
  type: "T",
  enum: "E",
};
