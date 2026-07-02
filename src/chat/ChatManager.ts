import type { App } from "../app/App";
import {
  registerChatComposerAction,
  registerChatComposerExtension,
  registerChatMessageAction,
  registerChatSlashCommand,
  registerChatToolRenderer,
  type ChatComposerAction,
  type ChatMessageAction,
  type ChatSlashCommand,
  type ChatToolRenderer,
} from "./ChatRegistry";
import { ChatSession } from "./ChatSession";
import { ChatTransport } from "./ChatTransport";
import type { Extension } from "@codemirror/state";

// The chat service on App, the seam plugins reach chat through — they hold
// an app reference and nothing chat-related is exported from the obsidian
// module (that surface stays parity-pure). Sits beside metadataCache and
// customCss as an app-level service.
export class ChatManager {
  private readonly sessions = new Map<string, ChatSession>();

  constructor(readonly app: App) {}

  // One session per thread, shared by every leaf showing it.
  getSession(threadId: string): ChatSession {
    let session = this.sessions.get(threadId);
    if (!session) {
      session = new ChatSession(threadId, new ChatTransport());
      session.connect();
      this.sessions.set(threadId, session);
    }
    return session;
  }

  listSessions(): ChatSession[] {
    return [...this.sessions.values()];
  }

  registerToolRenderer(toolName: string, renderer: ChatToolRenderer): () => void {
    return registerChatToolRenderer(toolName, renderer);
  }

  registerSlashCommand(command: ChatSlashCommand): () => void {
    return registerChatSlashCommand(command);
  }

  registerComposerAction(action: ChatComposerAction): () => void {
    return registerChatComposerAction(action);
  }

  registerMessageAction(action: ChatMessageAction): () => void {
    return registerChatMessageAction(action);
  }

  registerComposerExtension(extension: Extension): () => void {
    return registerChatComposerExtension(extension);
  }
}
