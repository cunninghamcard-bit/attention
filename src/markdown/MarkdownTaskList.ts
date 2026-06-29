export interface ChecklistToggleResult {
  text: string;
  marker: string;
  checked: boolean;
}

export function toggleCheckboxAtLine(text: string, line: number): ChecklistToggleResult | null {
  const range = getLineRange(text, line);
  if (!range) return null;
  const lineText = text.slice(range.start, range.end);
  const task = /\[.\]/.exec(lineText);
  if (!task) return null;
  const markerIndex = range.start + task.index + 1;
  const marker = text[markerIndex] === " " ? "x" : " ";
  return {
    text: `${text.slice(0, markerIndex)}${marker}${text.slice(markerIndex + 1)}`,
    marker,
    checked: marker !== " ",
  };
}

function getLineRange(text: string, line: number): { start: number; end: number } | null {
  if (!Number.isFinite(line) || line < 0) return null;
  let start = 0;
  for (let current = 0; current < line; current += 1) {
    const next = text.indexOf("\n", start);
    if (next === -1) return null;
    start = next + 1;
  }
  let end = text.indexOf("\n", start);
  if (end === -1) end = text.length;
  if (end > start && text[end - 1] === "\r") end -= 1;
  return { start, end };
}
