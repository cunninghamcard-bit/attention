import type { App } from "../app/App";

export interface InlineRenderContext {
  app: App | null;
  sourcePath: string;
}

export class MarkdownInlineRenderer {
  render(text: string, context: InlineRenderContext): DocumentFragment {
    const fragment = document.createDocumentFragment();
    const pattern =
      /(!?\[\[([^\]|]+)(?:\|([^\]]+))?\]\])|(`([^`]+)`)|(!\[([^\]]*)\]\(([^)]+)\))|\[([^\]]+)\]\(([^)]+)\)/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(text))) {
      appendText(fragment, text.slice(lastIndex, match.index));
      if (match[1])
        this.renderWikiLink(
          fragment,
          Boolean(match[1].startsWith("!")),
          match[2],
          match[3],
          context,
        );
      else if (match[4]) this.renderCode(fragment, match[5]);
      else if (match[6]) this.renderMarkdownImage(fragment, match[7], match[8], context);
      else if (match[9]) this.renderMarkdownLink(fragment, match[9], match[10]);
      lastIndex = pattern.lastIndex;
    }

    appendText(fragment, text.slice(lastIndex));
    return fragment;
  }

  private renderWikiLink(
    fragment: DocumentFragment,
    embed: boolean,
    target: string,
    alias: string | undefined,
    context: InlineRenderContext,
  ): void {
    const el = document.createElement("span");
    el.className = embed ? "internal-embed" : "internal-link";
    el.dataset.href = target;
    el.dataset.sourcePath = context.sourcePath;
    if (embed) applyEmbedTitle(el, target, alias ?? "");
    el.textContent = alias ?? target;
    fragment.appendChild(el);
  }

  // `![alt](src)`: an external URL renders directly; a vault-relative path
  // becomes an internal embed handled by the same embed post-processor as
  // `![[...]]` (real Obsidian treats both as embeds; alt text that parses as
  // dimensions becomes width/height — real `qx`).
  private renderMarkdownImage(
    fragment: DocumentFragment,
    alt: string,
    src: string,
    context: InlineRenderContext,
  ): void {
    if (/^https?:\/\//.test(src)) {
      const img = document.createElement("img");
      applyImageDimensionsFromAlt(img, alt);
      img.src = src;
      fragment.appendChild(img);
      return;
    }
    const el = document.createElement("span");
    el.className = "internal-embed";
    const target = decodeURIComponent(src);
    el.dataset.href = target;
    el.dataset.sourcePath = context.sourcePath;
    applyEmbedTitle(el, target, alt);
    el.textContent = alt || src;
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

// Real `zx`: a "300" / "300x200" dimension spec.
function parseDimensions(text: string): { x: number; y: number } | null {
  const match = text.match(/^\s*([0-9]+)\s*(?:x\s*([0-9]+)\s*)?$/);
  return match ? { x: parseInt(match[1]), y: match[2] ? parseInt(match[2]) : 0 } : null;
}

// Real `applyTitle`: the embed container carries src/alt/width/height
// attributes. The LAST `|` segment of the alias is tried as a dimension spec
// and stripped; an alias that is nothing but dimensions leaves no alt.
function applyEmbedTitle(el: HTMLElement, target: string, title: string): void {
  let x = 0;
  let y = 0;
  if (title) {
    const pipe = title.lastIndexOf("|");
    if (pipe !== -1) {
      const parsed = parseDimensions(title.slice(pipe + 1));
      if (parsed) {
        ({ x, y } = parsed);
        title = title.slice(0, pipe);
      }
    } else {
      const parsed = parseDimensions(title);
      if (parsed) {
        ({ x, y } = parsed);
        title = "";
      }
    }
  }
  el.setAttribute("src", target);
  if (title) el.setAttribute("alt", title);
  if (x !== 0) el.setAttribute("width", String(x));
  if (y !== 0) el.setAttribute("height", String(y));
}

// Real `qx` (markdown `![alt](url)`): alt text that is purely a dimension
// spec becomes width/height instead of alt.
function applyImageDimensionsFromAlt(img: HTMLImageElement, alt: string): void {
  const parsed = alt ? parseDimensions(alt) : null;
  if (parsed) {
    img.setAttribute("width", String(parsed.x));
    if (parsed.y !== 0) img.setAttribute("height", String(parsed.y));
  } else if (alt) {
    img.setAttribute("alt", alt);
  }
}
