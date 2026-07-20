import { parse as parseYamlSource, stringify as stringifyYamlSource } from "yaml";
import type { App } from "../app/App";
import { htmlToMarkdown as convertHtmlToMarkdown } from "../markdown/HtmlToMarkdown";
import { preprocessHtmlDrop } from "../markdown/HtmlDropPreprocessor";
import type { CachedMetadata } from "../metadata/MetadataCache";
import { getActiveWindow } from "../dom/ActiveDocument";

export const apiVersion = "1.12.7";

const MOMENT_VALUE = Symbol("moment-value");

/** Minimal compatibility shape retained for community plugins after uprooting moment. */
export const moment = Object.assign(
  (input?: string | number | Date) => {
    const date = input === undefined ? new Date() : new Date(input);
    return {
      [MOMENT_VALUE]: true,
      // ponytail: supports the token subset this app exposes; extend only when a real plugin needs more.
      format(pattern: string): string {
        const pad = (value: number) => String(value).padStart(2, "0");
        const values: Record<string, string> = {
          YYYY: String(date.getFullYear()),
          YY: String(date.getFullYear()).slice(-2),
          MM: pad(date.getMonth() + 1),
          M: String(date.getMonth() + 1),
          DD: pad(date.getDate()),
          D: String(date.getDate()),
          HH: pad(date.getHours()),
          H: String(date.getHours()),
          mm: pad(date.getMinutes()),
          m: String(date.getMinutes()),
          ss: pad(date.getSeconds()),
          s: String(date.getSeconds()),
        };
        return pattern.replace(/YYYY|YY|MM|M|DD|D|HH|H|mm|m|ss|s/g, (token) => values[token]);
      },
    };
  },
  {
    isMoment(value: unknown): boolean {
      return Boolean(value && typeof value === "object" && MOMENT_VALUE in value);
    },
  },
);

export type Constructor<T> = abstract new (...args: any[]) => T;
export type Side = "left" | "right";
export type TooltipPlacement = "bottom" | "right" | "left" | "top";

export interface RGB {
  r: number;
  g: number;
  b: number;
}

export interface HSL {
  h: number;
  s: number;
  l: number;
}

export interface RequestUrlParam {
  url: string;
  method?: string;
  contentType?: string;
  body?: string | ArrayBuffer;
  headers?: Record<string, string>;
  throw?: boolean;
}

export interface RequestUrlResponse {
  status: number;
  headers: Record<string, string>;
  arrayBuffer: ArrayBuffer;
  json: any;
  text: string;
}

export type RequestUrlError = Error & {
  status: number;
  response: RequestUrlResponse;
};

export interface RequestUrlResponsePromise extends Promise<RequestUrlResponse> {
  arrayBuffer: Promise<ArrayBuffer>;
  json: Promise<any>;
  text: Promise<string>;
}

interface NativeRequestUrlResponse {
  status: number;
  headers?: Record<string, string>;
  body?: ArrayBuffer | ArrayBufferView;
  arrayBuffer?: ArrayBuffer | ArrayBufferView;
  text?: string;
  json?: any;
}

export interface Debouncer<T extends unknown[], V> {
  (...args: T): Debouncer<T, V>;
  cancel(): Debouncer<T, V>;
  run(): V | void;
}

export type DebouncedFunction<T extends (...args: never[]) => unknown> = Debouncer<
  Parameters<T>,
  ReturnType<T>
>;

const STRIP_HEADING_RE = /[!"#$%&()*+,.:;<=>?@^`{|}~/\[\]\\\r\n]/g;
const STRIP_HEADING_FOR_LINK_RE = /([:#|^\\\r\n]|%%|\[\[|\]\])/g;
const DEFAULT_LANGUAGE = "en";
const SUPPORTED_LANGUAGES = new Set([
  "am",
  "ar",
  "be",
  "bn",
  "ca",
  "cs",
  "da",
  "de",
  "en",
  "en-GB",
  "es",
  "fa",
  "fi",
  "fr",
  "ga",
  "he",
  "hu",
  "id",
  "it",
  "ja",
  "ka",
  "kh",
  "ko",
  "lv",
  "ms",
  "ne",
  "nl",
  "no",
  "pl",
  "pt",
  "pt-BR",
  "ro",
  "ru",
  "sk",
  "sq",
  "sr",
  "sv",
  "th",
  "tr",
  "uk",
  "uz",
  "vi",
  "zh",
  "zh-TW",
]);

export interface FrontMatterInfo {
  exists: boolean;
  frontmatter: string;
  contentStart: number;
  from: number;
  to: number;
}

export interface SubpathResult {
  type: "heading" | "block" | "footnote";
  start?: unknown;
  end?: unknown;
}

export interface HeadingSubpathResult extends SubpathResult {
  type: "heading";
  current: NonNullable<CachedMetadata["headings"]>[number];
  next: NonNullable<CachedMetadata["headings"]>[number] | null;
}

export interface BlockSubpathResult extends SubpathResult {
  type: "block";
  block: { id: string; position?: unknown };
  list: { id?: string; position?: unknown } | null;
}

export interface FootnoteSubpathResult extends SubpathResult {
  type: "footnote";
  footnote: NonNullable<CachedMetadata["footnotes"]>[number];
}

export function requireApiVersion(version: string): boolean {
  return !isApiVersionLessThan(apiVersion, version);
}

function isApiVersionLessThan(current: string, required: string): boolean {
  const currentParts = parseApiVersion(current);
  const requiredParts = parseApiVersion(required);
  if (!requiredParts) return false;
  if (!currentParts) return true;
  const length = Math.min(currentParts.length, requiredParts.length);
  for (let index = 0; index < length; index += 1) {
    if (currentParts[index] < requiredParts[index]) return true;
    if (currentParts[index] > requiredParts[index]) return false;
  }
  return currentParts.length < requiredParts.length;
}

function parseApiVersion(version: string): number[] | null {
  if (!version || typeof version !== "string") return null;
  let valid = true;
  const parts = version.split(".").map((part) => {
    const value = Number.parseInt(part, 10);
    if (Number.isNaN(value)) valid = false;
    return value;
  });
  return valid ? parts : null;
}

export function normalizePath(path: string): string {
  const normalizedPath = path
    .replace(/\u00A0|\u202F/g, " ")
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
  return (normalizedPath || "/").normalize("NFC");
}

export function request(request: RequestUrlParam | string, app?: App): Promise<string> {
  return requestUrl(request, app).text;
}

export function requestUrl(
  request: RequestUrlParam | string,
  app?: App,
): RequestUrlResponsePromise {
  const rawRequest = typeof request === "string" ? { url: request } : request;
  const responsePromise = requestUrlViaPlatform(rawRequest, app).then((response) => {
    if (rawRequest.throw !== false && response.status >= 400) {
      const error = new Error(`Request failed, status ${response.status}`) as RequestUrlError;
      error.status = response.status;
      error.response = response;
      throw error;
    }
    return response;
  }) as RequestUrlResponsePromise;
  responsePromise.arrayBuffer = responsePromise.then((response) => response.arrayBuffer);
  responsePromise.json = responsePromise.then((response) => response.json);
  responsePromise.text = responsePromise.then((response) => response.text);
  responsePromise.arrayBuffer.catch(() => undefined);
  responsePromise.json.catch(() => undefined);
  responsePromise.text.catch(() => undefined);
  return responsePromise;
}

export function debounce<T extends unknown[], V>(
  cb: (...args: T) => V,
  timeout = 0,
  resetTimer = false,
): Debouncer<T, V> {
  let timeoutId: number | null = null;
  let timerWindow: Window = getActiveWindow();
  let pendingArgs: T | null = null;
  let pendingThis: unknown = null;
  let delayedUntil = 0;
  let scheduledUntil = 0;
  const call = (): V => {
    const args = pendingArgs as T;
    const context = pendingThis;
    pendingArgs = null;
    pendingThis = null;
    return cb.apply(context, args);
  };
  const flush = (): V | undefined => {
    if (delayedUntil) {
      const now = Date.now();
      if (now < delayedUntil) {
        timerWindow = getActiveWindow();
        timeoutId = timerWindow.setTimeout(flush, delayedUntil - now);
        delayedUntil = 0;
        return undefined;
      }
    }
    scheduledUntil = 0;
    timeoutId = null;
    return call();
  };
  const debounced = function (this: unknown, ...args: T) {
    pendingArgs = args;
    pendingThis = this;
    const now = Date.now();
    const activeWindow = getActiveWindow();
    if (timeoutId !== null) {
      if (resetTimer) delayedUntil = scheduledUntil = now + timeout;
      else if (timerWindow !== activeWindow && scheduledUntil <= now) {
        timerWindow.clearTimeout(timeoutId);
        timerWindow = activeWindow;
        timeoutId = timerWindow.setTimeout(flush, 0);
      }
      return debounced;
    }
    timerWindow = activeWindow;
    scheduledUntil = now + timeout;
    timeoutId = timerWindow.setTimeout(flush, timeout);
    return debounced;
  } as Debouncer<T, V>;
  debounced.cancel = () => {
    if (timeoutId !== null) timerWindow.clearTimeout(timeoutId);
    timeoutId = null;
    pendingArgs = null;
    pendingThis = null;
    return debounced;
  };
  debounced.run = () => {
    if (!pendingArgs) return undefined;
    if (timeoutId !== null) timerWindow.clearTimeout(timeoutId);
    timeoutId = null;
    return call();
  };
  return debounced;
}

export function parseYaml(yaml: string): any {
  return parseYamlSource(yaml);
}

export function stringifyYaml(obj: any): string {
  return stringifyYamlSource(obj, { nullStr: "", lineWidth: 0, aliasDuplicateObjects: false });
}

export function getLanguage(): string {
  const localStorageLanguage =
    typeof localStorage === "undefined" ? null : localStorage.getItem("language");
  if (localStorageLanguage) return localStorageLanguage;
  const navigatorLanguage = typeof navigator === "undefined" ? "" : navigator.language;
  if (SUPPORTED_LANGUAGES.has(navigatorLanguage)) return navigatorLanguage;
  const baseLanguage = navigatorLanguage.split("-")[0];
  return SUPPORTED_LANGUAGES.has(baseLanguage) ? baseLanguage : DEFAULT_LANGUAGE;
}

export function loadMathJax(): Promise<void> {
  return Promise.resolve();
}

export function loadMermaid(): Promise<any> {
  const global = globalThis as {
    mermaid?: {
      initialize?: (config?: unknown) => void;
      render?: (id: string, source: string) => Promise<{ svg: string }> | { svg: string };
    };
  };
  global.mermaid ??= {
    initialize: () => {},
    render: async (_id: string, source: string) => ({
      svg: `<svg data-mermaid-source="${escapeHtmlAttribute(source)}"></svg>`,
    }),
  };
  return Promise.resolve(global.mermaid);
}

export function loadPdfJs(): Promise<any> {
  const global = globalThis as { pdfjsLib?: Record<string, unknown> };
  global.pdfjsLib ??= {};
  return Promise.resolve(global.pdfjsLib);
}

export function loadPrism(): Promise<any> {
  const global = globalThis as {
    Prism?: {
      languages: Record<string, unknown>;
      highlight: (code: string) => string;
      highlightElement: (element: Element) => void;
    };
  };
  global.Prism ??= {
    languages: {},
    highlight: (code) => code,
    highlightElement: () => {},
  };
  return Promise.resolve(global.Prism);
}

export function renderMath(source: string, display: boolean): HTMLElement {
  const el = document.createElement(display ? "div" : "span");
  el.className = display ? "math math-block" : "math math-inline";
  el.textContent = source;
  return el;
}

export function finishRenderMath(): Promise<void> {
  return Promise.resolve();
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = "";
  for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

export function arrayBufferToHex(data: ArrayBuffer): string {
  return Array.from(new Uint8Array(data), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function hexToArrayBuffer(hex: string): ArrayBuffer {
  const length = hex.length / 2;
  const bytes = new Uint8Array(new ArrayBuffer(length));
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.substr(index * 2, 2), 16);
  }
  return bytes.buffer;
}

export function getBlobArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (blob.arrayBuffer) return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => resolve(event.target?.result as ArrayBuffer);
    reader.onabort = reader.onerror = reject;
    reader.readAsArrayBuffer(blob);
  });
}

export function getLinkpath(linktext: string): string {
  const index = linktext.indexOf("#");
  return index === -1 ? linktext : linktext.substring(0, index);
}

export function parseLinktext(linktext: string): { path: string; subpath: string } {
  const index = linktext.indexOf("#");
  return {
    path: index === -1 ? linktext : linktext.substring(0, index),
    subpath: index === -1 ? "" : linktext.substring(index),
  };
}

export function stripHeading(heading: string): string {
  return heading.replace(STRIP_HEADING_RE, " ").replace(/\s+/g, " ").trim();
}

export function stripHeadingForLink(heading: string): string {
  return heading.replace(STRIP_HEADING_FOR_LINK_RE, " ").replace(/\s+/g, " ").trim();
}

export function resolveSubpath(
  cache: CachedMetadata | null | undefined,
  subpath: string | null | undefined,
): HeadingSubpathResult | BlockSubpathResult | FootnoteSubpathResult | null {
  if (!cache || !subpath) return null;
  const parts = subpath.split("#").filter(Boolean);
  if (parts.length === 0) return null;
  if (parts.length === 1) {
    const part = parts[0];
    if (part.startsWith("^")) return resolveBlockSubpath(cache, part.slice(1));
    if (part.startsWith("[^")) return resolveFootnoteSubpath(cache, part.slice(2, -1));
  }
  return resolveHeadingSubpath(cache, parts);
}

// Frontmatter tag/alias readers live in the kernel (metadata/FrontmatterTags);
// re-exported here to keep the public plugin API surface unchanged.
export {
  getAllTags,
  parseFrontMatterAliases,
  parseFrontMatterEntry,
  parseFrontMatterStringArray,
  parseFrontMatterTags,
} from "../metadata/FrontmatterTags";

export function getFrontMatterInfo(content: string): FrontMatterInfo {
  const startMatch = /^---(\r?\n)/g.exec(content);
  if (!startMatch) return { exists: false, frontmatter: "", contentStart: 0, from: 0, to: 0 };
  const from = startMatch[0].length;
  const endPattern = /---(\r?\n|$)/g;
  endPattern.lastIndex = from;
  const endMatch = endPattern.exec(content);
  if (!endMatch) return { exists: false, frontmatter: "", contentStart: 0, from: 0, to: 0 };
  const to = endMatch.index;
  return {
    exists: true,
    frontmatter: content.slice(from, to),
    contentStart: endPattern.lastIndex,
    from,
    to,
  };
}

export function htmlToMarkdown(html: string | HTMLElement | Document | DocumentFragment): string {
  return convertHtmlToMarkdown(htmlToString(html));
}

export function sanitizeHTMLToDom(html: string): DocumentFragment {
  const sanitized = preprocessHtmlDrop(html).html;
  const template = document.createElement("template");
  template.innerHTML = sanitized;
  return template.content;
}

function resolveBlockSubpath(cache: CachedMetadata, rawId: string): BlockSubpathResult | null {
  const id = rawId.toLowerCase();
  const blocks = cache.blocks;
  if (!id || !blocks) return null;
  for (const [key, block] of Object.entries(blocks)) {
    const blockId = block.id || key;
    if (key.toLowerCase() !== id && blockId.toLowerCase() !== id) continue;
    const list = cache.listItems?.find((item) => item.id?.toLowerCase() === id) ?? null;
    return {
      type: "block",
      block,
      list,
      start: getRangeStart(block.position),
      end: getRangeEnd(block.position),
    };
  }
  return null;
}

function resolveFootnoteSubpath(cache: CachedMetadata, id: string): FootnoteSubpathResult | null {
  if (!id) return null;
  const footnote = cache.footnotes?.find((item) => item.id === id);
  return footnote
    ? {
        type: "footnote",
        footnote,
        start: getRangeStart(footnote.position),
        end: getRangeEnd(footnote.position),
      }
    : null;
}

function resolveHeadingSubpath(
  cache: CachedMetadata,
  parts: string[],
): HeadingSubpathResult | null {
  const headings = cache.headings;
  if (!headings?.length) return null;
  let partIndex = 0;
  let currentLevel = 0;
  let current: NonNullable<CachedMetadata["headings"]>[number] | null = null;
  let next: NonNullable<CachedMetadata["headings"]>[number] | null = null;
  for (const heading of headings) {
    if (current && heading.level <= currentLevel) {
      next = heading;
      break;
    }
    if (
      !current &&
      heading.level > currentLevel &&
      stripHeading(heading.heading).toLowerCase() === stripHeading(parts[partIndex]).toLowerCase()
    ) {
      partIndex += 1;
      currentLevel = heading.level;
      if (partIndex === parts.length) current = heading;
    }
  }
  return current
    ? {
        type: "heading",
        current,
        next,
        start: getRangeStart(current.position),
        end: next ? getRangeStart(next.position) : null,
      }
    : null;
}

function getRangeStart(position: unknown): unknown {
  return position && typeof position === "object" && "start" in position
    ? (position as { start?: unknown }).start
    : undefined;
}

function getRangeEnd(position: unknown): unknown {
  return position && typeof position === "object" && "end" in position
    ? (position as { end?: unknown }).end
    : undefined;
}

function htmlToString(html: string | HTMLElement | Document | DocumentFragment): string {
  if (typeof html === "string") return html;
  if (html instanceof Document) return html.body.innerHTML;
  if (html instanceof DocumentFragment) {
    const container = document.createElement("div");
    container.appendChild(html.cloneNode(true));
    return container.innerHTML;
  }
  return html.outerHTML;
}

async function requestUrlViaPlatform(
  request: RequestUrlParam,
  app?: App,
): Promise<RequestUrlResponse> {
  if (app?.shell.bridge.hasHandler("request-url")) {
    const response = await app.shell.bridge.invoke<RequestUrlParam, NativeRequestUrlResponse>({
      channel: "request-url",
      payload: request,
    });
    return normalizeNativeRequestUrlResponse(response);
  }
  return requestUrlViaFetch(request);
}

async function requestUrlViaFetch(request: RequestUrlParam): Promise<RequestUrlResponse> {
  const response = await fetch(request.url, {
    method: request.method,
    headers: request.contentType ? { "Content-Type": request.contentType } : undefined,
    body: request.body,
  });
  const arrayBuffer = await response.arrayBuffer();
  return createRequestUrlResponse(
    response.status,
    Object.fromEntries(response.headers.entries()),
    arrayBuffer,
  );
}

function normalizeNativeRequestUrlResponse(response: NativeRequestUrlResponse): RequestUrlResponse {
  const headers = response.headers ?? {};
  const body = response.arrayBuffer ?? response.body;
  const arrayBuffer = body
    ? normalizeArrayBuffer(body)
    : new TextEncoder().encode(response.text ?? "").buffer;
  return createRequestUrlResponse(response.status, headers, arrayBuffer);
}

function createRequestUrlResponse(
  status: number,
  headers: Record<string, string>,
  arrayBuffer: ArrayBuffer,
): RequestUrlResponse {
  return {
    status,
    headers,
    arrayBuffer,
    get json() {
      return JSON.parse(new TextDecoder().decode(arrayBuffer));
    },
    get text() {
      return new TextDecoder().decode(arrayBuffer);
    },
  };
}

function normalizeArrayBuffer(data: ArrayBuffer | ArrayBufferView): ArrayBuffer {
  const bytes = ArrayBuffer.isView(data)
    ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
    : new Uint8Array(data);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
