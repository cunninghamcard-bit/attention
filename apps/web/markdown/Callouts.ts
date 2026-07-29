/**
 * Input: ../ui/Icon, ../dom/Animate
 * Output: CALLOUT_MARKER, renderCallouts
 * Pos: Application code
 *
 * 🔄 Self-reference: When this file changes, update this header
 */

import { setIcon } from "../ui/Icon";
import { setElCollapsed } from "../dom/Animate";

/**
 * Obsidian's callout, ported from app.js (blockquote tokenizer, the
 * blockquote→callout mdast transform, the hast builders and the fold/icon
 * post-processor).
 *
 * The contract themes and app.css read is `data-callout="<type>"` on a
 * `div.callout` — NOT a `callout-<type>` class, which exists nowhere in
 * app.css. All 26 type rules in our faithful callout.css select on that
 * attribute, so until this DOM existed every one of them was unreachable.
 *
 * Obsidian rewrites the blockquote in the mdast, before any DOM exists. We do
 * it as a post-processor over the rendered blockquote instead, because our
 * pipeline has no transformer seam — the resulting DOM is the same, which is
 * what every consumer keys off. The one thing that costs us is that inline
 * title content has to be moved rather than re-tokenized.
 */

/** `[!type|metadata]` plus an optional fold marker, on the first line only. */
export const CALLOUT_MARKER = /^\[!([^\]]+)\]([+-]?)(?:\s|$)/;

interface CalloutSpec {
  type: string;
  fold: string;
  metadata: string;
}

function parseMarker(text: string): { spec: CalloutSpec; length: number } | null {
  const match = CALLOUT_MARKER.exec(text);
  if (!match) return null;
  const raw = match[1];
  const pipe = raw.indexOf("|");
  const type = (pipe === -1 ? raw : raw.slice(0, pipe)).trim().toLowerCase().replace(/\s+/g, "-");
  return {
    spec: { type, fold: match[2], metadata: pipe === -1 ? "" : raw.slice(pipe + 1) },
    length: match[0].length,
  };
}

/** `my-type` → `My type`, the title Obsidian synthesizes when none was written. */
function titleFromType(type: string): string {
  const words = type.trim().replace(/-/g, " ").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * The icon comes from the cascade, not from us: app.css maps each type to a
 * `--callout-icon`, and this reads it back off the computed style. That is
 * the hinge that lets a theme restyle callout icons without touching any JS.
 */
function applyCalloutIcon(calloutEl: HTMLElement, iconEl: HTMLElement): void {
  if (iconEl.firstChild) return;
  const name =
    calloutEl.getAttribute("data-callout-icon") ||
    getComputedStyle(calloutEl).getPropertyValue("--callout-icon").trim();
  if (name) setIcon(iconEl, name.replace(/^['"]|['"]$/g, ""));
}

/**
 * Wire the fold, ported from the post-processor. Only `+`/`-` are collapsible;
 * a bare `[!note]` gets no chevron and no handlers at all.
 *
 * Two click paths that deliberately do not overlap: the chevron preventDefaults
 * its own click, and the title's handler is deferred a task and bails when the
 * event was already defaulted — so a chevron click toggles once rather than
 * twice, and a link inside the title never folds the callout.
 */
function installCalloutFold(calloutEl: HTMLElement, titleEl: HTMLElement, contentEl: HTMLElement) {
  const fold = calloutEl.getAttribute("data-callout-fold");
  if (fold !== "+" && fold !== "-") return;
  calloutEl.classList.add("is-collapsible");
  if (titleEl.querySelector(".callout-fold")) return;

  let collapsed = false;
  const apply = (value: boolean, animate: boolean): void => {
    collapsed = value;
    calloutEl.classList.toggle("is-collapsed", collapsed);
    foldEl.classList.toggle("is-collapsed", collapsed);
    void setElCollapsed(contentEl, collapsed, animate);
  };
  const toggle = (): void => apply(!collapsed, true);

  // Appended, so the chevron is the LAST child of the title, after the icon
  // and the title text.
  const foldEl = titleEl.ownerDocument.createElement("div");
  foldEl.className = "callout-fold";
  titleEl.appendChild(foldEl);
  foldEl.addEventListener("click", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    toggle();
  });
  setIcon(foldEl, "lucide-chevron-down");

  titleEl.addEventListener("mousedown", (event) => {
    if (event.detail > 1) event.preventDefault();
  });
  titleEl.addEventListener("click", (event) => {
    setTimeout(() => {
      if (event.button !== 0 || event.defaultPrevented) return;
      event.preventDefault();
      toggle();
    }, 0);
  });

  // The initial collapsed state is NOT animated — only user clicks are.
  if (fold === "-") apply(true, false);
}

/** Rewrite every `> [!type]` blockquote in `root` into Obsidian's callout DOM. */
export function renderCallouts(root: HTMLElement): void {
  // The root itself can BE the blockquote: section rendering hands each block
  // over on its own, and querySelectorAll never matches the element it is
  // called on.
  const quotes = [...root.querySelectorAll("blockquote")];
  if (root.tagName === "BLOCKQUOTE") quotes.unshift(root as HTMLQuoteElement);
  for (const quote of quotes) {
    const first = quote.firstElementChild;
    const leading = first?.textContent ?? "";
    const parsed = parseMarker(leading);
    if (!parsed) continue;
    const doc = quote.ownerDocument;

    const calloutEl = doc.createElement("div");
    // The callout REPLACES the blockquote, so it inherits whatever the render
    // pipeline hung on it — `data-line` and friends, which drive section
    // mapping. In Obsidian the callout IS that element; here it has to be
    // handed the identity explicitly.
    for (const attribute of quote.attributes) {
      if (attribute.name !== "class") calloutEl.setAttribute(attribute.name, attribute.value);
    }
    calloutEl.className = "callout";
    calloutEl.setAttribute("data-callout", parsed.spec.type);
    calloutEl.setAttribute("data-callout-fold", parsed.spec.fold);
    calloutEl.setAttribute("data-callout-metadata", parsed.spec.metadata);

    const titleEl = doc.createElement("div");
    titleEl.className = "callout-title";
    const iconEl = doc.createElement("div");
    iconEl.className = "callout-icon";
    const titleInnerEl = doc.createElement("div");
    titleInnerEl.className = "callout-title-inner";
    titleEl.append(iconEl, titleInnerEl);
    const contentEl = doc.createElement("div");
    contentEl.className = "callout-content";

    // The marker itself never reaches the title, so strip it off the first
    // text node before anything is moved.
    if (first) {
      const walker = doc.createTreeWalker(first, NodeFilter.SHOW_TEXT);
      const firstText = walker.nextNode();
      if (firstText?.nodeValue) firstText.nodeValue = firstText.nodeValue.slice(parsed.length);
      // Title runs to the first hard break; everything after it is body.
      const nodes = [...first.childNodes];
      const breakAt = nodes.findIndex((node) => (node as Element).tagName === "BR");
      const titleNodes = breakAt === -1 ? nodes : nodes.slice(0, breakAt);
      const restNodes = breakAt === -1 ? [] : nodes.slice(breakAt + 1);
      titleInnerEl.append(...titleNodes);
      if (restNodes.length > 0) {
        const restEl = doc.createElement("p");
        restEl.append(...restNodes);
        contentEl.appendChild(restEl);
      }
      first.remove();
    }
    if (!titleInnerEl.textContent?.trim()) {
      titleInnerEl.textContent = titleFromType(parsed.spec.type);
    }
    contentEl.append(...quote.childNodes);

    calloutEl.append(titleEl, contentEl);
    quote.replaceWith(calloutEl);
    applyCalloutIcon(calloutEl, iconEl);
    installCalloutFold(calloutEl, titleEl, contentEl);
  }
}
