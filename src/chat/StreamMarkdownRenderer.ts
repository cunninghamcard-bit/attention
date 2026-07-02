import type { ParsedNode } from "stream-markdown-parser";
import { createEl } from "../dom/dom";
import { Component } from "../core/Component";
import { MarkdownRenderChild } from "../markdown/MarkdownRenderChild";
import { MarkdownRenderer, type MarkdownPostProcessorContext } from "../markdown/MarkdownRenderer";
import type { MarkdownPostProcessorRegistry } from "../markdown/MarkdownPostProcessorRegistry";

interface RenderedEntry {
  key: string;
  el: HTMLElement;
  child: MarkdownRenderChild;
}

type AnyNode = ParsedNode & {
  loading?: boolean;
  children?: AnyNode[];
  content?: string;
  raw?: string;
};

function nodeKey(node: AnyNode): string {
  return `${node.loading ? "~" : ""}${node.type}:${node.raw ?? ""}`;
}

// Renders markstream ParsedNode arrays into DOM with tail-only updates.
// Nodes are content-stable, not reference-stable, so entries are compared by
// type + raw source; a change only ever appears at the tail of the stream.
export class StreamMarkdownRenderer {
  private entries: RenderedEntry[] = [];

  constructor(
    private readonly containerEl: HTMLElement,
    private readonly owner: Component,
    private readonly sourcePath = "chat://message",
  ) {
    this.containerEl.classList.add("markdown-rendered");
  }

  update(nodes: ParsedNode[]): void {
    const incoming = nodes as AnyNode[];
    let firstChanged = 0;
    while (
      firstChanged < this.entries.length &&
      firstChanged < incoming.length &&
      this.entries[firstChanged].key === nodeKey(incoming[firstChanged])
    ) {
      firstChanged++;
    }
    while (this.entries.length > firstChanged) {
      const entry = this.entries.pop()!;
      this.owner.removeChild(entry.child);
      entry.el.remove();
    }
    for (let index = firstChanged; index < incoming.length; index++) {
      this.entries.push(this.renderEntry(incoming[index]));
    }
  }

  clear(): void {
    this.update([]);
  }

  private renderEntry(node: AnyNode): RenderedEntry {
    const el = this.renderBlock(node);
    if (node.loading) el.classList.add("is-loading");
    this.containerEl.appendChild(el);
    const child = new MarkdownRenderChild(el);
    this.owner.addChild(child);
    this.runPostProcessors(el, child);
    return { key: nodeKey(node), el, child };
  }

  private runPostProcessors(el: HTMLElement, child: MarkdownRenderChild): void {
    const registry = (MarkdownRenderer as unknown as { postProcessors: MarkdownPostProcessorRegistry }).postProcessors;
    const context: MarkdownPostProcessorContext & { promises: Promise<void>[] } = {
      docId: this.sourcePath,
      sourcePath: this.sourcePath,
      frontmatter: null,
      addChild: (grandChild) => void child.addChild(grandChild),
      getSectionInfo: () => null,
      promises: [],
    };
    registry.run(el, context);
  }

  private renderBlock(node: AnyNode): HTMLElement {
    switch (node.type) {
      case "heading": {
        const level = Math.min(Math.max((node as { level: number }).level || 1, 1), 6);
        const el = createEl(`h${level}` as keyof HTMLElementTagNameMap);
        this.renderInlineChildren(node.children, el);
        return el;
      }
      case "paragraph": {
        const el = createEl("p");
        this.renderInlineChildren(node.children, el);
        return el;
      }
      case "code_block": {
        const info = node as { language?: string; code?: string };
        const pre = createEl("pre");
        const code = createEl("code", { parent: pre, text: info.code ?? "" });
        if (info.language) code.classList.add(`language-${info.language}`);
        return pre;
      }
      case "blockquote": {
        const el = createEl("blockquote");
        for (const child of node.children ?? []) el.appendChild(this.renderBlock(child));
        return el;
      }
      case "list": {
        const info = node as { ordered?: boolean; start?: number; items?: AnyNode[] };
        const el = createEl(info.ordered ? "ol" : "ul");
        if (info.ordered && info.start !== undefined && info.start !== 1) el.setAttr("start", String(info.start));
        for (const item of info.items ?? []) {
          const itemEl = createEl("li", { parent: el });
          for (const child of (item as AnyNode).children ?? []) {
            if (child.type === "paragraph") this.renderInlineChildren(child.children, itemEl);
            else itemEl.appendChild(this.renderBlock(child));
          }
        }
        return el;
      }
      case "table": {
        const info = node as unknown as {
          header?: { cells?: AnyNode[] };
          rows?: Array<{ cells?: AnyNode[] }>;
        };
        const el = createEl("table");
        if (info.header?.cells?.length) {
          const rowEl = createEl("tr", { parent: createEl("thead", { parent: el }) });
          for (const cell of info.header.cells) this.renderTableCell(cell, rowEl, true);
        }
        const bodyEl = createEl("tbody", { parent: el });
        for (const row of info.rows ?? []) {
          const rowEl = createEl("tr", { parent: bodyEl });
          for (const cell of row.cells ?? []) this.renderTableCell(cell as AnyNode, rowEl, false);
        }
        return el;
      }
      case "thematic_break":
        return createEl("hr");
      default: {
        const el = createEl("p", "chat-unknown-block");
        el.setText(node.raw ?? node.content ?? "");
        return el;
      }
    }
  }

  private renderTableCell(cell: AnyNode, rowEl: HTMLElement, header: boolean): void {
    const info = cell as { header?: boolean; align?: string; children?: AnyNode[] };
    const cellEl = createEl(header || info.header ? "th" : "td", { parent: rowEl });
    if (info.align) cellEl.style.textAlign = info.align;
    this.renderInlineChildren(info.children, cellEl);
  }

  private renderInlineChildren(children: AnyNode[] | undefined, parent: HTMLElement): void {
    for (const child of children ?? []) this.renderInline(child, parent);
  }

  private renderInline(node: AnyNode, parent: HTMLElement): void {
    switch (node.type) {
      case "text":
        parent.appendText(node.content ?? "");
        return;
      case "strong":
        this.renderInlineChildren(node.children, createEl("strong", { parent }));
        return;
      case "emphasis":
        this.renderInlineChildren(node.children, createEl("em", { parent }));
        return;
      case "strikethrough":
        this.renderInlineChildren(node.children, createEl("del", { parent }));
        return;
      case "highlight":
        this.renderInlineChildren(node.children, createEl("mark", { parent }));
        return;
      case "inline_code":
        createEl("code", { parent, text: (node as { code?: string }).code ?? "" });
        return;
      case "link": {
        const info = node as { href?: string; url?: string };
        const el = createEl("a", { parent, href: info.href ?? info.url ?? "#" });
        el.setAttr("target", "_blank");
        el.setAttr("rel", "noopener");
        this.renderInlineChildren(node.children, el);
        return;
      }
      case "image": {
        const info = node as { src?: string; alt?: string };
        const el = createEl("img", { parent });
        el.setAttr("src", info.src ?? "");
        if (info.alt) el.setAttr("alt", info.alt);
        return;
      }
      case "hardbreak":
        createEl("br", { parent });
        return;
      case "inline":
        this.renderInlineChildren(node.children, parent);
        return;
      default:
        parent.appendText(node.raw ?? node.content ?? "");
    }
  }
}
