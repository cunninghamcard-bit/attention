export type SearchMatchPart = [number, number];
export type SearchMatches = SearchMatchPart[];

export interface SearchResult {
  score: number;
  matches: SearchMatches;
}

export interface SearchResultContainer {
  match: SearchResult;
}

const PUNCTUATION_RE = /[\u2000-\u206F\u2E00-\u2E7F\\'!"#$%&()*+,\-./:;<=>?@[\]^_`{|}~]/;
const WHITESPACE_RE = /\s/;
const CJK_RE = /[\u0F00-\u0FFF\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff66-\uff9f]/;

export interface PreparedQuery {
  query: string;
  tokens: string[];
  fuzzy: string[];
}

export function prepareFuzzySearch(query: string): (text: string) => SearchResult | null {
  const prepared = prepareQuery(query);
  return (text) => fuzzySearch(prepared, text);
}

export function prepareSimpleSearch(query: string): (text: string) => SearchResult | null {
  const tokens = query.toLowerCase().split(" ");
  return (text) => simpleSearch(tokens, query, text);
}

export function sortSearchResults(results: SearchResultContainer[]): void {
  results.sort((left, right) => right.match.score - left.match.score);
}

export function renderResults(
  el: HTMLElement,
  text: string,
  result: SearchResult | null,
  offset = 0,
): void {
  renderMatches(el, text, result ? result.matches : null, offset);
}

export function renderMatches(
  el: HTMLElement | DocumentFragment,
  text: string,
  matches: SearchMatches | null,
  offset = 0,
): void {
  el.appendChild(renderMatchesFragment(text, matches, offset, getOwnerDocument(el)));
}

export function prepareQuery(query: string): PreparedQuery {
  const lower = query.toLowerCase();
  const tokens: string[] = [];
  let start = 0;
  for (let index = 0; index < lower.length; index += 1) {
    const char = lower.charAt(index);
    if (WHITESPACE_RE.test(char)) {
      if (start !== index) tokens.push(lower.substring(start, index));
      start = index + 1;
    } else if (PUNCTUATION_RE.test(char) || CJK_RE.test(char)) {
      if (start !== index) tokens.push(lower.substring(start, index));
      tokens.push(char);
      start = index + 1;
    }
  }
  if (start !== lower.length) tokens.push(lower.substring(start, lower.length));
  return {
    query,
    tokens,
    fuzzy: lower.split("").filter((char) => char !== " "),
  };
}

export function fuzzySearch(query: PreparedQuery, text: string): SearchResult | null {
  if (query.query === "") return { score: 0, matches: [] };
  return (
    matchTokens(query.tokens, query.query, text, false) ??
    matchTokens(query.fuzzy, query.query, text, true)
  );
}

function matchTokens(
  tokens: string[],
  query: string,
  text: string,
  strictStart: boolean,
): SearchResult | null {
  if (tokens.length === 0) return null;
  const lowerText = text.toLowerCase();
  let skippedWordStarts = 0;
  let cursor = 0;
  const matches: SearchMatches = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const found = lowerText.indexOf(token, cursor);
    if (found === -1) return null;
    const originalChar = text.charAt(found);
    if (found > 0 && !PUNCTUATION_RE.test(originalChar) && !CJK_RE.test(originalChar)) {
      const previousChar = text.charAt(found - 1);
      const isBadCamelStart =
        (originalChar.toLowerCase() !== originalChar &&
          previousChar.toLowerCase() !== previousChar) ||
        (originalChar.toUpperCase() !== originalChar &&
          !PUNCTUATION_RE.test(previousChar) &&
          !WHITESPACE_RE.test(previousChar) &&
          !CJK_RE.test(previousChar));
      if (isBadCamelStart) {
        if (strictStart) {
          if (found !== cursor) {
            cursor += token.length;
            index -= 1;
            continue;
          }
        } else {
          skippedWordStarts += 1;
        }
      }
    }
    mergeAdjacentMatch(matches, [found, found + token.length]);
    cursor = found + token.length;
  }
  return {
    matches,
    score: scoreMatches(matches, query.length, lowerText.length, skippedWordStarts),
  };
}

function simpleSearch(tokens: string[], query: string, text: string): SearchResult | null {
  const matches = findSimpleMatches(tokens, text);
  return matches
    ? {
        score: scoreMatches(matches, query.length, text.length, 0),
        matches,
      }
    : null;
}

function findSimpleMatches(tokens: string[], text: string): SearchMatches | null {
  const lowerText = text.toLowerCase();
  const matches: SearchMatches = [];
  for (const token of tokens) {
    if (!token) continue;
    let foundAny = false;
    let cursor = -1;
    while ((cursor = lowerText.indexOf(token, cursor)) !== -1) {
      foundAny = true;
      matches.push([cursor, cursor + token.length]);
      cursor += token.length + 1;
    }
    if (!foundAny) return null;
  }
  return mergeMatches(matches);
}

function scoreMatches(
  matches: SearchMatches,
  queryLength: number,
  textLength: number,
  skippedWordStarts: number,
): number {
  if (matches.length === 0) return 0;
  let score = 0;
  score -= Math.max(0, matches.length - 1);
  score -= skippedWordStarts / 10;
  const firstStart = matches[0][0];
  score -= (matches[matches.length - 1][1] - firstStart + 1 - queryLength) / 100;
  score -= firstStart / 1000;
  score -= textLength / 10000;
  return score;
}

function mergeAdjacentMatch(matches: SearchMatches, next: SearchMatchPart): void {
  const previous = matches[matches.length - 1];
  if (!previous) {
    matches.push(next);
    return;
  }
  if (previous[1] < next[0]) matches.push(next);
  else previous[1] = Math.max(previous[1], next[1]);
}

function mergeMatches(matches: SearchMatches): SearchMatches {
  if (matches.length === 0) return matches;
  matches.sort((left, right) => left[0] - right[0]);
  const merged: SearchMatches = [matches[0]];
  for (let index = 1; index < matches.length; index += 1) {
    const previous = merged[merged.length - 1];
    const current = matches[index];
    if (previous[1] < current[0]) merged.push(current);
    else if (previous[1] < current[1]) previous[1] = current[1];
  }
  return merged;
}

function renderMatchesFragment(
  text: string,
  matches: SearchMatches | null,
  offset: number,
  doc: Document,
): Node {
  if (!matches || matches.length === 0) return doc.createTextNode(text);
  const fragment = doc.createDocumentFragment();
  let cursor = 0;
  for (let index = 0; cursor < text.length && index < matches.length; index += 1) {
    const match = matches[index];
    let start = match[0] + offset;
    const end = match[1] + offset;
    if (end <= 0) continue;
    if (start >= text.length) break;
    if (start < 0) start = 0;
    if (start !== cursor) fragment.appendChild(doc.createTextNode(text.substring(cursor, start)));
    const highlight = doc.createElement("span");
    highlight.className = "suggestion-highlight";
    highlight.textContent = text.substring(start, end);
    fragment.appendChild(highlight);
    cursor = end;
  }
  if (cursor < text.length) fragment.appendChild(doc.createTextNode(text.substring(cursor)));
  return fragment;
}

function getOwnerDocument(el: HTMLElement | DocumentFragment): Document {
  return el instanceof DocumentFragment ? document : el.ownerDocument;
}
