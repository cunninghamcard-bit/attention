export interface MarkdownListItem {
  text: string;
  lineStart: number;
  children: MarkdownListItem[];
  checklist?: string;
  checked?: boolean;
}

export type MarkdownBlock =
  | { type: "heading"; level: number; text: string; lineStart: number; lineEnd: number }
  | { type: "paragraph"; text: string; lineStart: number; lineEnd: number }
  | { type: "code"; language: string; source: string; lineStart: number; lineEnd: number }
  | { type: "blockquote"; text: string; lineStart: number; lineEnd: number }
  | { type: "list"; items: MarkdownListItem[]; lineStart: number; lineEnd: number };

export class MarkdownBlockParser {
  parse(source: string): MarkdownBlock[] {
    const lines = source.split(/\r?\n/);
    const blocks: MarkdownBlock[] = [];
    let index = 0;

    while (index < lines.length) {
      const line = lines[index];
      if (!line.trim()) {
        index += 1;
        continue;
      }

      const fence = line.match(/^```([^`]*)\s*$/);
      if (fence) {
        const start = index;
        const language = fence[1].trim();
        const body: string[] = [];
        index += 1;
        while (index < lines.length && !/^```\s*$/.test(lines[index])) {
          body.push(lines[index]);
          index += 1;
        }
        blocks.push({ type: "code", language, source: body.join("\n"), lineStart: start, lineEnd: index });
        index += 1;
        continue;
      }

      const heading = line.match(/^(#{1,6})\s+(.+)$/);
      if (heading) {
        blocks.push({ type: "heading", level: heading[1].length, text: heading[2], lineStart: index, lineEnd: index });
        index += 1;
        continue;
      }

      if (/^>\s?/.test(line)) {
        const start = index;
        const body: string[] = [];
        while (index < lines.length && /^>\s?/.test(lines[index])) {
          body.push(lines[index].replace(/^>\s?/, ""));
          index += 1;
        }
        blocks.push({ type: "blockquote", text: body.join("\n"), lineStart: start, lineEnd: index - 1 });
        continue;
      }

      if (/^\s*[-*+]\s+/.test(line)) {
        const start = index;
        const listLines: ParsedListLine[] = [];
        while (index < lines.length && /^\s*[-*+]\s+/.test(lines[index])) {
          const match = lines[index].match(/^(\s*)[-*+]\s+(.+)$/);
          if (match) {
            const item = parseListItemText(match[2]);
            listLines.push({
              indent: match[1].replace(/\t/g, "  ").length,
              text: item.text,
              lineStart: index,
              checklist: item.checklist,
              checked: item.checked,
            });
          }
          index += 1;
        }
        blocks.push({ type: "list", items: buildListTree(listLines), lineStart: start, lineEnd: index - 1 });
        continue;
      }

      const start = index;
      const body: string[] = [];
      while (index < lines.length && lines[index].trim() && !/^```/.test(lines[index]) && !/^(#{1,6})\s+/.test(lines[index])) {
        body.push(lines[index]);
        index += 1;
      }
      blocks.push({ type: "paragraph", text: body.join("\n"), lineStart: start, lineEnd: index - 1 });
    }

    return blocks;
  }
}

interface ParsedListLine {
  indent: number;
  text: string;
  lineStart: number;
  checklist?: string;
  checked?: boolean;
}

function parseListItemText(text: string): Pick<MarkdownListItem, "text" | "checklist" | "checked"> {
  const task = text.match(/^\[(.)][ \t]/);
  if (!task) return { text };
  const checklist = task[1];
  return {
    text: text.slice(task[0].length),
    checklist,
    checked: checklist !== " ",
  };
}

function buildListTree(lines: ParsedListLine[]): MarkdownListItem[] {
  const root: MarkdownListItem[] = [];
  const stack: Array<{ indent: number; items: MarkdownListItem[]; item: MarkdownListItem | null }> = [{ indent: -1, items: root, item: null }];

  for (const line of lines) {
    while (stack.length > 1 && line.indent <= stack[stack.length - 1].indent) stack.pop();
    const parent = stack[stack.length - 1];
    const item: MarkdownListItem = { text: line.text, lineStart: line.lineStart, children: [] };
    if (line.checklist !== undefined) {
      item.checklist = line.checklist;
      item.checked = line.checked;
    }
    parent.items.push(item);
    stack.push({ indent: line.indent, items: item.children, item });
  }

  return root;
}
