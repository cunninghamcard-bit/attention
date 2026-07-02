import type { App } from "../app/App";

// Chat is builtin, so in real Obsidian these rules would be compiled into
// app.css. That artifact is frozen here, so the styles ride the managed
// CustomCss channel instead: tagged, deduped by id, and inserted before the
// theme style element so user themes and snippets can override them.
export function ensureChatStyles(app: App): void {
  if (document.head.querySelector('style[data-obsidian-reconstructed-css="builtin:chat"]')) return;
  app.customCss.registerCss("builtin:chat", CHAT_CSS);
}

const CHAT_CSS = `
    .chat-view { display: flex; flex-direction: column; height: 100%; padding: 0; }
    .chat-scroll { flex: 1 1 auto; overflow-y: auto; padding: 16px 24px; position: relative; }
    .chat-message-list { max-width: 760px; margin: 0 auto; display: flex; flex-direction: column; gap: 22px; }
    .chat-message { border-radius: 10px; padding: 12px 16px; line-height: 1.6; }
    .chat-message-user { background: var(--background-secondary, rgba(120, 120, 140, 0.12)); border: 1px solid var(--background-modifier-border, rgba(120,120,140,0.12)); }
    .chat-message-assistant { padding-left: 0; padding-right: 0; }
    .chat-message-header { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 4px; }
    .chat-message-role { font-size: 11px; font-weight: 600; opacity: 0.55; text-transform: uppercase; letter-spacing: 0.04em; }
    .chat-message-actions { display: flex; gap: 8px; }
    .chat-message-action { font-size: 11px; opacity: 0; border: none; background: none; cursor: pointer; color: var(--text-muted, #888); }
    .chat-message:hover .chat-message-action { opacity: 0.7; }
    .chat-message-action:hover { opacity: 1; }
    .chat-view .internal-link { color: var(--link-color, #7c6ae0); cursor: pointer; text-decoration: underline; text-decoration-color: rgba(124,106,224,0.35); }
    .chat-empty { text-align: center; padding: 48px 0 24px; opacity: 0.5; }
    .chat-empty-title { font-size: 1.1em; font-weight: 600; margin-bottom: 6px; }
    .chat-empty-hint { font-size: 0.9em; }
    .chat-thinking-indicator { display: flex; gap: 5px; padding: 8px 14px; }
    .chat-thinking-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--text-muted, #999); animation: chat-thinking 1.2s ease-in-out infinite; }
    .chat-thinking-dot:nth-child(2) { animation-delay: 0.18s; }
    .chat-thinking-dot:nth-child(3) { animation-delay: 0.36s; }
    @keyframes chat-thinking { 0%, 60%, 100% { opacity: 0.25; transform: translateY(0); } 30% { opacity: 1; transform: translateY(-3px); } }
    .chat-message-parts { display: flex; flex-direction: column; gap: 8px; }
    .chat-part-text.is-streaming > .is-loading { opacity: 0.85; }
    .chat-part-text.is-streaming > :last-child::after { content: "▍"; margin-left: 2px; color: var(--interactive-accent, #7c6ae0); animation: chat-caret 1s steps(2) infinite; }
    @keyframes chat-caret { 50% { opacity: 0; } }
    .chat-message { animation: chat-message-in 0.18s ease-out; }
    @keyframes chat-message-in { from { opacity: 0; transform: translateY(4px); } }
    .chat-part-thinking { opacity: 0.6; font-size: 0.92em; border-left: 2px solid var(--interactive-accent, #7c6ae0); padding-left: 10px; }
    .chat-tool-timeline { border: 1px solid var(--background-modifier-border, rgba(120,120,140,0.25)); border-radius: 8px; overflow: hidden; }
    .chat-tool-timeline-header { padding: 7px 12px; font-size: 0.85em; cursor: pointer; display: flex; align-items: center; gap: 8px; background: var(--background-primary-alt, rgba(120,120,140,0.05)); transition: background 0.12s ease; }
    .chat-tool-timeline-header:hover { background: var(--background-modifier-hover, rgba(120,120,140,0.12)); }
    .chat-tool-timeline-header::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: var(--text-muted, #999); flex: 0 0 auto; }
    .chat-tool-timeline.is-running > .chat-tool-timeline-header::before { background: var(--interactive-accent, #7c6ae0); animation: chat-thinking 1.2s ease-in-out infinite; }
    .chat-tool-timeline-summary { opacity: 0.75; }
    .chat-tool-timeline-body { display: flex; flex-direction: column; }
    .chat-tool-timeline.is-collapsed > .chat-tool-timeline-body { display: none; }
    .chat-tool-timeline-body .chat-part-tool { border: none; border-top: 1px solid var(--background-modifier-border, rgba(120,120,140,0.15)); border-radius: 0; position: relative; padding-left: 26px; }
    .chat-tool-timeline-body .chat-part-tool::before { content: ""; position: absolute; left: 12px; top: 14px; width: 6px; height: 6px; border-radius: 50%; background: var(--background-modifier-border, rgba(120,120,140,0.5)); }
    .chat-part-tool { border: 1px solid var(--background-modifier-border, rgba(120,120,140,0.25)); border-radius: 6px; padding: 8px 10px; font-size: 0.9em; }
    .chat-tool-header { display: flex; gap: 8px; align-items: baseline; cursor: pointer; }
    .chat-tool-name { font-weight: 600; font-family: var(--font-monospace, monospace); }
    .chat-tool-status { font-size: 11px; opacity: 0.6; }
    .chat-tool-status.is-running { color: var(--interactive-accent, #7c6ae0); }
    .chat-tool-input, .chat-tool-result { margin: 6px 0 0; padding: 6px 8px; border-radius: 4px; background: var(--background-primary-alt, rgba(120,120,140,0.08)); overflow-x: auto; max-height: 200px; font-size: 0.85em; }
    .chat-composer { flex: 0 0 auto; border-top: 1px solid var(--background-modifier-border, rgba(120,120,140,0.25)); padding: 12px 24px 16px; position: relative; }
    .chat-composer-row { max-width: 760px; margin: 0 auto; display: flex; gap: 8px; align-items: flex-end; }
    .chat-composer-input { flex: 1 1 auto; min-height: 44px; max-height: 200px; overflow-y: auto; border-radius: 8px; border: 1px solid var(--background-modifier-border, rgba(120,120,140,0.25)); background: var(--background-primary, white); }
    .chat-composer-input .cm-editor { outline: none; }
    .chat-composer-input .cm-scroller { font-family: inherit; line-height: 1.5; }
    .chat-composer-input .cm-content { padding: 10px 12px; font: inherit; min-height: 24px; }
    .chat-composer-input .cm-line { padding: 0; }
    .chat-composer-input .cm-placeholder { color: var(--text-muted, #999); white-space: nowrap !important; overflow: hidden; text-overflow: ellipsis; max-width: 100%; display: inline-block; }
    .chat-attachment-bar { max-width: 760px; margin: 0 auto 8px; display: flex; flex-wrap: wrap; gap: 8px; }
    .chat-attachment-card { display: flex; align-items: center; gap: 8px; border: 1px solid var(--background-modifier-border, rgba(120,120,140,0.25)); border-radius: 6px; padding: 6px 10px; font-size: 0.85em; background: var(--background-primary-alt, rgba(120,120,140,0.06)); }
    .chat-attachment-name { font-weight: 600; }
    .chat-attachment-meta { opacity: 0.55; font-size: 0.9em; }
    .chat-attachment-remove { border: none; background: none; cursor: pointer; opacity: 0.5; font-size: 14px; padding: 0 2px; }
    .chat-attachment-remove:hover { opacity: 1; }
    .chat-part-attachment { border: 1px solid var(--background-modifier-border, rgba(120,120,140,0.25)); border-radius: 6px; padding: 8px 10px; font-size: 0.9em; }
    .chat-attachment-header { display: flex; gap: 8px; align-items: baseline; }
    .chat-attachment-content { margin: 6px 0 0; padding: 6px 8px; border-radius: 4px; background: var(--background-primary-alt, rgba(120,120,140,0.08)); overflow: auto; max-height: 160px; font-size: 0.85em; }
    .chat-composer-send { padding: 8px 16px; border-radius: 6px; cursor: pointer; }
    .chat-composer-send.is-running { background: var(--background-modifier-error, #c0392b); color: white; }
    .chat-slash-suggest { position: absolute; bottom: 100%; left: 24px; right: 24px; max-width: 760px; margin: 0 auto 4px; border: 1px solid var(--background-modifier-border, rgba(120,120,140,0.25)); border-radius: 8px; background: var(--background-primary, white); box-shadow: 0 4px 18px rgba(0,0,0,0.12); overflow: hidden; z-index: 10; }
    .chat-slash-item { display: flex; gap: 10px; padding: 8px 12px; cursor: pointer; }
    .chat-slash-item.is-selected, .chat-slash-item:hover { background: var(--background-secondary, rgba(120,120,140,0.12)); }
    .chat-slash-name { font-family: var(--font-monospace, monospace); font-size: 0.9em; }
    .chat-slash-desc { opacity: 0.6; font-size: 0.85em; }
    .chat-scroll-bottom { position: sticky; bottom: 8px; left: 100%; width: 32px; height: 32px; border-radius: 50%; border: 1px solid var(--background-modifier-border, rgba(120,120,140,0.3)); background: var(--background-primary, white); cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,0.15); }
    .chat-error { max-width: 760px; margin: 8px auto 0; color: var(--text-error, #c0392b); font-size: 0.85em; }
    .chat-unknown-block { white-space: pre-wrap; }
    .agents-view { padding: 8px; }
    .agents-list { display: flex; flex-direction: column; gap: 2px; }
    .agents-empty { opacity: 0.5; font-size: 0.9em; padding: 12px 8px; }
    .agent-item { padding: 6px 10px; border-radius: 6px; cursor: pointer; }
    .agent-item:hover { background: var(--background-secondary, rgba(120,120,140,0.12)); }
    .agent-item.is-active { background: var(--background-secondary, rgba(120,120,140,0.18)); }
    .agent-item-title { font-size: 0.92em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: flex; align-items: center; gap: 6px; }
    .agent-item-time { font-size: 0.78em; opacity: 0.5; margin-top: 2px; }
    .agent-item-running { width: 7px; height: 7px; border-radius: 50%; background: var(--interactive-accent, #7c6ae0); flex: 0 0 auto; animation: chat-thinking 1.2s ease-in-out infinite; }
    .chat-compact-divider { display: flex; align-items: center; gap: 10px; margin: 4px 0; }
    .chat-compact-divider::before, .chat-compact-divider::after { content: ""; flex: 1; border-top: 1px dashed var(--background-modifier-border, rgba(120,120,140,0.35)); }
    .chat-compact-label { font-size: 0.75em; opacity: 0.55; white-space: nowrap; }
    .chat-view .markdown-rendered pre { overflow-x: auto; }
    .chat-view .block-language-mermaid svg { min-height: 60px; max-width: 100%; height: auto; }
`;
