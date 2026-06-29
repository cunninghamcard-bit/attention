import type { App } from "../app/App";
import { removeChildren } from "../dom/dom";
import { Menu } from "../ui/Menu";
import { MarkdownBlockParser, type MarkdownBlock, type MarkdownListItem } from "./MarkdownBlockParser";
import { MarkdownInlineRenderer } from "./MarkdownInlineRenderer";
import { MarkdownCodeBlockRegistry } from "./MarkdownCodeBlockRegistry";
import { MarkdownPostProcessorRegistry } from "./MarkdownPostProcessorRegistry";
import { RenderContext } from "./RenderContext";
import { MarkdownLinkResolver } from "./MarkdownLinkResolver";
import type { Component } from "../core/Component";
import { MarkdownRenderChild } from "./MarkdownRenderChild";
import { parseFrontmatter } from "../properties/Frontmatter";

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
  app: App;
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

export abstract class MarkdownRenderer extends MarkdownRenderChild implements MarkdownPreviewEvents {
  private static parser = new MarkdownBlockParser();
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

  static registerPostProcessor(processor: MarkdownPostProcessor, sortOrder = processor.sortOrder ?? 0): void {
    this.postProcessors.register(processor, sortOrder);
  }

  static unregisterPostProcessor(processor: MarkdownPostProcessor): void {
    this.postProcessors.unregister(processor);
  }

  static registerCodeBlockPostProcessor(language: string, processor: MarkdownCodeBlockProcessor): void {
    this.codeBlocks.register(language, processor);
  }

  static unregisterCodeBlockPostProcessor(language: string): void {
    this.codeBlocks.unregister(language);
  }

  static createCodeBlockPostProcessor(language: string, processor: MarkdownCodeBlockProcessor): MarkdownPostProcessor {
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
        if (result instanceof Promise) internalContext.promises.push(result);
      }
    };
  }

  static renderMarkdown(markdown: string, container: HTMLElement, sourcePath: string, component: Component): Promise<void> {
    const app = getAppFromComponent(component);
    if (!app) return Promise.reject(new Error("MarkdownRenderer.renderMarkdown requires a component attached to an app"));
    return this.render(app, markdown, container, sourcePath, component);
  }

  static async render(
    app: App,
    markdown: string,
    container: HTMLElement,
    sourcePath: string,
    component?: Component,
    options: MarkdownRenderOptions = {},
  ): Promise<void> {
    if (component) cleanupRenderChildren(component, this.renderChildren.get(container), []);
    removeChildren(container);
    const renderContext = new RenderContext(app, sourcePath, container);
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
      promises: [],
      addChild: (child) => {
        if (component) {
          component.addChild(child);
          currentChildren.add(child);
          return;
        }
        if (!this.warnedMissingComponent) {
          this.warnedMissingComponent = true;
          console.warn("MarkdownRenderer.render called without a Component; MarkdownRenderChild cleanup is not managed.");
        }
        child.load();
      },
      getSectionInfo: options.getSectionInfo ?? (() => null),
      replace: () => null,
    };
    const root = container.classList.contains("markdown-rendered") ? container : document.createElement("div");
    if (root !== container) {
      root.className = "markdown-rendered";
      container.appendChild(root);
    }
    this.installInternalLinkHandlers(app, options.containerEl ?? root, sourcePath);

    const sections: HTMLElement[] = [];
    for (const block of this.parser.parse(markdown)) {
      const section = await this.renderBlock(block, root, context);
      const info = getBlockSectionInfo(block, markdown);
      setSectionInfo(section, info);
      sections.push(section);
    }

    for (const section of sections) {
      const sectionContext: InternalMarkdownPostProcessorContext = {
        ...context,
        el: section,
        replace: (source) => options.replace ? options.replace(source, section) : null,
      };
      await this.postProcessors.run(section, sectionContext);
      options.onSectionPostProcess?.(section, sectionContext);
    }
    await Promise.all(context.promises);
    if (component) {
      cleanupRenderChildren(component, currentChildren, sections, root);
      this.renderChildren.set(container, currentChildren);
    }
  }

  private static installInternalLinkHandlers(app: App, root: HTMLElement, sourcePath: string): void {
    const existing = this.linkHandlerState.get(root);
    if (existing) {
      existing.app = app;
      existing.sourcePath = sourcePath;
      return;
    }
    const state = { app, sourcePath };
    this.linkHandlerState.set(root, state);
    root.addEventListener("click", (event) => {
      const target = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>(".internal-link") : null;
      if (!target) return;
      const linktext = target.dataset.href ?? target.getAttribute("href") ?? target.textContent ?? "";
      if (!linktext || /^https?:/.test(linktext)) return;
      event.preventDefault();
      const resolver = new MarkdownLinkResolver(state.app);
      void resolver.openLinkText(linktext, state.sourcePath);
    });
    root.addEventListener("mouseover", (event) => {
      const target = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>(".internal-link") : null;
      if (!target) return;
      const linktext = target.dataset.href ?? target.getAttribute("href") ?? target.textContent ?? "";
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

  private static async renderBlock(block: MarkdownBlock, root: HTMLElement, context: InternalMarkdownPostProcessorContext): Promise<HTMLElement> {
    if (block.type === "heading") {
      const heading = document.createElement(`h${block.level}`);
      heading.appendChild(this.inlineRenderer.render(block.text, context));
      root.appendChild(heading);
      return heading;
    }

    if (block.type === "paragraph") {
      const paragraph = document.createElement("p");
      paragraph.appendChild(this.inlineRenderer.render(block.text, context));
      root.appendChild(paragraph);
      return paragraph;
    }

    if (block.type === "blockquote") {
      const quote = document.createElement("blockquote");
      quote.appendChild(this.inlineRenderer.render(block.text, context));
      root.appendChild(quote);
      return quote;
    }

    if (block.type === "list") {
      const list = this.renderList(block.items, block.lineStart, context);
      root.appendChild(list);
      return list;
    }

    const pre = document.createElement("pre");
    const code = document.createElement("code");
    code.className = block.language ? `language-${block.language}` : "";
    code.dataset.line = "0";
    code.textContent = block.source;
    pre.appendChild(code);
    root.appendChild(pre);
    return pre;
  }

  private static renderList(items: MarkdownListItem[], sectionStartLine: number, context: InternalMarkdownPostProcessorContext): HTMLUListElement {
    const list = document.createElement("ul");
    let containsTasks = false;
    for (const item of items) {
      const li = this.renderListItem(item, sectionStartLine, context);
      if (li.classList.contains("task-list-item")) containsTasks = true;
      list.appendChild(li);
    }
    if (containsTasks) list.classList.add("contains-task-list");
    return list;
  }

  private static renderListItem(item: MarkdownListItem, sectionStartLine: number, context: InternalMarkdownPostProcessorContext): HTMLLIElement {
    const li = document.createElement("li");
    const line = String(Math.max(0, item.lineStart - sectionStartLine));
    li.dataset.line = line;
    if (item.checklist !== undefined) {
      li.classList.add("task-list-item");
      li.classList.toggle("is-checked", item.checked === true);
      li.dataset.task = item.checklist;
      const checkbox = document.createElement("input");
      checkbox.className = "task-list-item-checkbox";
      checkbox.type = "checkbox";
      checkbox.checked = item.checked === true;
      checkbox.dataset.line = line;
      if (item.checked) checkbox.setAttribute("checked", "");
      li.appendChild(checkbox);
    }
    li.appendChild(this.inlineRenderer.render(item.text, context));
    if (item.children.length > 0) {
      li.appendChild(this.renderList(item.children, sectionStartLine, context));
    }
    return li;
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

function getBlockSectionInfo(block: MarkdownBlock, markdown: string): MarkdownSectionInformation {
  return {
    text: markdown,
    lineStart: block.lineStart,
    lineEnd: block.lineEnd,
  };
}

function setSectionInfo(
  el: HTMLElement,
  info: MarkdownSectionInformation,
): void {
  el.dataset.line = String(info.lineStart);
  el.dataset.lineStart = String(info.lineStart);
  el.dataset.lineEnd = String(info.lineEnd);
}

function copySectionAttributes(from: HTMLElement, to: HTMLElement): void {
  if (from.dataset.line) to.dataset.line = from.dataset.line;
  if (from.dataset.lineStart) to.dataset.lineStart = from.dataset.lineStart;
  if (from.dataset.lineEnd) to.dataset.lineEnd = from.dataset.lineEnd;
}

function getAppFromComponent(component: Component): App | null {
  const componentApp = (component as Component & { app?: App }).app;
  if (componentApp) return componentApp;
  return (window as Window & { app?: App }).app ?? null;
}

function cleanupRenderChildren(
  owner: Component,
  children: Set<MarkdownRenderChild> | undefined,
  sections: HTMLElement[],
  root?: HTMLElement,
): void {
  if (!children) return;
  for (const child of [...children]) {
    if (belongsToSections(child.containerEl, sections, root)) continue;
    owner.removeChild(child);
    children.delete(child);
  }
}

function belongsToSections(el: HTMLElement, sections: HTMLElement[], root?: HTMLElement): boolean {
  return Boolean(root?.contains(el)) || sections.some((section) => section === el || section.contains(el));
}
