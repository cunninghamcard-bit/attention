import { MarkdownRenderer } from "../markdown/MarkdownRenderer";

// "@名字" highlighting inside rendered chat markdown. Registered through the
// SAME postProcessor chain plugins use (dogfooding the extension seam); the
// sourcePath guard keeps it out of MarkdownView — mentions are chat grammar,
// not markdown grammar.
const MENTION_PATTERN = /@[^\s@,,。;;!!??::.()()[\]]{1,24}/g;

export function highlightMentionsIn(rootEl: HTMLElement): void {
  const doc = rootEl.ownerDocument;
  const walker = doc.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parentEl = node.parentElement;
    if (!parentEl || parentEl.closest("pre, code, .chat-mention")) continue;
    if (node.nodeValue?.includes("@")) textNodes.push(node as Text);
  }
  for (const textNode of textNodes) {
    const text = textNode.nodeValue ?? "";
    MENTION_PATTERN.lastIndex = 0;
    if (!MENTION_PATTERN.test(text)) continue;
    MENTION_PATTERN.lastIndex = 0;
    const fragment = doc.createDocumentFragment();
    let cursor = 0;
    for (const match of text.matchAll(MENTION_PATTERN)) {
      const index = match.index ?? 0;
      if (index > cursor) fragment.appendChild(doc.createTextNode(text.slice(cursor, index)));
      const mentionEl = doc.createElement("span");
      mentionEl.className = "chat-mention";
      mentionEl.textContent = match[0];
      fragment.appendChild(mentionEl);
      cursor = index + match[0].length;
    }
    if (cursor < text.length) fragment.appendChild(doc.createTextNode(text.slice(cursor)));
    textNode.replaceWith(fragment);
  }
}

export function registerMentionPostProcessor(): void {
  (MarkdownRenderer as unknown as {
    registerPostProcessor(processor: (el: HTMLElement, ctx: { sourcePath?: string }) => void): void;
  }).registerPostProcessor((el, ctx) => {
    if (!ctx.sourcePath?.startsWith("agent://")) return;
    highlightMentionsIn(el);
  });
}
