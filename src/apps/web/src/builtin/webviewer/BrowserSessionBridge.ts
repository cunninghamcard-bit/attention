import type { App } from "../../app/App";

export type WebViewerClearDataKind = "history" | "cache" | "cookies" | "all";

export interface BrowserSessionState {
  partition: string;
  enableAdblocking: boolean;
  adblockLists: string[];
  createdAt: string;
  userAgent: string;
}

export class BrowserSessionBridge {
  private sessions = new Map<string, BrowserSessionState>();

  constructor(readonly app: App) {}

  createBrowserSession(partition: string, enableAdblocking: boolean, announce = true): BrowserSessionState {
    const existing = this.sessions.get(partition);
    if (existing) {
      existing.enableAdblocking = enableAdblocking;
      if (announce) this.app.workspace.trigger("create-browser-session", { ...existing, adblockLists: [...existing.adblockLists] });
      return this.clone(existing);
    }
    const session: BrowserSessionState = {
      partition,
      enableAdblocking,
      adblockLists: [],
      createdAt: new Date().toISOString(),
      userAgent: navigator.userAgent.replace(/\s*obsidian\/electron\S*/i, ""),
    };
    this.sessions.set(partition, session);
    if (announce) this.app.workspace.trigger("create-browser-session", this.clone(session));
    return this.clone(session);
  }

  setAdblockLists(partition: string, lists: string[]): void {
    const session = this.sessions.get(partition) ?? this.createBrowserSession(partition, true);
    session.adblockLists = [...new Set(lists.map((item) => item.trim()).filter(Boolean))];
    this.app.workspace.trigger("webviewer-adblock-lists", this.clone(session));
  }

  clearData(partition: string, kind: WebViewerClearDataKind): void {
    this.app.workspace.trigger("webviewer-clear-data", { partition, kind, clearedAt: new Date().toISOString() });
  }

  listSessions(): readonly BrowserSessionState[] {
    return [...this.sessions.values()].map((session) => this.clone(session));
  }

  private clone(session: BrowserSessionState): BrowserSessionState {
    return { ...session, adblockLists: [...session.adblockLists] };
  }
}
