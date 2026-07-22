import type { App } from "../app/App";
import { removeChildren } from "../dom/dom";
import { Menu } from "../ui/Menu";
import {
  MarkdownInlineRenderer,
  type MarkdownInlineState,
  type MarkdownParserToken,
} from "./MarkdownInlineRenderer";
import { MarkdownCodeBlockRegistry } from "./MarkdownCodeBlockRegistry";
import { MarkdownPostProcessorRegistry } from "./MarkdownPostProcessorRegistry";
import { RenderContext } from "./RenderContext";
import { MarkdownLinkResolver } from "./MarkdownLinkResolver";
import type { Component } from "../core/Component";
import { MarkdownRenderChild } from "./MarkdownRenderChild";
import { parseFrontmatter } from "../metadata/Frontmatter";

export interface MarkdownSectionInformation {
  text: string;
  lineStart: number;
  lineEnd: number;
}

export interface MarkdownPostProcessorContext {
  docId: string;
  sourcePath: string;
  frontmatter: Record<string, unknown> | null | undefined;
  addChild(child: MarkdownRenderChild): void;
  getSectionInfo(el: HTMLElement): MarkdownSectionInformation | null;
}

interface InternalMarkdownPostProcessorContext extends MarkdownPostProcessorContext {
  app: App | null;
  inlineState: MarkdownInlineState;
  containerEl: HTMLElement;
  el: HTMLElement;
  displayMode: boolean;
  renderContext: RenderContext;
  promises: Promise<void>[];
  usesFrontMatter?: boolean;
  replace?(source: string): void | Promise<void> | null;
  replaceCode?(source: string): Promise<void>;
}

export interface MarkdownPreviewEvents extends Component {}

export interface MarkdownPostProcessor {
  (element: HTMLElement, context: MarkdownPostProcessorContext): void | Promise<void>;
  sortOrder?: number;
}

export type MarkdownCodeBlockProcessor = (
  source: string,
  element: HTMLElement,
  context: MarkdownPostProcessorContext,
) => void | Promise<void>;

export interface MarkdownRenderOptions {
  getSectionInfo?(el: HTMLElement): MarkdownSectionInformation | null;
  containerEl?: HTMLElement;
  displayMode?: boolean;
  replace?(source: string, el: HTMLElement): void | Promise<void> | null;
  onSectionPostProcess?(el: HTMLElement, context: MarkdownPostProcessorContext): void;
}

export abstract class MarkdownRenderer
  extends MarkdownRenderChild
  implements MarkdownPreviewEvents
{
  private static inlineRenderer = new MarkdownInlineRenderer();
  private static codeBlocks = new MarkdownCodeBlockRegistry();
  private static postProcessors = new MarkdownPostProcessorRegistry();
  private static renderChildren = new WeakMap<HTMLElement, Set<MarkdownRenderChild>>();
  private static linkHandlerState = new WeakMap<HTMLElement, { app: App; sourcePath: string }>();
  private static warnedMissingComponent = false;
  private static docId = 0;

  static resetProcessors(): void {
    this.codeBlocks.clear();
    this.postProcessors.clear();
  }

  static registerPostProcessor(processor: MarkdownPostProcessor, sortOrder?: number): void {
    this.postProcessors.register(processor, sortOrder);
  }

  static unregisterPostProcessor(processor: MarkdownPostProcessor): void {
    this.postProcessors.unregister(processor);
  }

  static registerCodeBlockPostProcessor(
    language: string,
    processor: MarkdownCodeBlockProcessor,
  ): void {
    this.codeBlocks.register(language, processor);
  }

  static unregisterCodeBlockPostProcessor(language: string): void {
    this.codeBlocks.unregister(language);
  }

  static createCodeBlockPostProcessor(
    language: string,
    processor: MarkdownCodeBlockProcessor,
  ): MarkdownPostProcessor {
    return (element, context) => {
      const internalContext = context as InternalMarkdownPostProcessorContext;
      const selector = `language-${language}`;
      for (const code of element.querySelectorAll<HTMLElement>("code")) {
        if (!code.classList.contains(selector)) continue;
        const source = code.textContent ?? "";
        const parent = code.parentElement;
        if (!parent) continue;
        const replacement = document.createElement("div");
        replacement.className = `block-language-${language}`;
        copySectionAttributes(parent, replacement);
        parent.replaceWith(replacement);
        const codeContext: InternalMarkdownPostProcessorContext = {
          ...internalContext,
          el: replacement,
          replaceCode: createReplaceCode(internalContext, parent, language),
        };
        const result = processor(source, replacement, codeContext);
        if (result) internalContext.promises.push(result);
      }
    };
  }

  static renderMarkdown(
    markdown: string,
    container: HTMLElement,
    sourcePath: string,
    component?: Component,
  ): Promise<void> {
    return this.render(null, markdown, container, sourcePath, component);
  }

  static async render(
    app: App | null,
    markdown: string,
    container: HTMLElement,
    sourcePath: string,
    component?: Component,
    options: MarkdownRenderOptions = {},
  ): Promise<void> {
    if (component) cleanupRenderChildren(component, this.renderChildren.get(container), []);
    removeChildren(container);
    const renderContext = new RenderContext(app, sourcePath, container);
    const inlineState = this.inlineRenderer.createState(markdown);
    const currentChildren = new Set<MarkdownRenderChild>();
    const context: InternalMarkdownPostProcessorContext = {
      app,
      docId: sourcePath || `markdown-${++this.docId}`,
      sourcePath,
      containerEl: options.containerEl ?? container,
      el: container,
      displayMode: options.displayMode ?? true,
      frontmatter: getFrontmatter(markdown),
      renderContext,
      inlineState,
      promises: [],
      addChild: (child) => {
        if (component) {
          component.addChild(child);
          currentChildren.add(child);
          return;
        }
        if (!this.warnedMissingComponent) {
          this.warnedMissingComponent = true;
          console.warn(
            "MarkdownRenderer.render called without a Component; MarkdownRenderChild cleanup is not managed.",
          );
        }
        child.load();
      },
      getSectionInfo: options.getSectionInfo ?? (() => null),
      replace: () => null,
    };
    const root = container.classList.contains("markdown-rendered")
      ? container
      : document.createElement("div");
    if (root !== container) {
      root.className = "markdown-rendered";
      container.appendChild(root);
    }
    if (app) this.installInternalLinkHandlers(app, options.containerEl ?? root, sourcePath);

    const sections: HTMLElement[] = [];
    const bodyStartLine = getBodyStartLine(markdown);
    for (const block of groupMarkdownTokens(this.inlineRenderer.parse(markdown, inlineState))) {
      if (isNonRenderableBlock(block) || getBlockStartLine(block) < bodyStartLine) continue;
      const section = this.renderBlock(block, root, context);
      const info = getBlockSectionInfo(block, markdown);
      setSectionInfo(section, info);
      sections.push(section);
    }
    const footnotes = this.inlineRenderer.renderFootnotes(context);
    if (footnotes) {
      root.appendChild(footnotes);
      sections.push(footnotes);
    }

    for (const section of sections) {
      const sectionContext: InternalMarkdownPostProcessorContext = {
        ...context,
        el: section,
        replace: (source) => (options.replace ? options.replace(source, section) : null),
      };
      this.postProcessors.run(section, sectionContext);
      options.onSectionPostProcess?.(section, sectionContext);
    }
    await Promise.all(context.promises);
    if (component) {
      cleanupRenderChildren(component, currentChildren, sections, root);
      this.renderChildren.set(container, currentChildren);
    }
  }

  private static installInternalLinkHandlers(
    app: App,
    root: HTMLElement,
    sourcePath: string,
  ): void {
    const existing = this.linkHandlerState.get(root);
    if (existing) {
      existing.app = app;
      existing.sourcePath = sourcePath;
      return;
    }
    const state = { app, sourcePath };
    this.linkHandlerState.set(root, state);
    root.addEventListener("click", (event) => {
      const target =
        event.target instanceof HTMLElement
          ? event.target.closest<HTMLElement>(".internal-link")
          : null;
      if (!target) return;
      const linktext =
        target.dataset.href ?? target.getAttribute("href") ?? target.textContent ?? "";
      if (!linktext || /^https?:/.test(linktext)) return;
      event.preventDefault();
      const resolver = new MarkdownLinkResolver(state.app);
      void resolver.openLinkText(linktext, state.sourcePath);
    });
    root.addEventListener("mouseover", (event) => {
      const target =
        event.target instanceof HTMLElement
          ? event.target.closest<HTMLElement>(".internal-link")
          : null;
      if (!target) return;
      const linktext =
        target.dataset.href ?? target.getAttribute("href") ?? target.textContent ?? "";
      if (!linktext || /^https?:/.test(linktext)) return;
      state.app.workspace.trigger("hover-link", {
        event,
        source: "preview",
        hoverParent: root,
        targetEl: target,
        linktext,
        sourcePath: state.sourcePath,
      });
    });
    root.addEventListener("contextmenu", (event) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      const externalLinkEl = target?.closest<HTMLElement>(".external-link") ?? null;
      if (externalLinkEl) {
        const href = MarkdownRenderer.getRenderedExternalHref(externalLinkEl);
        if (!href) return;
        event.preventDefault();
        const menu = new Menu(root.ownerDocument);
        MarkdownRenderer.addCopyRenderedLinkTextItem(menu, externalLinkEl);
        state.app.workspace.handleExternalLinkContextMenu(menu, href);
        menu.showAtMouseEvent(event);
        return;
      }

      const internalLinkEl = target?.closest<HTMLElement>(".internal-link") ?? null;
      if (!internalLinkEl) return;
      const linktext = MarkdownRenderer.getRenderedInternalLinkText(internalLinkEl);
      if (!linktext || /^https?:/.test(linktext)) return;
      event.preventDefault();
      const menu = new Menu(root.ownerDocument);
      MarkdownRenderer.addCopyRenderedLinkTextItem(menu, internalLinkEl);
      state.app.workspace.handleLinkContextMenu(menu, linktext, state.sourcePath);
      menu.showAtMouseEvent(event);
    });
  }

  private static addCopyRenderedLinkTextItem(menu: Menu, linkEl: HTMLElement): void {
    const text = linkEl.textContent ?? "";
    menu.addItem((item) => {
      item
        .setTitle("Copy")
        .setIcon("lucide-copy")
        .setSection("info")
        .onClick(() => {
          void navigator.clipboard?.writeText(text);
        });
    });
  }

  private static getRenderedExternalHref(linkEl: HTMLElement): string | null {
    const href = linkEl.getAttribute("href") ?? linkEl.dataset.href ?? "";
    return href.length > 0 ? href : null;
  }

  private static getRenderedInternalLinkText(linkEl: HTMLElement): string | null {
    const linktext = linkEl.dataset.href ?? linkEl.getAttribute("href") ?? linkEl.textContent ?? "";
    return linktext.length > 0 ? linktext : null;
  }

  private static renderBlock(
    block: MarkdownParserToken[],
    root: HTMLElement,
    context: InternalMarkdownPostProcessorContext,
  ): HTMLElement {
    let blockId: string | undefined;
    const fragment = this.inlineRenderer.renderTokens(block, {
      ...context,
      onBlockId: (id) => {
        blockId = id;
      },
    });
    const children = [...fragment.childNodes].filter(
      (child) => child.nodeType !== Node.TEXT_NODE || Boolean(child.textContent?.trim()),
    );
    const section = document.createElement("div");
    const isHtmlBlock = block[0]?.type === "html_block";
    if (isHtmlBlock) section.className = "markdown-html-block";
    if (!isHtmlBlock && children.length === 1 && children[0] instanceof HTMLElement) {
      children[0].remove();
      normalizeTaskLists(children[0], block, getBlockStartLine(block));
      root.appendChild(children[0]);
      if (blockId) {
        children[0].id = blockId;
        children[0].dataset.blockId = blockId;
      }
      if (block[0]?.type === "fence") {
        children[0].querySelector<HTMLElement>("code")?.setAttribute("data-line", "0");
      }
      return children[0];
    }
    section.appendChild(fragment);
    if (blockId) {
      section.id = blockId;
      section.dataset.blockId = blockId;
    }
    root.appendChild(section);
    return section;
  }
}

function createReplaceCode(
  context: InternalMarkdownPostProcessorContext,
  sectionEl: HTMLElement,
  language: string,
): (source: string) => Promise<void> {
  return async (source: string) => {
    const info = context.getSectionInfo(sectionEl);
    if (!info || !context.replace) return;
    const lines = info.text.split(/\r?\n/);
    const start = Math.max(0, info.lineStart);
    const end = Math.max(start, info.lineEnd);
    const fence = lines[start] ?? `\`\`\`${language}`;
    const close = lines[end] && /^```\s*$/.test(lines[end]) ? lines[end] : "```";
    lines.splice(start, end - start + 1, fence, source, close);
    await context.replace(lines.join("\n"));
  };
}

function getFrontmatter(markdown: string): Record<string, unknown> | null | undefined {
  if (!/^---(?:\r?\n|$)/.test(markdown)) return null;
  const parsed = parseFrontmatter(markdown);
  return parsed.valid ? parsed.values : undefined;
}

export const getMarkdownFrontmatter = getFrontmatter;

function getBlockSectionInfo(
  block: MarkdownParserToken[],
  markdown: string,
): MarkdownSectionInformation {
  const maps = block
    .map((token) => token.map)
    .filter((map): map is [number, number] => Array.isArray(map) && map.length === 2);
  const lineStart = getBlockStartLine(block);
  const lineEndExclusive = maps.length ? Math.max(...maps.map(([, end]) => end)) : lineStart + 1;
  return {
    text: markdown,
    lineStart,
    lineEnd: Math.max(lineStart, lineEndExclusive - 1),
  };
}

function groupMarkdownTokens(tokens: MarkdownParserToken[]): MarkdownParserToken[][] {
  const blocks: MarkdownParserToken[][] = [];
  let current: MarkdownParserToken[] = [];
  let depth = 0;

  for (const token of tokens) {
    current.push(token);
    depth += token.nesting;
    if (depth === 0) {
      blocks.push(current);
      current = [];
    }
  }
  if (current.length) blocks.push(current);
  return blocks;
}

function isNonRenderableBlock(block: MarkdownParserToken[]): boolean {
  const type = block[0]?.type;
  return (
    type === "definition" ||
    type === "footnote_open" ||
    type === "footnote_block_open" ||
    type === "obsidian_comment_block"
  );
}

function getBlockStartLine(block: MarkdownParserToken[]): number {
  return block.find((token) => token.map)?.map?.[0] ?? 0;
}

function getBodyStartLine(markdown: string): number {
  const parsed = parseFrontmatter(markdown);
  if (!parsed.hasFrontmatter) return 0;
  const prefix = markdown.slice(0, markdown.length - parsed.body.length);
  return prefix.match(/\r?\n/g)?.length ?? 0;
}

function normalizeTaskLists(
  section: HTMLElement,
  block: MarkdownParserToken[],
  sectionStartLine: number,
): void {
  const items: Array<{ token: MarkdownParserToken; marker?: string }> = [];
  const stack: number[] = [];
  for (const token of block) {
    if (token.type === "list_item_open") {
      stack.push(items.push({ token }) - 1);
    } else if (token.type === "list_item_close") {
      stack.pop();
    } else if (token.type === "inline" && stack.length) {
      const current = items[stack[stack.length - 1]];
      current.marker ??= token.content.match(/^\[([^\]])\][ \t]/)?.[1];
    }
  }

  section.querySelectorAll<HTMLLIElement>("li").forEach((item, index) => {
    const info = items[index];
    const map = info?.token.map;
    const line = map ? Math.max(0, map[0] - sectionStartLine) : 0;
    item.dataset.line = String(line);
    if (!info?.marker) return;

    let checkbox = item.querySelector<HTMLInputElement>(":scope > input[type='checkbox']");
    if (!checkbox) {
      const text = [...item.childNodes].find((child) => child.nodeType === Node.TEXT_NODE);
      if (text) text.textContent = text.textContent?.replace(/^\s*\[[^\]]\][ \t]*/, "") ?? "";
      checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      item.prepend(checkbox);
    }

    const marker = info.marker;
    item.classList.add("task-list-item");
    item.classList.toggle("is-checked", marker !== " ");
    item.dataset.task = marker;
    checkbox.className = "task-list-item-checkbox";
    checkbox.disabled = false;
    checkbox.dataset.line = String(line);
    checkbox.checked = marker !== " ";
    if (checkbox.checked) checkbox.setAttribute("checked", "");
    else checkbox.removeAttribute("checked");

    const label = checkbox.nextElementSibling;
    if (label?.tagName === "LABEL")
      label.replaceWith(document.createTextNode(label.textContent ?? ""));
  });

  section.querySelectorAll<HTMLElement>("ul.task-list").forEach((list) => {
    list.classList.add("contains-task-list");
  });
  if (section.matches("ul.task-list")) section.classList.add("contains-task-list");
}

function setSectionInfo(el: HTMLElement, info: MarkdownSectionInformation): void {
  el.dataset.line = String(info.lineStart);
  el.dataset.lineStart = String(info.lineStart);
  el.dataset.lineEnd = String(info.lineEnd);
}

function copySectionAttributes(from: HTMLElement, to: HTMLElement): void {
  if (from.dataset.line) to.dataset.line = from.dataset.line;
  if (from.dataset.lineStart) to.dataset.lineStart = from.dataset.lineStart;
  if (from.dataset.lineEnd) to.dataset.lineEnd = from.dataset.lineEnd;
}

function cleanupRenderChildren(
  owner: Component,
  children: Set<MarkdownRenderChild> | undefined,
  sections: HTMLElement[],
  root?: HTMLElement,
): void {
  if (!children) return;
  // oxlint-disable-next-line unicorn/no-useless-spread -- Cleanup deletes children during iteration, so use a stable snapshot.
  for (const child of [...children]) {
    if (belongsToSections(child.containerEl, sections, root)) continue;
    owner.removeChild(child);
    children.delete(child);
  }
}

function belongsToSections(el: HTMLElement, sections: HTMLElement[], root?: HTMLElement): boolean {
  return (
    Boolean(root?.contains(el)) ||
    sections.some((section) => section === el || section.contains(el))
  );
}
