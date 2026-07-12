import type { App } from "../../app/App";
import { BrowserSessionBridge, type WebViewerClearDataKind } from "./BrowserSessionBridge";
import {
  WebViewerAddressSuggest,
  type WebViewerAddressSuggestion,
} from "./WebViewerAddressSuggest";
import { WebViewerReader, type WebViewerReaderResult } from "./WebViewerReader";

export interface WebViewerSession {
  id: string;
  name: string;
  partition: string;
  createdAt: string;
  adblockLists: string[];
  cookiesClearedAt?: string;
  cacheClearedAt?: string;
}

export interface WebViewerHistoryEntry {
  id: string;
  url: string;
  title: string;
  visitedAt: string;
  sessionId: string;
}

export interface WebViewerSavedPage {
  url: string;
  title: string;
  savedPath: string;
  savedAt: string;
}

export interface WebViewerSavedAsset {
  url: string;
  savedPath: string;
  savedAt: string;
  kind: "image" | "note";
}

export interface WebViewerOptions {
  openExternalURLs: boolean;
  enableAdblocking: boolean;
  searchEngine: "duckduckgo" | "google";
  markdownPath: string;
}

const HISTORY_STORAGE_KEY = "webviewer-history";

export class WebViewerService {
  private sessions = new Map<string, WebViewerSession>();
  private history: WebViewerHistoryEntry[] = [];
  private historyLoaded = false;
  private activeSessionId = "";
  readonly bridge: BrowserSessionBridge;
  readonly addressSuggest: WebViewerAddressSuggest;
  readonly reader = new WebViewerReader();
  options: WebViewerOptions = {
    openExternalURLs: true,
    enableAdblocking: true,
    searchEngine: "duckduckgo",
    markdownPath: "Web viewer",
  };

  updateOptions(options: Partial<WebViewerOptions>): void {
    this.options = { ...this.options, ...options };
    if ("enableAdblocking" in options) {
      const session = this.getActiveSession();
      this.bridge.createBrowserSession(session.partition, this.options.enableAdblocking);
    }
    this.app.workspace.trigger("webviewer-options-change", this.options);
  }

  constructor(readonly app: App) {
    this.bridge = new BrowserSessionBridge(app);
    this.addressSuggest = new WebViewerAddressSuggest(app);
    const session = this.createBrowserSession({ name: "Default" }, false);
    this.activeSessionId = session.id;
  }

  createBrowserSession(
    options: Partial<Pick<WebViewerSession, "name" | "partition" | "adblockLists">> = {},
    announce = true,
  ): WebViewerSession {
    const id = crypto.randomUUID?.() ?? `session-${Date.now()}`;
    const session: WebViewerSession = {
      id,
      name: options.name ?? "Browser session",
      partition: options.partition ?? this.getWebviewPartition(),
      createdAt: new Date().toISOString(),
      adblockLists: options.adblockLists ?? [],
    };
    this.sessions.set(id, session);
    this.bridge.createBrowserSession(session.partition, this.options.enableAdblocking, announce);
    if (!this.activeSessionId) this.activeSessionId = id;
    if (announce) this.app.workspace.trigger("webviewer-session-create", session);
    return { ...session, adblockLists: [...session.adblockLists] };
  }

  getActiveSession(): WebViewerSession {
    const session =
      this.sessions.get(this.activeSessionId) ??
      this.createBrowserSession({ name: "Default" }, false);
    return { ...session, adblockLists: [...session.adblockLists] };
  }

  setActiveSession(id: string): void {
    if (!this.sessions.has(id)) return;
    this.activeSessionId = id;
    this.app.workspace.trigger("webviewer-session-active", this.getActiveSession());
  }

  listSessions(): readonly WebViewerSession[] {
    return [...this.sessions.values()].map((session) => ({
      ...session,
      adblockLists: [...session.adblockLists],
    }));
  }

  setAdblockLists(sessionId: string, lists: string[]): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.adblockLists = [...new Set(lists.map((item) => item.trim()).filter(Boolean))];
    this.bridge.setAdblockLists(session.partition, session.adblockLists);
    this.app.workspace.trigger("webviewer-adblock-lists-change", {
      ...session,
      adblockLists: [...session.adblockLists],
    });
  }

  clearCookies(sessionId = this.activeSessionId): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.cookiesClearedAt = new Date().toISOString();
    this.bridge.clearData(session.partition, "cookies");
    this.app.workspace.trigger("webviewer-cookies-clear", sessionId);
  }

  clearCache(sessionId = this.activeSessionId): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.cacheClearedAt = new Date().toISOString();
    this.bridge.clearData(session.partition, "cache");
    this.app.workspace.trigger("webviewer-cache-clear", sessionId);
  }

  clearData(kind: WebViewerClearDataKind, sessionId = this.activeSessionId): void {
    if (kind === "history" || kind === "all") this.clearHistory(sessionId);
    if (kind === "cache" || kind === "all") this.clearCache(sessionId);
    if (kind === "cookies" || kind === "all") this.clearCookies(sessionId);
    const session = this.sessions.get(sessionId);
    if (session) this.bridge.clearData(session.partition, kind);
  }

  normalizeUrl(input: string): string {
    const trimmed = input.trim();
    if (!trimmed) return "about:blank";
    if (/^(https?|file|about):/i.test(trimmed)) return trimmed;
    if (/^[\w.-]+\.[a-z]{2,}(?:\/.*)?$/i.test(trimmed)) return `https://${trimmed}`;
    const engine =
      this.options.searchEngine === "google"
        ? "https://www.google.com/search?q="
        : "https://duckduckgo.com/?q=";
    return `${engine}${encodeURIComponent(trimmed)}`;
  }

  // Real Obsidian keeps webviewer history in IndexedDB; vault-local storage is
  // our lighter equivalent — without it the address bar forgets everything on
  // restart and suggests nothing but the Blank seed.
  // ponytail: 1000 small rows in localStorage; move to IndexedDB if it grows.
  private ensureHistoryLoaded(): void {
    if (this.historyLoaded) return;
    this.historyLoaded = true;
    const stored = this.app.loadLocalStorage<WebViewerHistoryEntry[]>(HISTORY_STORAGE_KEY);
    if (Array.isArray(stored)) this.history = stored;
  }

  private saveHistory(): void {
    this.app.saveLocalStorage(HISTORY_STORAGE_KEY, this.history);
  }

  recordHistory(url: string, title = url, sessionId = this.activeSessionId): WebViewerHistoryEntry {
    this.ensureHistoryLoaded();
    if (this.history[0]?.url === url) return { ...this.history[0] };
    const entry: WebViewerHistoryEntry = {
      id: crypto.randomUUID?.() ?? `${Date.now()}`,
      url,
      title,
      visitedAt: new Date().toISOString(),
      sessionId,
    };
    this.history.unshift(entry);
    this.history = this.history.slice(0, 1000);
    this.saveHistory();
    this.app.workspace.trigger("webviewer-history-add", { ...entry });
    return { ...entry };
  }

  listHistory(sessionId?: string): readonly WebViewerHistoryEntry[] {
    this.ensureHistoryLoaded();
    return this.history
      .filter((entry) => !sessionId || entry.sessionId === sessionId)
      .map((entry) => ({ ...entry }));
  }

  removeHistoryEntry(id: string): void {
    this.ensureHistoryLoaded();
    this.history = this.history.filter((entry) => entry.id !== id);
    this.saveHistory();
    this.app.workspace.trigger("webviewer-history-remove", id);
  }

  clearHistory(sessionId?: string): void {
    this.ensureHistoryLoaded();
    this.history = sessionId ? this.history.filter((entry) => entry.sessionId !== sessionId) : [];
    this.saveHistory();
    this.app.workspace.trigger("webviewer-history-clear", sessionId);
  }

  async saveToVault(url: string, title = url, body = ""): Promise<WebViewerSavedPage> {
    const safeTitle =
      title
        .replace(/[\\/:*?"<>|]/g, "-")
        .replace(/\s+/g, " ")
        .trim() || "Web page";
    const prefix = this.options.markdownPath.replace(/\/+$/, "");
    const path = this.app.vault.getAvailablePath(
      prefix ? `${prefix}/${safeTitle}` : safeTitle,
      "md",
    );
    const reader = this.extractReader(url, title, body);
    const content = [
      "---",
      `source: ${JSON.stringify(url)}`,
      `saved: ${new Date().toISOString()}`,
      "tags:",
      "  - webviewer",
      "---",
      "",
      reader.markdown,
    ].join("\n");
    await this.app.vault.create(path, content);
    const saved = { url, title, savedPath: path, savedAt: new Date().toISOString() };
    this.app.workspace.trigger("webviewer-save-to-vault", saved);
    return saved;
  }

  async saveImageToVault(
    url: string,
    filename = imageNameFromUrl(url),
  ): Promise<WebViewerSavedAsset> {
    const extension = extensionFromFilename(filename) || "png";
    try {
      const response = await fetch(url);
      const buffer = await response.arrayBuffer();
      const path = await this.app.vault.getAvailablePathForAttachments(
        filename,
        extension,
        this.app.workspace.getActiveFile(),
      );
      const file = await this.app.vault.createBinary(path, buffer);
      const saved = {
        url,
        savedPath: file.path,
        savedAt: new Date().toISOString(),
        kind: "image" as const,
      };
      this.app.workspace.trigger("webviewer-save-image-to-vault", saved);
      return saved;
    } catch {
      const fallbackPath = this.app.vault.getAvailablePath(
        `Web viewer/${filename.replace(/\.[^.]+$/, "")}`,
        "md",
      );
      const file = await this.app.vault.create(fallbackPath, `![Saved image](${url})\n`);
      const saved = {
        url,
        savedPath: file.path,
        savedAt: new Date().toISOString(),
        kind: "note" as const,
      };
      this.app.workspace.trigger("webviewer-save-image-to-vault", saved);
      return saved;
    }
  }

  getWebviewPartition(): string {
    const appId = (this.app as unknown as { appId?: string }).appId ?? "local";
    return `persist:vault-${appId}`;
  }

  getAddressSuggestions(input: string): WebViewerAddressSuggestion[] {
    return this.addressSuggest.getSuggestions(input);
  }

  extractReader(url: string, title: string, fallbackText = ""): WebViewerReaderResult {
    return this.reader.extract(url, title, fallbackText);
  }
}

function imageNameFromUrl(url: string): string {
  try {
    const name = new URL(url).pathname.split("/").filter(Boolean).pop();
    return name?.includes(".") ? name : "Web image.png";
  } catch {
    return "Web image.png";
  }
}

function extensionFromFilename(filename: string): string {
  return filename.includes(".") ? (filename.split(".").pop()?.replace(/^\./, "") ?? "") : "";
}
