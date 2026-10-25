/**
 * Input: None
 * Output: pathToUri, uriToPath, normalizeUri, LanguageRange, LanguagePosition, normalizeLocations
 * Pos: Application code
 *
 * 🔄 Self-reference: When this file changes, update this header
 */

/**
 * `file://` URIs are the server's names for documents; disk paths are ours.
 * Servers do not agree on escaping (`@` vs `%40`, drive-letter case), so URIs
 * are never compared as received: both sides go through `normalizeUri` first.
 */

export interface LanguagePosition {
  /** 0-based line. */
  line: number;
  /** 0-based UTF-16 column — the LSP default and what CodeMirror counts in. */
  character: number;
}

export interface LanguageRange {
  uri: string;
  start: LanguagePosition;
  end: LanguagePosition;
}

export function pathToUri(path: string): string {
  let normalized = path.replace(/\\/g, "/");
  // Windows drive paths gain the leading slash a file URI needs.
  if (/^[A-Za-z]:\//.test(normalized)) normalized = `/${normalized}`;
  return `file://${normalized.split("/").map(encodeURIComponent).join("/")}`.replace(
    /^file:\/\/\/([A-Za-z])%3A\//,
    "file:///$1:/",
  );
}

export function uriToPath(uri: string): string | null {
  if (!uri.startsWith("file://")) return null;
  let path: string;
  try {
    path = decodeURIComponent(uri.slice("file://".length));
  } catch {
    return null;
  }
  // `file:///C:/x` → `C:/x`; a POSIX path keeps its leading slash.
  if (/^\/[A-Za-z]:\//.test(path)) path = path.slice(1);
  return path;
}

export function normalizeUri(uri: string): string {
  const path = uriToPath(uri);
  return path === null ? uri : pathToUri(path);
}

interface RawRange {
  start: LanguagePosition;
  end: LanguagePosition;
}

/**
 * `textDocument/definition` and friends answer with a `Location`, a list of
 * them, a list of `LocationLink`s, or null. Flatten all of that to ranges.
 */
export function normalizeLocations(result: unknown): LanguageRange[] {
  if (!result) return [];
  const items = Array.isArray(result) ? result : [result];
  const ranges: LanguageRange[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const record = item as {
      uri?: unknown;
      range?: RawRange;
      targetUri?: unknown;
      targetSelectionRange?: RawRange;
      targetRange?: RawRange;
    };
    const uri = typeof record.targetUri === "string" ? record.targetUri : record.uri;
    const range = record.targetSelectionRange ?? record.targetRange ?? record.range;
    if (typeof uri !== "string" || !range?.start || !range.end) continue;
    ranges.push({ uri: normalizeUri(uri), start: range.start, end: range.end });
  }
  return ranges;
}
