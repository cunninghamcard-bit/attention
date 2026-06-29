import momentFactory from "moment";
import { parse as parseYamlSource, stringify as stringifyYamlSource } from "yaml";
import type { App } from "../app/App";
import { htmlToMarkdown as convertHtmlToMarkdown } from "../markdown/HtmlToMarkdown";
import { preprocessHtmlDrop } from "../markdown/HtmlDropPreprocessor";
import type { CachedMetadata } from "../metadata/MetadataCache";
import { parseLinktext as parseInternalLinktext } from "../metadata/Linkpath";
import { compareVersions } from "../utils/Version";

export const apiVersion = "1.12.7";
export const moment = momentFactory;

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
  arrayBuffer?: ArrayBuffer | ArrayBufferView;
  text?: string;
  json?: any;
}

export interface Debouncer<T extends unknown[], V> {
  (...args: T): Debouncer<T, V>;
  cancel(): Debouncer<T, V>;
  run(): V | void;
}

export type DebouncedFunction<T extends (...args: never[]) => unknown> = Debouncer<Parameters<T>, ReturnType<T>>;

const STRIP_HEADING_RE = /[!"#$%&()*+,.:;<=>?@^`{|}~/\[\]\\\r\n]/g;
const STRIP_HEADING_FOR_LINK_RE = /([:#|^\\\r\n]|%%|\[\[|\]\])/g;

export interface FrontMatterInfo {
  exists: boolean;
  frontmatter: string;
  contentStart: number;
  contentEnd: number;
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
  list?: { id?: string; position?: unknown } | null;
}

export interface FootnoteSubpathResult extends SubpathResult {
  type: "footnote";
  footnote: NonNullable<CachedMetadata["footnotes"]>[number];
}

export function requireApiVersion(version: string): boolean {
  return compareVersions(apiVersion, version) >= 0;
}

export function normalizePath(path: string): string {
  return path
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")
    .split("/")
    .filter((part) => part !== "." && part !== "")
    .join("/");
}

export function request(request: RequestUrlParam | string, app?: App): Promise<string> {
  return requestUrl(request, app).text;
}

export function requestUrl(request: RequestUrlParam | string, app?: App): RequestUrlResponsePromise {
  const rawRequest = typeof request === "string" ? { url: request } : request;
  const headers = { ...(rawRequest.headers ?? {}) };
  if (rawRequest.contentType && !Object.keys(headers).some((key) => key.toLowerCase() === "content-type")) {
    headers["Content-Type"] = rawRequest.contentType;
  }
  const normalizedRequest = { ...rawRequest, headers };
  const responsePromise = requestUrlViaPlatform(normalizedRequest, app).then((response) => {
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

export function debounce<T extends unknown[], V>(cb: (...args: T) => V, timeout = 0, resetTimer = true): Debouncer<T, V> {
  let timeoutId: number | null = null;
  let pendingArgs: T | null = null;
  const debounced = ((...args: T) => {
    if (timeoutId !== null && resetTimer) window.clearTimeout(timeoutId);
    if (timeoutId !== null && !resetTimer) return debounced;
    pendingArgs = args;
    timeoutId = window.setTimeout(() => {
      debounced.run();
    }, timeout);
    return debounced;
  }) as Debouncer<T, V>;
  debounced.cancel = () => {
    if (timeoutId !== null) window.clearTimeout(timeoutId);
    timeoutId = null;
    pendingArgs = null;
    return debounced;
  };
  debounced.run = () => {
    if (!pendingArgs) return undefined;
    if (timeoutId !== null) window.clearTimeout(timeoutId);
    timeoutId = null;
    const args = pendingArgs;
    pendingArgs = null;
    return cb(...args);
  };
  return debounced;
}

export function parseYaml(yaml: string): any {
  return parseYamlSource(yaml);
}

export function stringifyYaml(obj: any): string {
  return stringifyYamlSource(obj);
}

export function getLanguage(): string {
  const localStorageLanguage = typeof localStorage === "undefined" ? null : localStorage.getItem("language");
  const documentLanguage = typeof document === "undefined" ? "" : document.documentElement.lang;
  return localStorageLanguage || documentLanguage || "en";
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
    render: async (_id: string, source: string) => ({ svg: `<svg data-mermaid-source="${escapeHtmlAttribute(source)}"></svg>` }),
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
  const clean = hex.trim();
  const bytes = new Uint8Array(Math.ceil(clean.length / 2));
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(clean.slice(index * 2, index * 2 + 2).padEnd(2, "0"), 16);
  }
  return bytes.buffer;
}

export function getBlobArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  return blob.arrayBuffer();
}

export function getLinkpath(linktext: string): string {
  return parseLinktext(linktext).path;
}

export function parseLinktext(linktext: string): { path: string; subpath: string } {
  const parsed = parseInternalLinktext(linktext);
  return {
    path: parsed.path,
    subpath: parsed.subpath ?? "",
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

export function parseFrontMatterEntry(frontmatter: unknown, key: string | RegExp): unknown | null {
  if (!frontmatter || typeof frontmatter !== "object") return null;
  const entries = Object.entries(frontmatter as Record<string, unknown>);
  const found = typeof key === "string"
    ? entries.find(([entryKey]) => entryKey.toLowerCase() === key.toLowerCase())
    : entries.find(([entryKey]) => key.test(entryKey));
  return found ? found[1] : null;
}

export function parseFrontMatterStringArray(frontmatter: unknown, key: string | RegExp): string[] | null {
  const value = parseFrontMatterEntry(frontmatter, key);
  return coerceStringArray(value);
}

export function parseFrontMatterAliases(frontmatter: unknown): string[] | null {
  return parseFrontMatterStringArray(frontmatter, /^aliases?$/i);
}

export function parseFrontMatterTags(frontmatter: unknown): string[] | null {
  const tags = parseFrontMatterStringArray(frontmatter, /^tags?$/i);
  if (!tags) return null;
  return tags.map((tag) => tag.startsWith("#") ? tag : `#${tag}`).filter((tag) => tag.length > 1);
}

export function getAllTags(cache: CachedMetadata): string[] | null {
  const tags = new Set<string>();
  for (const entry of cache.tags ?? []) tags.add(entry.tag);
  for (const tag of parseFrontMatterTags(cache.frontmatter) ?? []) tags.add(tag);
  return tags.size > 0 ? [...tags].sort() : null;
}

export function getFrontMatterInfo(content: string): FrontMatterInfo {
  const match = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n)?/.exec(content);
  if (!match) return { exists: false, frontmatter: "", contentStart: 0, contentEnd: 0 };
  return {
    exists: true,
    frontmatter: match[1] ?? "",
    contentStart: 0,
    contentEnd: match[0].length,
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
      ...(list ? { list } : {}),
      start: getRangeStart(block.position),
      end: getRangeEnd(block.position),
    };
  }
  return null;
}

function resolveFootnoteSubpath(cache: CachedMetadata, id: string): FootnoteSubpathResult | null {
  if (!id) return null;
  const footnote = cache.footnotes?.find((item) => item.id === id);
  return footnote ? {
    type: "footnote",
    footnote,
    start: getRangeStart(footnote.position),
    end: getRangeEnd(footnote.position),
  } : null;
}

function resolveHeadingSubpath(cache: CachedMetadata, parts: string[]): HeadingSubpathResult | null {
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
      !current
      && heading.level > currentLevel
      && stripHeading(heading.heading).toLowerCase() === stripHeading(parts[partIndex]).toLowerCase()
    ) {
      partIndex += 1;
      currentLevel = heading.level;
      if (partIndex === parts.length) current = heading;
    }
  }
  return current ? {
    type: "heading",
    current,
    next,
    start: getRangeStart(current.position),
    end: next ? getRangeStart(next.position) : null,
  } : null;
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

function coerceStringArray(value: unknown): string[] | null {
  if (typeof value === "string") {
    const text = value.trim();
    return text ? [text] : null;
  }
  if (!Array.isArray(value)) return null;
  const values = value.map((item) => typeof item === "string" ? item.trim() : "").filter(Boolean);
  return values.length > 0 ? values : null;
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

async function requestUrlViaPlatform(request: RequestUrlParam, app?: App): Promise<RequestUrlResponse> {
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
    headers: request.headers,
    body: request.body,
  });
  const arrayBuffer = await response.arrayBuffer();
  const text = new TextDecoder().decode(arrayBuffer);
  return {
    status: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    arrayBuffer,
    json: parseJson(text),
    text,
  };
}

function normalizeNativeRequestUrlResponse(response: NativeRequestUrlResponse): RequestUrlResponse {
  const headers = response.headers ?? {};
  const arrayBuffer = response.arrayBuffer
    ? normalizeArrayBuffer(response.arrayBuffer)
    : new TextEncoder().encode(response.text ?? "").buffer;
  const text = response.text ?? new TextDecoder().decode(arrayBuffer);
  return {
    status: response.status,
    headers,
    arrayBuffer,
    json: Object.prototype.hasOwnProperty.call(response, "json") ? response.json : parseJson(text),
    text,
  };
}

function normalizeArrayBuffer(data: ArrayBuffer | ArrayBufferView): ArrayBuffer {
  if (data instanceof ArrayBuffer) return data;
  const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function parseJson(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
