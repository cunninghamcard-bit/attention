import { getMarkdown, type MarkdownIt } from "stream-markdown-parser";
import type { App } from "../app/App";
import { sanitizeHTMLToDom } from "../core/ApiUtils";

export type MarkdownParserToken = ReturnType<MarkdownIt["parse"]>[number];

interface FootnoteItem {
  label?: string;
  count?: number;
  content?: string;
  tokens?: MarkdownParserToken[];
}

interface MarkdownEnvironment extends Record<string, unknown> {
  references?: Record<string, { href: string; title?: string }>;
  footnotes?: {
    refs?: Record<string, number>;
    list?: FootnoteItem[];
  };
  inlineContext?: InlineRenderContext;
}

export interface MarkdownInlineState {
  environment: MarkdownEnvironment;
  footnoteDefinitions: Map<string, MarkdownParserToken[]>;
}

export interface InlineRenderContext {
  app: App | null;
  sourcePath: string;
  inlineState?: MarkdownInlineState;
  onBlockId?(id: string): void;
}

export class MarkdownInlineRenderer {
  private readonly markdown = createMarkdownParser();

  createState(markdown: string): MarkdownInlineState {
    const discovered: MarkdownEnvironment = {};
    const tokens = this.markdown.parse(normalizeFootnoteLabels(markdown), discovered);
    const definitionRefs = discovered.footnotes?.refs ?? {};
    const refs = new Proxy<Record<string, number>>(
      Object.fromEntries(Object.keys(definitionRefs).map((key) => [key.toLowerCase(), -1])),
      {
        get: (target, key) =>
          typeof key === "string" ? target[key.toLowerCase()] : Reflect.get(target, key),
        set: (target, key, value) =>
          Reflect.set(target, typeof key === "string" ? key.toLowerCase() : key, value),
      },
    );
    return {
      environment: {
        references: discovered.references,
        footnotes: { refs, list: [] },
      },
      footnoteDefinitions: collectFootnoteDefinitions(tokens),
    };
  }

  parse(markdown: string, state: MarkdownInlineState): MarkdownParserToken[] {
    return this.markdown.parse(normalizeFootnoteLabels(markdown), state.environment);
  }

  renderFootnotes(context: InlineRenderContext): HTMLElement | null {
    const state = context.inlineState;
    const items = state?.environment.footnotes?.list;
    if (!state || !items?.length) return null;

    const section = document.createElement("section");
    section.className = "footnotes";
    section.appendChild(document.createElement("hr"));
    const list = document.createElement("ol");
    list.className = "footnotes-list";
    section.appendChild(list);

    items.forEach((item, index) => {
      const number = index + 1;
      const li = document.createElement("li");
      li.id = `fn-${number}`;
      li.dataset.footnoteId = `fn-${number}`;
      const definition =
        item.tokens ?? state.footnoteDefinitions.get(item.label?.toLowerCase() ?? "");
      if (definition) {
        const fragment = this.renderTokens(definition, context);
        if (item.tokens) {
          const paragraph = document.createElement("p");
          paragraph.appendChild(fragment);
          li.appendChild(paragraph);
        } else {
          li.appendChild(fragment);
        }
      }

      const backrefParent = li.querySelector("p:last-of-type") ?? li;
      const count = Math.max(1, item.count ?? 1);
      for (let subId = 0; subId < count; subId += 1) {
        const suffix = footnoteSuffix(number, subId);
        const backref = document.createElement("a");
        backref.className = "footnote-backref footnote-link";
        backref.href = `#fnref-${suffix}`;
        backref.textContent = "↩︎";
        backrefParent.appendChild(backref);
      }
      list.appendChild(li);
    });
    return section;
  }

  renderTokens(tokens: MarkdownParserToken[], context: InlineRenderContext): DocumentFragment {
    const environment = context.inlineState?.environment ?? emptyState().environment;
    return this.renderTokensToFragment(tokens, context, environment);
  }

  private renderTokensToFragment(
    tokens: MarkdownParserToken[],
    context: InlineRenderContext,
    environment: MarkdownEnvironment,
  ): DocumentFragment {
    environment.inlineContext = context;
    try {
      const html = this.markdown.renderer.render(tokens, this.markdown.options, environment);
      const fragment = sanitizeHTMLToDom(html);
      this.decorate(fragment, context);
      return fragment;
    } finally {
      delete environment.inlineContext;
    }
  }

  private decorate(fragment: DocumentFragment, context: InlineRenderContext): void {
    for (const image of [
      ...fragment.querySelectorAll<HTMLImageElement>("img[data-markdown-image][src]"),
    ]) {
      image.removeAttribute("data-markdown-image");
      const src = image.getAttribute("src") ?? "";
      const alt = image.getAttribute("alt") ?? "";
      if (!isInternalUrl(src)) {
        applyImageDimensionsFromAlt(image, alt);
        continue;
      }
      const embed = document.createElement("span");
      const target = normalizeLink(src);
      embed.className = "internal-embed";
      embed.dataset.href = target;
      embed.dataset.sourcePath = context.sourcePath;
      applyEmbedTitle(embed, target, alt);
      if (image.title) embed.title = image.title;
      embed.textContent = alt || src;
      image.replaceWith(embed);
    }

    for (const link of fragment.querySelectorAll<HTMLAnchorElement>("a[href]")) {
      if (link.matches(".tag, .footnote-link")) continue;
      const href = link.getAttribute("href") ?? "";
      if (link.classList.contains("internal-link") || isInternalUrl(href)) {
        const target = normalizeLink(link.dataset.href ?? href);
        link.classList.add("internal-link");
        link.dataset.href = target;
        link.dataset.sourcePath = context.sourcePath;
        continue;
      }
      link.classList.add("external-link");
      link.target = "_blank";
      link.rel = "noopener nofollow";
      if (link.textContent !== href) {
        link.setAttribute("aria-label", href);
        link.dataset.tooltipPosition = "top";
      }
    }
  }
}

interface InlineParserState {
  src: string;
  pos: number;
  posMax: number;
  push(type: string, tag: string, nesting: number): MarkdownParserToken;
}

function createMarkdownParser(): MarkdownIt {
  const markdown = getMarkdown("markdown-inline-renderer", {
    enableContainers: false,
    markdownItOptions: {
      breaks: true,
      html: true,
      linkify: false,
      stream: false,
      typographer: false,
    },
  });
  markdown.disable(["ins", "math", "sub", "sup", "wave"], true);
  installObsidianRules(markdown);
  markdown.renderer.rules.fence = (tokens, index) => renderCodeToken(markdown, tokens[index]);
  markdown.renderer.rules.code_block = (tokens, index) => renderCodeToken(markdown, tokens[index]);
  return markdown;
}

function installObsidianRules(markdown: MarkdownIt): void {
  const esc = (value: string): string => markdown.utils.escapeHtml(value);
  markdown.block.ruler.before("paragraph", "obsidian-comment-block", readCommentBlock);
  markdown.inline.ruler.before("text", "obsidian-wikilink", readWikiLink);
  markdown.inline.ruler.before("text", "obsidian-tag", readTag);
  markdown.inline.ruler.before("text", "obsidian-comment", readComment);
  markdown.inline.ruler.before("text", "obsidian-blockid", readBlockId);
  markdown.inline.ruler.before("text", "obsidian-math", readMath);

  markdown.renderer.rules.obsidian_wikilink = (tokens, index, _options, environment) => {
    const meta = getMeta(tokens[index]);
    const href = String(meta.href ?? "");
    const title = String(meta.title ?? "");
    const alias = meta.alias === true;
    const context = getContext(environment);
    const tooltip = alias
      ? ` aria-label="${esc(displayWikiTarget(href))}" data-tooltip-position="top"`
      : "";
    return `<a class="internal-link" href="${esc(href)}" data-href="${esc(href)}" data-source-path="${esc(context?.sourcePath ?? "")}"${tooltip}>${esc(title)}</a>`;
  };
  markdown.renderer.rules.obsidian_embed = (tokens, index, _options, environment) => {
    const meta = getMeta(tokens[index]);
    const href = String(meta.href ?? "");
    const title = String(meta.title ?? "");
    const alias = meta.alias === true;
    const context = getContext(environment);
    const embed = document.createElement("span");
    embed.className = "internal-embed";
    embed.dataset.href = href;
    embed.dataset.sourcePath = context?.sourcePath ?? "";
    applyEmbedTitle(embed, href, alias ? title : "");
    embed.textContent = title;
    return embed.outerHTML;
  };
  markdown.renderer.rules.obsidian_tag = (tokens, index) => {
    const tag = tokens[index].content;
    return `<a class="tag" href="${esc(tag)}">${esc(tag)}</a>`;
  };
  markdown.renderer.rules.obsidian_comment = () => "";
  markdown.renderer.rules.obsidian_comment_block = () => "";
  markdown.renderer.rules.image = (tokens, index) => {
    const token = tokens[index];
    const src = esc(token.attrGet("src") ?? "");
    const alt = esc(token.content);
    const title = token.attrGet("title");
    const titleAttribute = title ? ` title="${esc(title)}"` : "";
    return `<img src="${src}" alt="${alt}" data-markdown-image="true"${titleAttribute}>`;
  };
  markdown.renderer.rules.s_open = () => "<del>";
  markdown.renderer.rules.s_close = () => "</del>";
  markdown.renderer.rules.obsidian_blockid = (tokens, index, _options, environment) => {
    getContext(environment)?.onBlockId?.(String(getMeta(tokens[index]).id ?? ""));
    return "";
  };
  markdown.renderer.rules.obsidian_math = (tokens, index) => {
    const token = tokens[index];
    const className = getMeta(token).display === true ? "math math-block" : "math math-inline";
    return `<span class="${className}">${esc(token.content)}</span>`;
  };
  markdown.renderer.rules.footnote_ref = (tokens, index, _options, environment) => {
    const meta = getMeta(tokens[index]);
    const number = Number(meta.id ?? 0) + 1;
    const subId = Number(meta.subId ?? 0);
    const suffix = footnoteSuffix(number, subId);
    const identifier = String(meta.label ?? `inline-${number}`);
    return `<sup class="footnote-ref" data-footnote-id="fnref-${suffix}" id="fnref-${suffix}"><a class="footnote-link" href="#fn-${number}" data-footref="${esc(identifier)}">[${suffix}]</a></sup>`;
  };
}

interface BlockParserState {
  src: { slice(start?: number, end?: number): string };
  bMarks: number[];
  eMarks: number[];
  line: number;
  push(type: string, tag: string, nesting: number): MarkdownParserToken;
}

function readCommentBlock(
  state: BlockParserState,
  startLine: number,
  endLine: number,
  silent: boolean,
): boolean {
  const opening = state.src.slice(state.bMarks[startLine], state.eMarks[startLine]).trim();
  if (!/^%%+$/.test(opening)) return false;

  let closeLine = startLine + 1;
  while (closeLine < endLine) {
    const line = state.src.slice(state.bMarks[closeLine], state.eMarks[closeLine]).trim();
    if (line === opening) break;
    closeLine += 1;
  }
  if (closeLine >= endLine) return false;
  if (!silent) {
    const token = state.push("obsidian_comment_block", "", 0);
    token.map = [startLine, closeLine + 1];
  }
  state.line = closeLine + 1;
  return true;
}

function renderCodeToken(markdown: MarkdownIt, token: MarkdownParserToken): string {
  const language = token.info.trim().split(/\s+/)[0] ?? "";
  const className = language ? ` class="language-${markdown.utils.escapeHtml(language)}"` : "";
  const content = token.content.replace(/\n$/, "");
  return `<pre><code${className}>${markdown.utils.escapeHtml(content)}</code></pre>\n`;
}

function readWikiLink(state: InlineParserState, silent: boolean): boolean {
  const embed = state.src.startsWith("![[", state.pos);
  if (!embed && !state.src.startsWith("[[", state.pos)) return false;
  const contentStart = state.pos + (embed ? 3 : 2);
  const end = state.src.indexOf("]]", contentStart);
  if (end === -1) return false;
  const value = state.src.slice(contentStart, end).trim();
  if (!value || value.includes("[[")) return false;
  if (!silent) {
    const token = state.push(embed ? "obsidian_embed" : "obsidian_wikilink", "", 0);
    token.meta = parseWikiLink(value);
  }
  state.pos = end + 2;
  return true;
}

function readTag(state: InlineParserState, silent: boolean): boolean {
  if (state.src[state.pos] !== "#" || /\S/.test(state.src[state.pos - 1] ?? "")) return false;
  const match = TAG_PATTERN.exec(state.src.slice(state.pos));
  if (!match || /^#\d+$/.test(match[0])) return false;
  if (!silent) {
    const token = state.push("obsidian_tag", "", 0);
    token.content = match[0];
  }
  state.pos += match[0].length;
  return true;
}

function readComment(state: InlineParserState, silent: boolean): boolean {
  if (!state.src.startsWith("%%", state.pos)) return false;
  const end = state.src.indexOf("%%", state.pos + 2);
  if (end <= state.pos + 2 || state.src.slice(state.pos + 2, end).includes("\n")) return false;
  if (!silent) state.push("obsidian_comment", "", 0);
  state.pos = end + 2;
  return true;
}

function readBlockId(state: InlineParserState, silent: boolean): boolean {
  if (state.src[state.pos] !== "^" || /\S/.test(state.src[state.pos - 1] ?? "")) return false;
  const match = /^\^([a-z\d-]+)(?=$|\n$|\n\n)/i.exec(state.src.slice(state.pos));
  if (!match) return false;
  if (!silent) {
    const token = state.push("obsidian_blockid", "", 0);
    token.meta = { id: match[1] };
  }
  state.pos += match[0].length;
  return true;
}

function readMath(state: InlineParserState, silent: boolean): boolean {
  if (state.src[state.pos] !== "$") return false;
  const display = state.src[state.pos + 1] === "$";
  const marker = display ? "$$" : "$";
  const start = state.pos + marker.length;
  if (!display && /[ \t]/.test(state.src[start] ?? "")) return false;

  let end = state.src.indexOf(marker, start);
  while (end !== -1) {
    if (isEscaped(state.src, end)) {
      end = state.src.indexOf(marker, end + marker.length);
      continue;
    }
    if (
      !display &&
      (/[ \t]/.test(state.src[end - 1] ?? "") || /\d/.test(state.src[end + 1] ?? ""))
    ) {
      end = state.src.indexOf(marker, end + marker.length);
      continue;
    }
    break;
  }
  if (end <= start) return false;
  if (!silent) {
    const token = state.push("obsidian_math", "", 0);
    token.content = state.src.slice(start, end);
    token.meta = { display };
  }
  state.pos = end + marker.length;
  return true;
}

const TAG_PATTERN = /^#[^\u2000-\u206f\u2e00-\u2e7f'!"#$%&()*+,.:;<=>?@^`{|}~\[\]\\\s]+/u;

function parseWikiLink(value: string): { href: string; title: string; alias: boolean } {
  const pipe = value.indexOf("|");
  const alias = pipe > 0;
  let href = (alias ? value.slice(0, pipe) : value).trim();
  const title = alias ? value.slice(pipe + 1).trim() : displayWikiTarget(href);
  if (href.endsWith("\\")) href = href.slice(0, -1);
  return { href: normalizeLink(href), title, alias };
}

function displayWikiTarget(target: string): string {
  return target.split("#").filter(Boolean).join(" > ").trim();
}

function collectFootnoteDefinitions(
  tokens: MarkdownParserToken[],
): Map<string, MarkdownParserToken[]> {
  const definitions = new Map<string, MarkdownParserToken[]>();
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index].type !== "footnote_open") continue;
    const label = getMeta(tokens[index]).label;
    if (typeof label !== "string") continue;
    const body: MarkdownParserToken[] = [];
    for (index += 1; index < tokens.length && tokens[index].type !== "footnote_close"; index += 1) {
      if (tokens[index].type !== "footnote_anchor") body.push(tokens[index]);
    }
    definitions.set(label.toLowerCase(), body);
  }
  return definitions;
}

function emptyState(): MarkdownInlineState {
  return {
    environment: { footnotes: { refs: {}, list: [] } },
    footnoteDefinitions: new Map(),
  };
}

function getMeta(token: MarkdownParserToken): Record<string, unknown> {
  return token.meta && typeof token.meta === "object" ? token.meta : {};
}

function getContext(environment: unknown): InlineRenderContext | undefined {
  return (environment as MarkdownEnvironment | undefined)?.inlineContext;
}

function isInternalUrl(url: string): boolean {
  return url.startsWith("./") || url.startsWith("../") || !url.includes(":");
}

function normalizeLink(value: string): string {
  try {
    value = decodeURI(value);
  } catch {
    // Keep malformed percent escapes resolvable as written.
  }
  return value
    .replace(/\u00a0/g, " ")
    .trim()
    .normalize("NFC");
}

function footnoteSuffix(number: number, subId: number): string {
  return subId > 0 ? `${number}-${subId}` : String(number);
}

function normalizeFootnoteLabels(markdown: string): string {
  return markdown.replace(
    /\[\^([^\]\s]+)]/g,
    (_match, label: string) => `[^${label.toLowerCase()}]`,
  );
}

function isEscaped(text: string, index: number): boolean {
  let slashes = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === "\\"; cursor -= 1) slashes += 1;
  return slashes % 2 === 1;
}

function parseDimensions(text: string): { x: number; y: number } | null {
  const match = text.match(/^\s*([0-9]+)\s*(?:x\s*([0-9]+)\s*)?$/);
  return match ? { x: parseInt(match[1]), y: match[2] ? parseInt(match[2]) : 0 } : null;
}

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

function applyImageDimensionsFromAlt(img: HTMLImageElement, alt: string): void {
  const parsed = alt ? parseDimensions(alt) : null;
  if (!parsed) return;
  img.removeAttribute("alt");
  img.setAttribute("width", String(parsed.x));
  if (parsed.y !== 0) img.setAttribute("height", String(parsed.y));
}
