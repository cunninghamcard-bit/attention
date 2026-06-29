import type { App } from "../app/App";

export interface InlineRenderContext {
  app: App;
  sourcePath: string;
}

export class MarkdownInlineRenderer {
  render(text: string, context: InlineRenderContext): DocumentFragment {
    const fragment = document.createDocumentFragment();
    const pattern = /(!?\[\[([^\]|]+)(?:\|([^\]]+))?\]\])|(`([^`]+)`)|\[([^\]]+)\]\(([^)]+)\)/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(text))) {
      appendText(fragment, text.slice(lastIndex, match.index));
      if (match[1]) this.renderWikiLink(fragment, Boolean(match[1].startsWith("!")), match[2], match[3], context);
      else if (match[4]) this.renderCode(fragment, match[5]);
      else if (match[6]) this.renderMarkdownLink(fragment, match[6], match[7]);
      lastIndex = pattern.lastIndex;
    }

    appendText(fragment, text.slice(lastIndex));
    return fragment;
  }

  private renderWikiLink(fragment: DocumentFragment, embed: boolean, target: string, alias: string | undefined, context: InlineRenderContext): void {
    const el = document.createElement("span");
    el.className = embed ? "internal-embed" : "internal-link";
    el.dataset.href = target;
    el.dataset.sourcePath = context.sourcePath;
    el.textContent = alias ?? target;
    fragment.appendChild(el);
  }

  private renderCode(fragment: DocumentFragment, text: string): void {
    const code = document.createElement("code");
    code.textContent = text;
    fragment.appendChild(code);
  }

  private renderMarkdownLink(fragment: DocumentFragment, text: string, href: string): void {
    const link = document.createElement("a");
    link.href = href;
    link.textContent = text;
    link.className = href.startsWith("http") ? "external-link" : "internal-link";
    fragment.appendChild(link);
  }
}

function appendText(fragment: DocumentFragment, text: string): void {
  if (text) fragment.appendChild(document.createTextNode(text));
}
