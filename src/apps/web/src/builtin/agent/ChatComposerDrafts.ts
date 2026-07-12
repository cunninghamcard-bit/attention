import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const HISTORY_LIMIT = 50;
const HISTORY_KEY = "chat-input-history";

function draftKey(agentId: string): string {
  return `agent-draft:${agentId}`;
}

function storage(): Storage | null {
  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

// Drafts belong to the thread, not the leaf: closing a tab must not eat a
// draft. Leaf ephemeral state keeps only cursor and scroll.
export function readChatDraft(agentId: string): string | null {
  const store = storage();
  const raw = store?.getItem(draftKey(agentId));
  if (!raw) return null;
  try {
    const payload = JSON.parse(raw) as { text?: string; updatedAt?: number };
    if (!payload.text || !payload.updatedAt || Date.now() - payload.updatedAt > DRAFT_TTL_MS) {
      store?.removeItem(draftKey(agentId));
      return null;
    }
    return payload.text;
  } catch {
    store?.removeItem(draftKey(agentId));
    return null;
  }
}

export function writeChatDraft(agentId: string, text: string): void {
  const store = storage();
  if (!text.trim()) {
    store?.removeItem(draftKey(agentId));
    return;
  }
  store?.setItem(draftKey(agentId), JSON.stringify({ text, updatedAt: Date.now() }));
}

export function clearChatDraft(agentId: string): void {
  storage()?.removeItem(draftKey(agentId));
}

export function readChatInputHistory(): string[] {
  const raw = storage()?.getItem(HISTORY_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function appendChatInputHistory(text: string): void {
  const trimmed = text.trim();
  if (!trimmed) return;
  const history = readChatInputHistory().filter((item) => item !== trimmed);
  history.push(trimmed);
  storage()?.setItem(HISTORY_KEY, JSON.stringify(history.slice(-HISTORY_LIMIT)));
}

// Debounced draft persistence riding the editor's update stream.
export function chatDraftPersistence(agentId: string): Extension {
  let timer: number | undefined;
  return EditorView.updateListener.of((update) => {
    if (!update.docChanged) return;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => writeChatDraft(agentId, update.state.doc.toString()), 400);
  });
}
