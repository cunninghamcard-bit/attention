import { randomBytes } from "node:crypto";
import { join, resolve } from "node:path";
import { APP_ORIGIN } from "./renderer-target";

/**
 * The `app://` protocol — real Obsidian serves the renderer bundle and vault
 * media through a custom scheme (reverse note "`app://` protocol").
 *
 * Two origins share the scheme:
 * - `app://obsidian.md/<rel>` (symbol `se`): renderer resources, resolved
 *   under the resources dir and rejected if the path escapes it.
 * - `app://<random36>/<abs>` (symbol `Be`): absolute local file access for
 *   vault media; the random per-launch host is what `file-url` returns.
 *
 * The URL resolver and the HTTP Range math are pure and tested here; the
 * `protocol.handle` streaming glue lives in `registerAppProtocol`.
 */

/** Real `Be = Ie + ct(36) + "/"` — a fresh per-launch file-access origin. */
export function createFileOrigin(): string {
  const host = randomBytes(18).toString("hex").slice(0, 36);
  return `app://${host}/`;
}

export interface ResolveDeps {
  /** Renderer resources root (`c`). */
  resourcesDir: string;
  /** The per-launch file origin (`Be`). */
  fileOrigin: string;
  /** Real `Y` — Windows drops the leading "/" the POSIX branch adds. */
  isWindows?: boolean;
  /** Real `ft` — remote/UNC paths get `X-Frame-Options: DENY`. */
  isRemotePath?: (path: string) => boolean;
}

export interface ResolvedAppUrl {
  /** Absolute filesystem path, or "" for a 400. */
  path: string;
  /** Whether the response must carry `X-Frame-Options: DENY`. */
  noframe: boolean;
}

/**
 * Real `e(url)`: map an `app://` URL to a filesystem path.
 *
 * - strip `?query` and `#hash`;
 * - `app://obsidian.md/<rel>` → join under resourcesDir, reject escapes, noframe;
 * - `app://<random>/<abs>` → decode to an absolute path (POSIX prefixes "/"),
 *   noframe only for remote/UNC paths;
 * - anything else → "" (400).
 */
export function resolveAppUrl(rawUrl: string, deps: ResolveDeps): ResolvedAppUrl {
  const isRemotePath = deps.isRemotePath ?? defaultIsRemotePath;
  let url = rawUrl;
  const q = url.indexOf("?");
  if (q > 0) url = url.substring(0, q);
  const h = url.indexOf("#");
  if (h > 0) url = url.substring(0, h);

  if (url.indexOf(APP_ORIGIN) === 0) {
    const rel = decodeURIComponent(url.substring(APP_ORIGIN.length));
    const resolved = resolve(join(deps.resourcesDir, rel));
    if (resolved.indexOf(resolve(deps.resourcesDir)) !== 0) {
      return { path: "", noframe: true };
    }
    return { path: resolved, noframe: true };
  }

  if (url.indexOf(deps.fileOrigin) === 0) {
    let abs = decodeURIComponent(url.substring(deps.fileOrigin.length));
    if (!deps.isWindows) abs = "/" + abs;
    abs = resolve(abs);
    return { path: abs, noframe: isRemotePath(abs) };
  }

  return { path: "", noframe: false };
}

/** UNC (`\\server`) or POSIX network mount (`//host`). */
function defaultIsRemotePath(path: string): boolean {
  return path.startsWith("\\\\") || path.startsWith("//");
}

/**
 * Content-Type by file extension. Real Obsidian serves resources through
 * `registerFileProtocol`, which infers the MIME type from the extension; the
 * modern `protocol.handle` path must set it explicitly or the browser refuses
 * to execute ES module scripts and apply stylesheets (strict MIME checking).
 */
const MIME_BY_EXT: Record<string, string> = {
  html: "text/html",
  htm: "text/html",
  js: "text/javascript",
  mjs: "text/javascript",
  cjs: "text/javascript",
  css: "text/css",
  json: "application/json",
  map: "application/json",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  wasm: "application/wasm",
  txt: "text/plain",
  md: "text/markdown",
};

export function contentTypeFor(path: string): string | undefined {
  const dot = path.lastIndexOf(".");
  if (dot < 0) return undefined;
  return MIME_BY_EXT[path.slice(dot + 1).toLowerCase()];
}

export interface ContentRange {
  status: 200 | 206 | 416;
  start: number;
  end: number;
  headers: Record<string, string>;
}

/**
 * Real Range handling in the `protocol.handle` branch: parse
 * `bytes=start-end` against a file of `size` bytes and produce the status +
 * headers. No Range header → full 200.
 */
export function computeContentRange(rangeHeader: string | null, size: number): ContentRange {
  if (!rangeHeader) {
    return { status: 200, start: 0, end: size - 1, headers: { "Content-Length": `${size}` } };
  }
  const match = rangeHeader.match(/^bytes=(\d*)-(\d*)/);
  if (!match) return { status: 416, start: 0, end: 0, headers: {} };
  const start = Number(match[1] || 0);
  const end = Number(match[2] || size - 1);
  if (isNaN(start) || isNaN(end) || start < 0 || end > size - 1 || end < start) {
    return { status: 416, start: 0, end: 0, headers: {} };
  }
  return {
    status: 206,
    start,
    end,
    headers: {
      "Accept-Ranges": "bytes",
      "Content-Length": `${end - start + 1}`,
      "Content-Range": `bytes ${start}-${end}/${size}`,
    },
  };
}
