import { fuzzyMatch, prepareFuzzyQuery, type FuzzyMatch } from "../core/fuzzy";

export interface TagSuggestion {
  tag: string;
  score: number;
  matches: FuzzyMatch["matches"] | null;
}

export function getTagSuggestions(
  tags: string[],
  query: string,
  keepHash = false,
  existingValues: string[] = [],
): TagSuggestion[] {
  const preparedQuery = prepareFuzzyQuery(query);
  return tags
    .map((tag) => (keepHash ? tag : stripHash(tag)))
    .sort((a, b) => a.localeCompare(b))
    .map((tag) => createTagSuggestion(tag, query, keepHash, preparedQuery))
    .filter((item): item is TagSuggestion => item !== null)
    .filter((item) => !existingValues.includes(item.tag))
    .sort((a, b) => b.score - a.score || a.tag.localeCompare(b.tag));
}

export function completeTagSuggestionText(suggestion: TagSuggestion): string {
  const matches = suggestion.matches;
  if (matches && matches.length > 0) {
    const lastEnd = matches[matches.length - 1][1];
    const slashIndex = suggestion.tag.indexOf("/", lastEnd);
    if (slashIndex !== -1) return suggestion.tag.slice(0, slashIndex + 1);
  }
  return suggestion.tag;
}

export function renderTagSuggestion(parent: HTMLElement, suggestion: TagSuggestion): void {
  if (!suggestion.matches || suggestion.matches.length === 0) {
    parent.textContent = suggestion.tag;
    return;
  }
  let cursor = 0;
  for (const [start, end] of suggestion.matches) {
    if (start > cursor) parent.append(document.createTextNode(suggestion.tag.slice(cursor, start)));
    const highlightEl = document.createElement("span");
    highlightEl.className = "suggestion-highlight";
    highlightEl.textContent = suggestion.tag.slice(start, end);
    parent.appendChild(highlightEl);
    cursor = end;
  }
  if (cursor < suggestion.tag.length)
    parent.append(document.createTextNode(suggestion.tag.slice(cursor)));
}

export function stripHash(value: string): string {
  return value.startsWith("#") ? value.slice(1) : value;
}

function createTagSuggestion(
  tag: string,
  query: string,
  keepHash: boolean,
  preparedQuery: ReturnType<typeof prepareFuzzyQuery>,
): TagSuggestion | null {
  if (query === "" || (query === "#" && keepHash)) return { tag, score: 0, matches: null };
  const match = fuzzyMatch(preparedQuery, tag);
  return match ? { tag, score: match.score, matches: match.matches } : null;
}
