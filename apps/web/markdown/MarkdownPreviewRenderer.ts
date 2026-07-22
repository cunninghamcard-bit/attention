import type { App } from "../app/App";
import type { Component } from "../core/Component";
import { removeChildren } from "../dom/dom";
import {
  getMarkdownFrontmatter,
  MarkdownRenderer,
  type MarkdownCodeBlockProcessor,
  type MarkdownPostProcessor,
  type MarkdownSectionInformation,
} from "./MarkdownRenderer";
import { MarkdownRenderChild } from "./MarkdownRenderChild";
import {
  MarkdownPreviewSection,
  type MarkdownHighlightRange,
  type MarkdownHighlightRect,
} from "./MarkdownPreviewSection";
import type { FoldInfo } from "./FoldManager";
import { toggleCheckboxAtLine } from "./MarkdownTaskList";
import type { View } from "../views/View";

type InternalPreviewPostProcessorContext = Parameters<MarkdownPostProcessor>[1] & {
  usesFrontMatter?: boolean;
};

export class MarkdownPreviewRenderer {
  readonly sizerEl: HTMLElement;
  pusherEl: HTMLElement | null = null;
  header: MarkdownPreviewSection | null = null;
  footer: MarkdownPreviewSection | null = null;
  sections: MarkdownPreviewSection[] = [];
  asyncSections: MarkdownPreviewSection[] = [];
  recycledSections: MarkdownPreviewSection[] = [];
  rendered: Array<() => void> | null = null;
  frontmatter: Record<string, unknown> | null | undefined = null;
  cssClasses: string[] | null = null;
  text = "";
  lastText: string | null = null;
  lastScroll = 0;
  lastAppliedScrollLine = 0;
  viewportHeight = 0;
  renderExtra = 1;
  renderExtraMinPx = 500;
  addBottomPadding = false;
  topSpace = 0;
  progressiveRender = true;
  scrolling = false;
  lastRender = 0;
  renderedWidth = 0;
  private sourcePath = "";
  private queued: Promise<void> | null = null;
  private dirty = false;
  private collapsedHeadings = new Set<number>();

  constructor(
    readonly app: App,
    readonly previewEl: HTMLElement,
    sourcePath = "",
    readonly owner?: Component,
  ) {
    this.sourcePath = sourcePath;
    this.previewEl.classList.add("markdown-preview-view", "markdown-rendered");
    const existingSizerEl = this.previewEl.querySelector<HTMLElement>(
      ":scope > .markdown-preview-sizer",
    );
    if (existingSizerEl) {
      this.sizerEl = existingSizerEl;
    } else {
      this.sizerEl = document.createElement("div");
      this.sizerEl.className = "markdown-preview-sizer markdown-preview-section";
      this.previewEl.appendChild(this.sizerEl);
    }
    this.previewEl.addEventListener("click", (event) => this.onHeadingCollapseClick(event));
    this.previewEl.addEventListener("click", (event) => this.onListCollapseClick(event));
    this.previewEl.addEventListener("click", (event) => this.onCheckboxClick(event));
    this.previewEl.addEventListener("contextmenu", (event) => this.onViewportContextMenu(event));
    this.previewEl.addEventListener("scroll", () => this.onScroll());
  }

  static registerPostProcessor(postProcessor: MarkdownPostProcessor, sortOrder?: number): void {
    MarkdownRenderer.registerPostProcessor(postProcessor, sortOrder);
  }

  static unregisterPostProcessor(postProcessor: MarkdownPostProcessor): void {
    MarkdownRenderer.unregisterPostProcessor(postProcessor);
  }

  static createCodeBlockPostProcessor(
    language: string,
    handler: MarkdownCodeBlockProcessor,
  ): MarkdownPostProcessor {
    return MarkdownRenderer.createCodeBlockPostProcessor(language, handler);
  }

  static registerCodeBlockPostProcessor(
    language: string,
    handler: MarkdownCodeBlockProcessor,
  ): void {
    MarkdownRenderer.registerCodeBlockPostProcessor(language, handler);
  }

  static unregisterCodeBlockPostProcessor(language: string): void {
    MarkdownRenderer.unregisterCodeBlockPostProcessor(language);
  }

  static async renderMarkdown(
    app: App,
    markdown: string,
    container: HTMLElement,
    sourcePath: string,
    owner?: Component,
  ): Promise<void> {
    const renderer = new MarkdownPreviewRenderer(app, container, sourcePath, owner);
    renderer.set(markdown);
    await renderer.whenIdle();
  }

  setSourcePath(sourcePath: string): void {
    this.sourcePath = sourcePath;
  }

  set(text: string): void {
    this.text = text;
    this.queueRender();
  }

  rerender(clearRendered = false): void {
    this.lastText = null;
    if (clearRendered) {
      for (const section of this.sections) {
        if (section.modUi) continue;
        section.rendered = false;
        section.el.replaceChildren();
      }
    }
    this.queueRender();
  }

  addHeader(): HTMLElement {
    if (!this.header) {
      this.header = createUiSection("mod-header");
      this.sections.unshift(this.header);
    }
    this.queueRender();
    return this.header.el;
  }

  addFooter(): HTMLElement {
    if (!this.footer) {
      this.footer = createUiSection("mod-footer");
      this.sections.push(this.footer);
    }
    this.queueRender();
    return this.footer.el;
  }

  clear(): void {
    this.sections = [];
    this.asyncSections = [];
    this.recycledSections = [];
    this.rendered = [];
    this.clearSizer();
    this.text = "";
    this.lastText = null;
    this.lastScroll = 0;
    this.lastAppliedScrollLine = 0;
    this.previewEl.scrollTop = 0;
    this.renderedWidth = 0;
    this.frontmatter = null;
    this.setCssClasses([]);
    this.cleanupParentComponents();
    this.queueRender();
  }

  queueRender(): Promise<void> {
    this.rendered ??= [];
    this.dirty = true;
    this.queued ??= Promise.resolve()
      .then(async () => {
        while (this.dirty) {
          this.dirty = false;
          await this.onRender();
        }
      })
      .finally(() => {
        this.queued = null;
      });
    return this.queued;
  }

  whenIdle(): Promise<void> {
    return this.queued ?? Promise.resolve();
  }

  onResize(): void {
    this.viewportHeight = this.previewEl.clientHeight;
    if (this.addBottomPadding)
      this.sizerEl.style.paddingBottom = `${Math.floor(this.viewportHeight / 2)}px`;
    const width = this.previewEl.offsetWidth;
    if (width !== this.renderedWidth) {
      // Width changed: every stored section height came from a dead layout
      // (a pane mid-construction can be near zero wide, wrapping text one
      // word per line), so re-render to re-stamp them at the new geometry.
      this.renderedWidth = width;
      for (const section of this.sections) section.resetCompute();
      this.queueRender();
    } else {
      this.updateVirtualDisplay();
    }
  }

  getScroll(): number | null {
    if (this.sections.length === 0) return null;
    const lineHeight = this.getLineHeight();
    return lineHeight > 0 ? this.previewEl.scrollTop / lineHeight : null;
  }

  applyScroll(line: unknown, options: { center?: boolean; highlight?: boolean } = {}): boolean {
    const targetLine = Number(line);
    if (!Number.isFinite(targetLine) || this.text !== this.lastText) return false;
    const lineHeight = this.getLineHeight();
    let scrollTop = Math.max(0, targetLine * lineHeight);
    if (options.center)
      scrollTop = Math.max(
        0,
        scrollTop - Math.max(0, this.previewEl.clientHeight - lineHeight) / 2,
      );
    this.previewEl.scrollTop = scrollTop;
    this.lastAppliedScrollLine = targetLine;
    this.scrolling = true;
    if (options.highlight) this.highlightLine(Math.floor(targetLine));
    return true;
  }

  applyScrollDelayed(
    line: unknown,
    options?: { center?: boolean; highlight?: boolean },
    callback?: () => void,
  ): void {
    if (this.applyScroll(line, options)) {
      callback?.();
      return;
    }
    this.onRendered(() => {
      this.applyScroll(line, options);
      callback?.();
    });
  }

  getFoldInfo(): FoldInfo {
    const folds: Array<{ from: number; to: number }> = [];
    if (this.frontmatter && this.header?.el.querySelector(".metadata-container.is-collapsed")) {
      folds.push({ from: 0, to: getFrontmatterLineCount(this.text) });
    }
    for (let index = 0; index < this.sections.length; index += 1) {
      const section = this.sections[index];
      if (section.modUi) continue;
      const metadataEl = section.el.querySelector<HTMLElement>(".metadata-container.is-collapsed");
      if (metadataEl)
        folds.push({ from: section.start.line, to: section.start.line + section.lines });
      if (section.headingCollapsed)
        folds.push({
          from: section.start.line,
          to: this.getHeadingFoldEnd(index),
        });
      for (const li of getFoldableListItems(section.el)) {
        if (!li.classList.contains("is-collapsed")) continue;
        const line = parseNumber(li.dataset.line, 0);
        folds.push({
          from: section.start.line + line,
          to: section.start.line + this.getListFoldEnd(li, section),
        });
      }
    }
    return { folds, lines: countLines(this.text) };
  }

  applyFoldInfo(foldInfo: unknown): void {
    if (!foldInfo || typeof foldInfo !== "object") return;
    const info = foldInfo as { folds?: unknown; lines?: unknown };
    if (!Array.isArray(info.folds)) return;
    if (typeof info.lines === "number" && info.lines !== countLines(this.text)) return;
    const collapsedLines = new Set(
      info.folds
        .map((fold) =>
          typeof fold === "object" && fold !== null
            ? Number((fold as { from?: unknown }).from)
            : NaN,
        )
        .filter((line) => Number.isFinite(line)),
    );
    this.onRendered(() => {
      for (const section of this.sections) {
        if (section.modUi) continue;
        if (section.level > 0) section.setCollapsed(collapsedLines.has(section.start.line));
        for (const li of getFoldableListItems(section.el)) {
          const line = section.start.line + parseNumber(li.dataset.line, 0);
          this.setListCollapse(li, collapsedLines.has(line));
        }
      }
      this.updateShownSections();
      this.queueRender();
    });
  }

  foldAll(): void {
    this.onRendered(() => {
      for (const section of this.sections) {
        if (section.modUi || section.level <= 0) continue;
        section.setCollapsed(true);
        this.collapsedHeadings.add(section.start.line);
      }
      for (const section of this.sections) {
        if (section.modUi) continue;
        for (const li of getFoldableListItems(section.el)) this.setListCollapse(li, true);
      }
      this.updateShownSections();
      this.queueRender();
      this.notifyFoldChange();
    });
  }

  unfoldAll(): void {
    this.onRendered(() => {
      this.collapsedHeadings.clear();
      for (const section of this.sections) {
        if (section.modUi) continue;
        section.setCollapsed(false);
        for (const li of getFoldableListItems(section.el)) this.setListCollapse(li, false);
      }
      this.updateShownSections();
      this.queueRender();
      this.notifyFoldChange();
    });
  }

  updateSearchQuery(query: string, activeIndex = -1): void {
    const normalized = query.toLowerCase();
    let matchIndex = 0;
    for (const section of this.sections) {
      section.highlightRanges = null;
      if (!normalized || section.modUi) continue;
      const text = section.el.textContent?.toLowerCase() ?? "";
      const ranges: MarkdownHighlightRange[] = [];
      let offset = text.indexOf(normalized);
      while (offset !== -1) {
        ranges.push({
          section,
          start: offset,
          end: offset + normalized.length,
          active: activeIndex === matchIndex,
        });
        matchIndex += 1;
        offset = text.indexOf(normalized, offset + Math.max(1, normalized.length));
      }
      section.highlightRanges = ranges.length > 0 ? ranges : null;
    }
    this.updateVirtualDisplay();
  }

  private async onRender(): Promise<void> {
    this.clearSizer();
    const pusherEl = document.createElement("div");
    pusherEl.className = "markdown-preview-pusher";
    // A non-zero height (matching the reference renderer's 1px x 0.1px) keeps
    // the pusher from self-collapsing its margins: with height 0 the large
    // margin-bottom set during virtual scrolling collapses up through the
    // empty div and becomes the sizer's top margin, displacing the whole sizer
    // downward and doubling the scroll height (a huge blank gap below content).
    pusherEl.style.width = "1px";
    pusherEl.style.height = "0.1px";
    this.pusherEl = pusherEl;
    const contentEl = document.createElement("div");
    contentEl.className = "markdown-preview-section";
    this.sections = [...(this.header ? [this.header] : [])];
    this.sizerEl.append(
      pusherEl,
      ...(this.header ? [this.header.el] : []),
      contentEl,
      ...(this.footer ? [this.footer.el] : []),
    );
    const frontmatter = getMarkdownFrontmatter(this.text);
    this.frontmatter = frontmatter;
    this.setCssClasses(getFrontmatterCssClasses(frontmatter));
    const frontmatterUsage = new WeakMap<HTMLElement, boolean>();
    await MarkdownRenderer.render(this.app, this.text, contentEl, this.sourcePath, this.owner, {
      containerEl: this.sizerEl,
      displayMode: true,
      getSectionInfo: (el) => getSectionInfoFromAttributes(el, this.text),
      replace: (source) => {
        this.text = source;
        this.lastText = null;
        this.queueRender();
      },
      onSectionPostProcess: (el, context) => {
        frontmatterUsage.set(
          el,
          (context as InternalPreviewPostProcessorContext).usesFrontMatter === true,
        );
      },
    });
    const markdownSections = collectMarkdownSections(contentEl, this.text, frontmatterUsage);
    this.applyHeadingFoldState(markdownSections);
    this.decorateHeadingSections(markdownSections);
    this.decorateListSections(markdownSections);
    this.sections = [
      ...(this.header ? [this.header] : []),
      ...markdownSections,
      ...(this.footer ? [this.footer] : []),
    ];
    this.updateShownSections();
    this.topSpace = this.pusherEl?.offsetTop ?? 0;
    this.updateVirtualDisplay();
    this.lastText = this.text;
    this.lastRender = Date.now();
    this.renderedWidth = this.previewEl.offsetWidth;
    this.cleanupParentComponents();
    const callbacks = this.rendered ?? [];
    this.rendered = this.dirty ? [] : null;
    for (const callback of callbacks) callback();
  }

  private clearSizer(): void {
    removeChildren(this.sizerEl);
    this.pusherEl = null;
  }

  private setCssClasses(nextClasses: string[]): void {
    if (this.cssClasses) this.previewEl.classList.remove(...this.cssClasses);
    this.cssClasses = nextClasses.length > 0 ? nextClasses : null;
    if (this.cssClasses) this.previewEl.classList.add(...this.cssClasses);
  }

  private onRendered(callback: () => void): void {
    if (this.rendered) {
      this.rendered.push(callback);
      if (!this.queued) this.queueRender();
      return;
    }
    callback();
  }

  getSectionInfo(el: HTMLElement): MarkdownSectionInformation | null {
    const section = this.getSectionForElement(el);
    if (!section || section.modUi) return null;
    return {
      text: this.lastText ?? "",
      lineStart: section.start.line,
      lineEnd: section.end.line,
    };
  }

  getSectionForElement(el: HTMLElement): MarkdownPreviewSection | null {
    return this.sections.find((section) => section.el === el || section.el.contains(el)) ?? null;
  }

  belongsToMe(el: HTMLElement): boolean {
    return (
      this.previewEl.contains(el) ||
      this.sections.some((section) => section.el === el || section.el.contains(el))
    );
  }

  cleanupParentComponents(): void {
    if (!this.owner) return;
    for (const child of this.owner._children.slice()) {
      if (!(child instanceof MarkdownRenderChild)) continue;
      if (this.belongsToMe(child.containerEl)) continue;
      this.owner.removeChild(child);
    }
  }

  private getLineHeight(): number {
    const computed = getComputedStyle(this.previewEl);
    return parseFloat(computed.lineHeight) || parseFloat(computed.fontSize) * 1.4 || 20;
  }

  private highlightLine(line: number): void {
    for (const element of this.previewEl.querySelectorAll(".is-flashing"))
      element.classList.remove("is-flashing");
    const target =
      this.previewEl.querySelector<HTMLElement>(`[data-line="${line}"]`) ?? this.sizerEl;
    target.classList.add("is-flashing");
    window.setTimeout(() => target.classList.remove("is-flashing"), 3000);
  }

  private onScroll(): void {
    const scrollTop = this.previewEl.scrollTop;
    const threshold = Math.max(this.viewportHeight * this.renderExtra, this.renderExtraMinPx) / 2;
    if (Math.abs(scrollTop - this.lastScroll) > threshold) this.updateVirtualDisplay(scrollTop);
    if (this.scrolling) {
      this.scrolling = false;
      return;
    }
  }

  updateVirtualDisplay(scrollTop: number = this.previewEl.scrollTop): void {
    this.lastScroll = scrollTop;
    if (!this.pusherEl) return;
    const layout = this.computeSectionLayout();
    const shownIndexes = layout.positions
      .map((position, index) => ({ index, position }))
      .filter(({ position }) => position.shown)
      .map(({ index }) => index);

    if (!this.progressiveRender || shownIndexes.length === 0) {
      this.pusherEl.style.marginBottom = "0px";
      this.sizerEl.style.minHeight = "";
      const children = [this.pusherEl, ...this.sections.map((section) => section.el)];
      this.sizerEl.replaceChildren(...children);
      for (const section of this.sections) {
        section.el.style.display = section.shown ? "" : "none";
        if (section.shown && !section.computed) this.measureSection(section);
      }
      this.renderHighlights(0, this.sections.length - 1);
      return;
    }

    const viewportHeight =
      this.previewEl.clientHeight || this.viewportHeight || this.renderExtraMinPx;
    const buffer = Math.max(viewportHeight * this.renderExtra, this.renderExtraMinPx);
    const windowTop = Math.max(0, scrollTop - buffer);
    const windowBottom = scrollTop + viewportHeight + buffer;
    let firstIndex = -1;
    let lastIndex = -1;

    for (const index of shownIndexes) {
      const position = layout.positions[index];
      if (!position || position.bottom < windowTop || position.top > windowBottom) continue;
      if (firstIndex === -1) firstIndex = index;
      lastIndex = index;
    }

    if (firstIndex === -1 || lastIndex === -1) {
      const nearest = this.findNearestSectionIndex(shownIndexes, layout.positions, scrollTop);
      firstIndex = nearest;
      lastIndex = nearest;
    }

    const selectionRange = this.getSelectionSectionRange();
    if (selectionRange) {
      firstIndex = Math.min(firstIndex, selectionRange.from);
      lastIndex = Math.max(lastIndex, selectionRange.to);
    }

    const children = [this.pusherEl];
    for (let index = firstIndex; index <= lastIndex; index += 1) {
      const section = this.sections[index];
      if (!section?.shown) continue;
      section.el.style.display = "";
      children.push(section.el);
    }
    this.sizerEl.replaceChildren(...children);

    const firstShownPosition = layout.positions.find(
      (position, index) => index >= firstIndex && index <= lastIndex && position.shown,
    );
    this.pusherEl.style.marginBottom =
      firstShownPosition && firstShownPosition.top > 0
        ? `${Math.floor(firstShownPosition.top)}px`
        : "";
    this.sizerEl.style.minHeight =
      layout.totalHeight > 0 ? `${Math.max(0, Math.floor(layout.totalHeight - 1))}px` : "";

    for (let index = firstIndex; index <= lastIndex; index += 1) {
      const section = this.sections[index];
      if (section?.shown && !section.computed) this.measureSection(section);
    }
    this.renderHighlights(firstIndex, lastIndex);
  }

  private measureSection(section: MarkdownPreviewSection): void {
    const next = section.el.nextElementSibling as HTMLElement | null;
    const nextTop = next ? next.offsetTop : section.el.offsetTop + section.el.offsetHeight;
    const measured = Math.max(0, nextTop - section.el.offsetTop) || section.el.offsetHeight;
    if (measured > 0 || section.height === 0) section.height = measured;
    section.computed = true;
  }

  private computeSectionLayout(): {
    positions: Array<{ top: number; bottom: number; height: number; shown: boolean }>;
    totalHeight: number;
  } {
    const averageHeight = this.getAverageComputedSectionHeight();
    let top = 0;
    const positions = this.sections.map((section) => {
      const shown = section.shown;
      const height = shown ? this.getEstimatedSectionHeight(section, averageHeight) : 0;
      const position = { top, bottom: top + height, height, shown };
      top += height;
      return position;
    });
    return { positions, totalHeight: top };
  }

  private getAverageComputedSectionHeight(): number {
    const heights = this.sections
      .filter((section) => section.shown && section.computed && section.height > 0)
      .map((section) => section.height);
    if (heights.length === 0) return Math.max(1, this.getLineHeight());
    return heights.reduce((sum, height) => sum + height, 0) / heights.length;
  }

  private getEstimatedSectionHeight(
    section: MarkdownPreviewSection,
    averageHeight: number,
  ): number {
    if (section.computed && section.height > 0) return section.height;
    if (section.height > 0) return section.height;
    return Math.max(1, section.lines) * averageHeight;
  }

  private findNearestSectionIndex(
    indexes: number[],
    positions: Array<{ top: number; bottom: number }>,
    scrollTop: number,
  ): number {
    let nearest = indexes[0] ?? 0;
    let nearestDistance = Infinity;
    for (const index of indexes) {
      const position = positions[index];
      if (!position) continue;
      const distance =
        scrollTop < position.top
          ? position.top - scrollTop
          : scrollTop > position.bottom
            ? scrollTop - position.bottom
            : 0;
      if (distance < nearestDistance) {
        nearest = index;
        nearestDistance = distance;
      }
    }
    return nearest;
  }

  private getSelectionSectionRange(): { from: number; to: number } | null {
    const selection = this.previewEl.ownerDocument.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
    const anchorIndex = this.getSectionIndexForNode(selection.anchorNode);
    const focusIndex = this.getSectionIndexForNode(selection.focusNode);
    if (anchorIndex === null || focusIndex === null) return null;
    return {
      from: Math.min(anchorIndex, focusIndex),
      to: Math.max(anchorIndex, focusIndex),
    };
  }

  private getSectionIndexForNode(node: Node | null): number | null {
    if (!node) return null;
    const element = node instanceof HTMLElement ? node : node.parentElement;
    if (!element) return null;
    const index = this.sections.findIndex(
      (section) => section.el === element || section.el.contains(element),
    );
    return index === -1 ? null : index;
  }

  private renderHighlights(firstIndex: number, lastIndex: number): void {
    for (const highlightEl of this.sizerEl.querySelectorAll(":scope > .search-highlight"))
      highlightEl.remove();
    if (firstIndex < 0 || lastIndex < firstIndex) return;

    const rectEls: HTMLElement[] = [];
    const offsetParent =
      this.sizerEl.offsetParent instanceof HTMLElement ? this.sizerEl.offsetParent : this.sizerEl;
    const offsetRect = offsetParent.getBoundingClientRect();

    for (let index = firstIndex; index <= lastIndex; index += 1) {
      const section = this.sections[index];
      if (!section?.shown || !section.highlightRanges) continue;
      for (const highlightRange of section.highlightRanges) {
        const rects = this.getHighlightRects(section, highlightRange, offsetRect);
        for (const rect of rects) {
          const rectEl = document.createElement("div");
          if (highlightRange.active) rectEl.classList.add("is-active");
          rectEl.style.left = `${rect.x}px`;
          rectEl.style.top = `${rect.y}px`;
          rectEl.style.width = `${rect.width}px`;
          rectEl.style.height = `${rect.height}px`;
          rectEls.push(rectEl);
        }
      }
    }

    if (rectEls.length === 0) return;
    const wrapperEl = document.createElement("div");
    wrapperEl.className = "search-highlight";
    wrapperEl.replaceChildren(...rectEls);
    this.sizerEl.appendChild(wrapperEl);
  }

  private getHighlightRects(
    section: MarkdownPreviewSection,
    highlightRange: MarkdownHighlightRange,
    offsetRect: DOMRect,
  ): MarkdownHighlightRect[] {
    if (highlightRange.rects) return highlightRange.rects;
    const textNodes: Text[] = [];
    collectTextNodes(section.el, textNodes);
    const range = createRangeFromTextOffsets(textNodes, highlightRange.start, highlightRange.end);
    const rects: MarkdownHighlightRect[] = [];
    if (range) {
      const clientRects =
        typeof range.getClientRects === "function" ? Array.from(range.getClientRects()) : [];
      for (const rect of clientRects) {
        rects.push({
          x: rect.left - offsetRect.left,
          y: rect.top - offsetRect.top,
          width: rect.width,
          height: rect.height,
        });
      }
      range.detach();
    }
    highlightRange.rects = rects;
    return rects;
  }

  private onHeadingCollapseClick(event: MouseEvent): void {
    const target =
      event.target instanceof HTMLElement
        ? event.target.closest<HTMLElement>(".heading-collapse-indicator")
        : null;
    if (!target) return;
    const section = this.getSectionForElement(target);
    if (!section || section.level <= 0) return;
    event.preventDefault();
    event.stopPropagation();
    const collapsed = !section.headingCollapsed;
    section.setCollapsed(collapsed);
    if (collapsed) this.collapsedHeadings.add(section.start.line);
    else this.collapsedHeadings.delete(section.start.line);
    this.updateShownSections();
    this.queueRender();
  }

  private onListCollapseClick(event: MouseEvent): void {
    if (event.defaultPrevented || event.button !== 0) return;
    const target =
      event.target instanceof HTMLElement
        ? event.target.closest<HTMLElement>("li > .list-collapse-indicator")
        : null;
    if (!target) return;
    const li = target.parentElement;
    if (!(li instanceof HTMLLIElement) || !this.belongsToMe(li)) return;
    event.preventDefault();
    event.stopPropagation();
    this.setListCollapse(li, !li.classList.contains("is-collapsed"));
    this.queueRender();
    this.notifyFoldChange();
  }

  private onCheckboxClick(event: MouseEvent): void {
    if (event.defaultPrevented || event.button !== 0) return;
    const checkbox =
      event.target instanceof HTMLElement
        ? event.target.closest<HTMLInputElement>(".task-list-item-checkbox")
        : null;
    if (
      !(checkbox instanceof HTMLInputElement) ||
      checkbox.type !== "checkbox" ||
      !this.belongsToMe(checkbox)
    )
      return;
    const section = this.findSectionContaining(checkbox);
    if (!section || section.modUi) return;
    const relativeLine = parseNumber(checkbox.dataset.line, NaN);
    if (!Number.isFinite(relativeLine)) return;
    const absoluteLine = section.start.line + relativeLine;
    const owner = this.owner as
      | (Component & {
          onCheckboxClick?: (event: MouseEvent, checkbox: HTMLInputElement, line: number) => void;
        })
      | undefined;
    if (owner?.onCheckboxClick) {
      event.preventDefault();
      event.stopPropagation();
      owner.onCheckboxClick(event, checkbox, absoluteLine);
      return;
    }
    const updated = toggleCheckboxAtLine(this.text, absoluteLine);
    if (!updated) return;
    event.preventDefault();
    event.stopPropagation();
    (navigator as { vibrate?: (duration: number) => void }).vibrate?.(100);
    this.text = updated.text;
    this.lastText = null;
    checkbox.checked = updated.checked;
    if (updated.checked) checkbox.setAttribute("checked", "");
    else checkbox.removeAttribute("checked");
    const li = checkbox.closest("li.task-list-item");
    if (li instanceof HTMLLIElement) {
      li.dataset.task = updated.marker;
      li.classList.toggle("is-checked", updated.checked);
    }
    this.queueRender();
  }

  private onViewportContextMenu(event: MouseEvent): void {
    if (event.defaultPrevented || !this.owner) return;
    const target = event.target instanceof Node ? event.target : null;
    if (target && this.sizerEl.contains(target)) return;
    event.preventDefault();
    this.app.menus
      .createMarkdownViewportMenu(this.owner as unknown as View, "preview", "gutter")
      .showAtMouseEvent(event);
  }

  private setListCollapse(li: HTMLLIElement, collapsed: boolean): void {
    const changed = li.classList.contains("is-collapsed") !== collapsed;
    li.classList.toggle("is-collapsed", collapsed);
    for (const icon of li.querySelectorAll<HTMLElement>(":scope > .collapse-icon"))
      icon.classList.toggle("is-collapsed", collapsed);
    if (!changed) return;
    const section = this.findSectionContaining(li);
    section?.resetCompute();
  }

  private findSectionContaining(el: HTMLElement): MarkdownPreviewSection | null {
    return this.sections.find((section) => section.el === el || section.el.contains(el)) ?? null;
  }

  private notifyFoldChange(): void {
    const owner = this.owner as (Component & { onFoldChange?: () => void }) | undefined;
    owner?.onFoldChange?.();
  }

  private applyHeadingFoldState(sections: MarkdownPreviewSection[]): void {
    for (const section of sections) {
      if (section.level <= 0) continue;
      section.setCollapsed(this.collapsedHeadings.has(section.start.line));
    }
  }

  private decorateHeadingSections(sections: MarkdownPreviewSection[]): void {
    for (const section of sections) {
      if (section.level <= 0) continue;
      if (section.el.querySelector(":scope > .heading-collapse-indicator")) continue;
      const indicator = document.createElement("span");
      indicator.className = "heading-collapse-indicator collapse-indicator collapse-icon";
      indicator.setAttribute("aria-label", "Collapse heading");
      section.el.prepend(indicator);
    }
  }

  private decorateListSections(sections: MarkdownPreviewSection[]): void {
    for (const section of sections) {
      for (const li of getFoldableListItems(section.el)) {
        if (!li.querySelector(":scope > .list-collapse-indicator")) {
          const indicator = document.createElement("span");
          indicator.className = "list-collapse-indicator collapse-indicator collapse-icon";
          indicator.dataset.icon = "right-triangle";
          li.prepend(indicator);
        }
      }
    }
  }

  private updateShownSections(): void {
    let collapsedLevel = 0;
    for (const section of this.sections) {
      if (section.modUi) {
        section.shown = true;
        section.el.style.display = "";
        continue;
      }
      if (collapsedLevel > 0 && section.level > 0 && section.level <= collapsedLevel)
        collapsedLevel = 0;
      const hidden = collapsedLevel > 0 && (section.level === 0 || section.level > collapsedLevel);
      section.shown = !hidden;
      section.el.style.display = hidden ? "none" : "";
      if (!hidden && section.headingCollapsed && section.level > 0) collapsedLevel = section.level;
    }
  }

  private getHeadingFoldEnd(index: number): number {
    const section = this.sections[index];
    const nextSection = this.sections[index + 1];
    if (nextSection && !nextSection.modUi)
      return Math.max(section.start.line, nextSection.start.line - 1);
    return section.start.line + section.lines;
  }

  private getListFoldEnd(li: HTMLLIElement, section: MarkdownPreviewSection): number {
    const next = li.nextElementSibling instanceof HTMLElement ? li.nextElementSibling : null;
    if (!next) return Math.max(0, section.lines - 1);
    const nextLine = parseNumber(next.dataset.line, section.lines);
    return Math.max(0, nextLine - 1);
  }
}

function createUiSection(className: string): MarkdownPreviewSection {
  const section = new MarkdownPreviewSection(null);
  section.el.classList.add(className, "mod-ui");
  section.modUi = true;
  section.shown = true;
  return section;
}

function collectMarkdownSections(
  containerEl: HTMLElement,
  text: string,
  frontmatterUsage = new WeakMap<HTMLElement, boolean>(),
): MarkdownPreviewSection[] {
  const rootEl =
    containerEl.children.length === 1 &&
    containerEl.firstElementChild instanceof HTMLElement &&
    containerEl.firstElementChild.classList.contains("markdown-rendered")
      ? containerEl.firstElementChild
      : containerEl;
  const blockEls = [...rootEl.children].filter(
    (child): child is HTMLElement => child instanceof HTMLElement,
  );
  if (blockEls.length === 0) {
    const section = new MarkdownPreviewSection(containerEl.innerHTML, containerEl);
    section.rendered = true;
    section.height = containerEl.offsetHeight;
    return [section];
  }
  return blockEls.map((el) => {
    const lineStart = parseNumber(el.dataset.lineStart ?? el.dataset.line, 0);
    const lineEnd = parseNumber(el.dataset.lineEnd ?? el.dataset.line, lineStart);
    const section = new MarkdownPreviewSection(el.innerHTML, el);
    section.rendered = true;
    section.start = { line: lineStart, col: 0, offset: lineOffset(text, lineStart) };
    section.end = { line: lineEnd, col: 0, offset: lineOffset(text, lineEnd) };
    section.height = el.offsetHeight;
    section.shown = true;
    section.lines = Math.max(1, lineEnd - lineStart + 1);
    section.level = getHeadingLevel(el);
    section.usesFrontMatter = frontmatterUsage.get(el) === true;
    return section;
  });
}

function parseNumber(value: string | undefined, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function getSectionInfoFromAttributes(
  el: HTMLElement,
  text: string,
): MarkdownSectionInformation | null {
  let current: HTMLElement | null = el;
  while (current) {
    const lineStart = Number(current.dataset.lineStart ?? current.dataset.line);
    const lineEnd = Number(current.dataset.lineEnd ?? current.dataset.line);
    if (Number.isFinite(lineStart) && Number.isFinite(lineEnd)) {
      return {
        text,
        lineStart,
        lineEnd,
      };
    }
    current = current.parentElement;
  }
  return null;
}

function getHeadingLevel(el: HTMLElement): number {
  const match = el.tagName.match(/^H([1-6])$/);
  return match ? Number(match[1]) : 0;
}

function getFoldableListItems(root: HTMLElement): HTMLLIElement[] {
  return [...root.querySelectorAll<HTMLLIElement>("li")].filter((li) =>
    li.querySelector(":scope > ul, :scope > ol"),
  );
}

function countLines(text: string): number {
  return text.match(/^/gm)?.length ?? 1;
}

function getFrontmatterLineCount(text: string): number {
  if (!/^---(?:\r?\n|$)/.test(text)) return 0;
  const lines = text.split(/\r?\n/);
  for (let index = 1; index < lines.length; index += 1) {
    if (/^---\s*$/.test(lines[index])) return index;
  }
  return 0;
}

function collectTextNodes(node: Node, textNodes: Text[]): void {
  if (node.nodeType === Node.TEXT_NODE) {
    textNodes.push(node as Text);
    return;
  }
  for (const child of node.childNodes) collectTextNodes(child, textNodes);
}

function createRangeFromTextOffsets(textNodes: Text[], start: number, end: number): Range | null {
  let offset = 0;
  let startNode: Text | null = null;
  let startOffset = 0;
  let endNode: Text | null = null;
  let endOffset = 0;

  for (const node of textNodes) {
    const nextOffset = offset + node.data.length;
    if (!startNode && start >= offset && start <= nextOffset) {
      startNode = node;
      startOffset = start - offset;
    }
    if (!endNode && end >= offset && end <= nextOffset) {
      endNode = node;
      endOffset = end - offset;
      break;
    }
    offset = nextOffset;
  }

  if (!startNode || !endNode) return null;
  const range = document.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);
  return range;
}

function getFrontmatterCssClasses(
  frontmatter: Record<string, unknown> | null | undefined,
): string[] {
  if (!frontmatter) return [];
  const entry = Object.entries(frontmatter).find(([key]) => /^cssclasses$/i.test(key));
  if (!entry) return [];
  const value = entry[1];
  const candidates = Array.isArray(value) ? value : [value];
  return candidates.filter(
    (item): item is string => typeof item === "string" && item.length > 0 && !/\s/.test(item),
  );
}

function lineOffset(text: string, line: number): number {
  if (line <= 0) return 0;
  let offset = 0;
  let currentLine = 0;
  while (currentLine < line && offset < text.length) {
    const next = text.indexOf("\n", offset);
    if (next === -1) return text.length;
    offset = next + 1;
    currentLine += 1;
  }
  return offset;
}
