export function htmlToMarkdown(html: string): string {
  const template = document.createElement("template");
  template.innerHTML = html.trim();
  removeIgnoredNodes(template.content);
  return normalizeMarkdown(renderChildren(template.content)).trim();
}

function renderNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return normalizeText(node.textContent ?? "");
  if (!(node instanceof HTMLElement)) return renderChildren(node);

  const tag = node.tagName.toLowerCase();
  if (tag === "script" || tag === "style" || tag === "title") return "";
  if (tag === "br") return "  \n";
  if (tag === "hr") return block("---");
  if (tag === "p" || tag === "div" || tag === "section" || tag === "article")
    return block(renderChildren(node).trim());
  if (/^h[1-6]$/.test(tag))
    return block(`${"#".repeat(Number(tag[1]))} ${renderChildren(node).trim()}`);
  if (tag === "blockquote")
    return block(
      renderChildren(node)
        .trim()
        .replace(/\n{2,}/g, "\n")
        .replace(/^/gm, "> "),
    );
  if (tag === "strong" || tag === "b") return wrapInline("**", renderChildren(node));
  if (tag === "em" || tag === "i") return wrapInline("_", renderChildren(node));
  if (tag === "del" || tag === "s") return wrapInline("~~", renderChildren(node));
  if (tag === "mark") return wrapInline("==", renderChildren(node));
  if (tag === "a") return renderLink(node);
  if (tag === "img") return renderImage(node);
  if (tag === "code")
    return node.parentElement?.tagName.toLowerCase() === "pre"
      ? (node.textContent ?? "")
      : renderInlineCode(node.textContent ?? "");
  if (tag === "pre") return renderCodeBlock(node);
  if (tag === "ul" || tag === "ol") return block(renderList(node));
  if (tag === "li") return renderListItem(node);
  if (tag === "input") return renderTaskCheckbox(node);
  if (tag === "table") return renderTable(node);
  if (tag === "thead" || tag === "tbody" || tag === "tfoot") return renderChildren(node);
  if (tag === "tr") return renderTableRow(node);
  if (tag === "th" || tag === "td") return renderTableCell(node);

  return renderChildren(node);
}

function renderChildren(node: Node): string {
  return Array.from(node.childNodes).map(renderNode).join("");
}

function removeIgnoredNodes(root: ParentNode): void {
  for (const node of root.querySelectorAll("script, style, title")) node.remove();
}

function renderLink(node: HTMLElement): string {
  const href = node.getAttribute("href");
  const text = renderChildren(node).trim();
  if (!href) return text;
  const title = node.getAttribute("title");
  return `[${text}](${formatUrl(href)}${title ? ` "${formatTitle(title)}"` : ""})`;
}

function renderImage(node: HTMLElement): string {
  const src = node.getAttribute("src");
  if (!src) return "";
  const alt = formatTitle(node.getAttribute("alt") ?? "");
  const title = node.getAttribute("title");
  return `![${alt}](${formatUrl(src)}${title ? ` "${formatTitle(title)}"` : ""})`;
}

function renderInlineCode(text: string): string {
  const normalized = text.replace(/\s*\n\s*/g, " ");
  const longestRun = Math.max(
    0,
    ...Array.from(normalized.matchAll(/`+/g), (match) => match[0].length),
  );
  const ticks = "`".repeat(longestRun + 1);
  const padding = normalized.startsWith("`") || normalized.endsWith("`") ? " " : "";
  return `${ticks}${padding}${normalized}${padding}${ticks}`;
}

function renderCodeBlock(node: HTMLElement): string {
  const highlighted = getHighlightLanguage(node);
  const code = node.querySelector("code");
  const language = highlighted ?? getCodeLanguage(code);
  return block(`\`\`\`${language}\n${node.textContent ?? ""}\n\`\`\``);
}

function renderList(node: HTMLElement): string {
  const ordered = node.tagName.toLowerCase() === "ol";
  const start = Number(node.getAttribute("start") ?? "1");
  return Array.from(node.children)
    .filter(
      (child): child is HTMLElement =>
        child instanceof HTMLElement && child.tagName.toLowerCase() === "li",
    )
    .map((li, index) => renderListItem(li, ordered ? start + index : null))
    .join("\n");
}

function renderListItem(node: HTMLElement, order: number | null = null): string {
  const prefix = order == null ? "- " : `${order}. `;
  const content = renderChildren(node).replace(/^\n+/, "").replace(/\n+$/g, "\n").trimEnd();
  return `${prefix}${content.replace(/\n/g, "\n    ")}`;
}

function renderTaskCheckbox(node: HTMLElement): string {
  if (
    !(node instanceof HTMLInputElement) ||
    node.type !== "checkbox" ||
    node.parentElement?.tagName.toLowerCase() !== "li"
  )
    return "";
  return node.checked ? "[x] " : "[ ] ";
}

function renderTable(node: HTMLElement): string {
  const rows = getOwnTableRows(node);
  if (!rows.length) return "";
  const hasHeader = isHeaderRow(rows[0]);
  const renderedRows = rows.map(renderTableRow).join("");
  if (hasHeader) return block(renderedRows.replace(/[\r\n]+/g, "\n").trim());

  const columnCount = getTableColumnCount(rows[0]);
  const header = `|${"   |".repeat(columnCount)}`;
  const separator = `|${"---|".repeat(columnCount)}`;
  return block(
    `${header}\n${separator}\n${renderedRows
      .replace(/^[\r\n]+/, "")
      .replace(/[\r\n]+/g, "\n")
      .trim()}`,
  );
}

function renderTableRow(node: HTMLElement): string {
  const cells = Array.from(node instanceof HTMLTableRowElement ? node.cells : []).filter(
    (cell): cell is HTMLTableCellElement => cell instanceof HTMLTableCellElement,
  );
  let separator = "";
  if (isHeaderRow(node)) {
    separator = `\n${cells.map((cell, index) => `${index === 0 ? "|" : ""}${getAlignment(cell)}|${repeatForColspan(cell, `${getAlignment(cell)}|`)}`).join("")}`;
  }
  return `\n${cells.map((cell, index) => renderTableCell(cell, index === 0)).join("")}${separator}`;
}

function renderTableCell(node: HTMLElement, first = false): string {
  const content = renderChildren(node).trim().replace(/\|+/g, "\\|").replace(/\n\r?/g, "<br>");
  return `${first ? "|" : ""}${content}|${repeatForColspan(node, "   |")}`;
}

function isHeaderRow(row: Element | undefined): row is HTMLTableRowElement {
  if (!(row instanceof HTMLTableRowElement)) return false;
  const parent = row.parentElement;
  if (parent?.tagName === "THEAD") return true;
  const previous = parent?.previousElementSibling;
  const firstBodyRow =
    parent?.firstElementChild === row &&
    (parent?.tagName === "TABLE" ||
      (parent?.tagName === "TBODY" &&
        (!previous || (previous.tagName === "THEAD" && !previous.textContent?.trim()))));
  return Boolean(firstBodyRow && Array.from(row.children).every((child) => child.tagName === "TH"));
}

function getTableColumnCount(row: Element): number {
  if (!(row instanceof HTMLTableRowElement)) return 0;
  return Array.from(row.cells).reduce((count, cell) => count + 1 + getColspan(cell), 0);
}

function getAlignment(cell: HTMLElement): string {
  const align = (cell.getAttribute("align") ?? "").toLowerCase();
  if (align === "left") return ":--";
  if (align === "right") return "--:";
  if (align === "center") return ":-:";
  return "---";
}

function repeatForColspan(cell: Element, value: string): string {
  return value.repeat(getColspan(cell));
}

function getColspan(cell: Element): number {
  const raw = cell.getAttribute("colspan");
  if (!raw) return 0;
  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) ? 0 : Math.max(0, parsed - 1);
}

function getOwnTableRows(node: HTMLElement): HTMLTableRowElement[] {
  if (!(node instanceof HTMLTableElement)) return [];
  return Array.from(node.rows).filter((row) => row.closest("table") === node);
}

function getHighlightLanguage(pre: HTMLElement): string | null {
  const parent = pre.parentElement;
  if (!parent) return null;
  if (parent.tagName !== "DIV" || parent.firstElementChild !== pre) return null;
  const match = parent.className.match(/\bhighlight-(?:text|source)-([a-z0-9]+)/);
  return match?.[1] ?? null;
}

function getCodeLanguage(code: Element | null): string {
  const className = code?.className ?? "";
  return className.match(/\blanguage-([^\s]+)/)?.[1] ?? "";
}

function wrapInline(marker: string, value: string): string {
  const trimmed = value.trim();
  return trimmed ? `${marker}${trimmed}${marker}` : "";
}

function block(value: string): string {
  const trimmed = value.trim();
  return trimmed ? `\n\n${trimmed}\n\n` : "";
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ");
}

function normalizeMarkdown(markdown: string): string {
  return markdown.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n");
}

function formatUrl(url: string): string {
  return url.replace(/ /g, "%20").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function formatTitle(title: string): string {
  return title.replace(/(\n+\s*)+/g, "\n").replace(/"/g, '\\"');
}
