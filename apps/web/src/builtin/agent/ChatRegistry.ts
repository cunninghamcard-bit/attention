import type { Extension } from "@codemirror/state";
import type { Component } from "../../core/Component";
import type { Agent, ChatMessage, ToolChatPart } from "./Agent";

export interface ChatToolRendererContext {
  component: Component;
}

export interface ChatToolRenderer {
  render(part: ToolChatPart, el: HTMLElement, context: ChatToolRendererContext): void;
}

export interface ChatComposerActionContext {
  getValue(): string;
  setValue(value: string): void;
  send(): void;
}

export interface ChatSlashCommand {
  id: string;
  name: string;
  description?: string;
  insertText?: string;
  // "none" (default) runs on selection/submit with no argument;
  // "text" takes the rest of the line: selecting from the menu inserts
  // "/id " and the command runs when the user submits with arguments.
  args?: "none" | "text";
  run?(context: ChatComposerActionContext, args: string): void;
}

export interface ChatComposerAction {
  id: string;
  title: string;
  onClick(context: ChatComposerActionContext): void;
}

export interface ChatMessageActionContext {
  agent: Agent;
}

export interface ChatMessageAction {
  id: string;
  title: string;
  // Omitted = the action applies to every message (e.g. Copy); Retry only
  // makes sense on user messages, so it filters here.
  appliesTo?(message: ChatMessage): boolean;
  run(message: ChatMessage, context: ChatMessageActionContext): void;
}

const toolRenderers = new Map<string, ChatToolRenderer>();
const slashCommands = new Map<string, ChatSlashCommand>();
const composerActions = new Map<string, ChatComposerAction>();
const messageActions = new Map<string, ChatMessageAction>();
const composerExtensions = new Set<Extension>();
const composerExtensionListeners = new Set<() => void>();

// The composer counterpart of registerEditorExtension: plugins contribute
// CodeMirror extensions; live composers reconfigure through the listener.
export function registerChatComposerExtension(extension: Extension): () => void {
  composerExtensions.add(extension);
  for (const listener of composerExtensionListeners) listener();
  return () => {
    composerExtensions.delete(extension);
    for (const listener of composerExtensionListeners) listener();
  };
}

export function listChatComposerExtensions(): Extension[] {
  return [...composerExtensions];
}

export function onChatComposerExtensionsChanged(listener: () => void): () => void {
  composerExtensionListeners.add(listener);
  return () => void composerExtensionListeners.delete(listener);
}

export function registerChatMessageAction(action: ChatMessageAction): () => void {
  messageActions.set(action.id, action);
  return () => void messageActions.delete(action.id);
}

export function listChatMessageActions(): ChatMessageAction[] {
  return [...messageActions.values()];
}

export function registerChatToolRenderer(toolName: string, renderer: ChatToolRenderer): () => void {
  toolRenderers.set(toolName, renderer);
  return () => void toolRenderers.delete(toolName);
}

export function getChatToolRenderer(toolName: string): ChatToolRenderer | null {
  return toolRenderers.get(toolName) ?? null;
}

export function registerChatSlashCommand(command: ChatSlashCommand): () => void {
  slashCommands.set(command.id, command);
  return () => void slashCommands.delete(command.id);
}

export function listChatSlashCommands(): ChatSlashCommand[] {
  return [...slashCommands.values()];
}

export function registerChatComposerAction(action: ChatComposerAction): () => void {
  composerActions.set(action.id, action);
  return () => void composerActions.delete(action.id);
}

export function listChatComposerActions(): ChatComposerAction[] {
  return [...composerActions.values()];
}
