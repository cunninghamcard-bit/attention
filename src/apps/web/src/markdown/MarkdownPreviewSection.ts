export interface MarkdownPreviewPosition {
  line: number;
  col: number;
  offset: number;
}

export interface MarkdownHighlightRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MarkdownHighlightRange {
  section?: MarkdownPreviewSection;
  start: number;
  end: number;
  active: boolean;
  rects?: MarkdownHighlightRect[] | null;
}

export class MarkdownPreviewSection {
  readonly el: HTMLElement;
  rendered: boolean;
  html: string;
  start: MarkdownPreviewPosition;
  end: MarkdownPreviewPosition;
  height = 0;
  computed = false;
  lines = 0;
  used = true;
  highlightRanges: MarkdownHighlightRange[] | null = null;
  level = 0;
  headingCollapsed = false;
  shown = true;
  usesFrontMatter = false;
  modUi = false;

  constructor(html: string | null = "", el: HTMLElement = document.createElement("div")) {
    this.html = html ?? "";
    this.el = el;
    this.rendered = html === null;
    this.start = zeroPosition();
    this.end = zeroPosition();
  }

  render(): void {
    if (this.rendered) return;
    this.el.replaceChildren();
    const template = document.createElement("template");
    template.innerHTML = this.html;
    this.el.appendChild(template.content.cloneNode(true));
    const first = this.el.firstElementChild;
    if (first) this.el.classList.add(`el-${first.tagName.toLowerCase()}`);
    this.rendered = true;
    this.computed = false;
  }

  resetCompute(): void {
    this.computed = false;
    for (const range of this.highlightRanges ?? []) delete range.rects;
  }

  setCollapsed(collapsed: boolean): void {
    this.headingCollapsed = collapsed;
    this.el.classList.toggle("is-collapsed", collapsed);
  }
}

export function zeroPosition(): MarkdownPreviewPosition {
  return { line: 0, col: 0, offset: 0 };
}
