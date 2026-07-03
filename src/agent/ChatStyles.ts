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
    .chat-scroll { flex: 1 1 auto; overflow-y: auto; padding: 24px 24px 32px; position: relative; }
    .chat-message-list { max-width: 760px; margin: 0 auto; display: flex; flex-direction: column; gap: 22px; }
    .chat-message { border-radius: 10px; padding: 12px 16px; line-height: 1.6; }
    .chat-message-user { background: var(--background-secondary, rgba(120, 120, 140, 0.12)); border: 1px solid var(--background-modifier-border, rgba(120,120,140,0.12)); align-self: flex-end; max-width: 85%; min-width: min(260px, 100%); border-radius: 14px 14px 4px 14px; }
    .chat-message-assistant { padding-left: 0; padding-right: 0; }
    .chat-message-header { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 4px; }
    .chat-message-role { font-size: 11px; font-weight: 600; opacity: 0.55; text-transform: uppercase; letter-spacing: 0.04em; }
    .chat-message[data-author-id] .chat-message-role { color: var(--interactive-accent, #7c6ae0); opacity: 0.8; }
    .chat-message-actions { display: flex; gap: 8px; }
    .chat-message-action { font-size: 11px; opacity: 0; border: none; background: none; cursor: pointer; color: var(--text-muted, #888); }
    .chat-message:hover .chat-message-action { opacity: 0.7; }
    .chat-message-action:hover { opacity: 1; }
    .chat-view .internal-link { color: var(--link-color, #7c6ae0); cursor: pointer; text-decoration: underline; text-decoration-color: rgba(124,106,224,0.35); }
    .chat-empty { text-align: center; padding: 96px 0 24px; opacity: 0.5; }
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
    .chat-tool-timeline:not(.is-running):not(.has-failed) > .chat-tool-timeline-header::before { background: var(--color-green, #4a9d5f); }
    .chat-tool-timeline-summary { opacity: 0.75; }
    .chat-tool-timeline-clip { display: grid; grid-template-rows: 1fr; transition: grid-template-rows 0.22s ease; }
    .chat-tool-timeline.is-collapsed > .chat-tool-timeline-clip { grid-template-rows: 0fr; }
    .chat-tool-timeline-body { display: flex; flex-direction: column; min-height: 0; overflow: hidden; }
    .chat-tool-timeline-body .chat-part-tool { border: none; border-top: 1px solid var(--background-modifier-border, rgba(120,120,140,0.15)); border-radius: 0; position: relative; padding-left: 26px; }
    .chat-tool-timeline-body .chat-part-tool::before { content: ""; position: absolute; left: 12px; top: 14px; width: 6px; height: 6px; border-radius: 50%; background: var(--background-modifier-border, rgba(120,120,140,0.5)); }
    .chat-part-tool { border: 1px solid var(--background-modifier-border, rgba(120,120,140,0.25)); border-radius: 6px; padding: 8px 10px; font-size: 0.9em; }
    .chat-tool-header { display: flex; gap: 8px; align-items: baseline; cursor: pointer; }
    .chat-tool-name { font-weight: 600; font-family: var(--font-monospace, monospace); }
    .chat-tool-status { font-size: 11px; padding: 1px 8px; border-radius: 999px; color: var(--text-muted, #888); background: var(--background-secondary, rgba(120,120,140,0.1)); flex: 0 0 auto; }
    .chat-tool-status.is-running { color: var(--interactive-accent, #7c6ae0); background: rgba(124,106,224,0.12); }
    .chat-tool-input, .chat-tool-result { margin: 6px 0 0; padding: 6px 8px; border-radius: 4px; background: var(--background-primary-alt, rgba(120,120,140,0.08)); overflow-x: auto; max-height: 200px; font-size: 0.85em; }
    .chat-tool-verb { font-weight: 600; font-family: var(--font-monospace, monospace); color: var(--interactive-accent, #7c6ae0); flex: 0 0 auto; }
    .chat-tool-title { font-family: var(--font-monospace, monospace); opacity: 0.85; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1 1 auto; }
    .chat-tool-subtitle { display: block; font-family: var(--font-monospace, monospace); font-size: 0.8em; opacity: 0.6; margin: 6px 0 0; }
    .chat-tool-cmd, .chat-tool-output { margin: 6px 0 0; padding: 6px 8px; border-radius: 4px; overflow-x: auto; max-height: 240px; font-size: 0.85em; font-family: var(--font-monospace, monospace); }
    .chat-tool-cmd { background: var(--background-modifier-border, rgba(120,120,140,0.15)); }
    .chat-tool-cmd::before { content: "$ "; opacity: 0.5; }
    .chat-tool-output { background: var(--background-primary-alt, rgba(120,120,140,0.08)); white-space: pre-wrap; }
    .chat-diff { margin: 6px 0 0; border-radius: 4px; overflow: hidden; font-family: var(--font-monospace, monospace); font-size: 0.85em; }
    .chat-diff-line { display: flex; gap: 6px; padding: 0 8px; white-space: pre-wrap; }
    .chat-diff-sign { flex: 0 0 auto; opacity: 0.6; user-select: none; }
    .chat-diff-del { background: rgba(220, 80, 80, 0.12); }
    .chat-diff-add { background: rgba(80, 180, 100, 0.14); }
    .chat-tool-diffstat { flex: 0 0 auto; font-family: var(--font-monospace, monospace); font-size: 0.8em; display: inline-flex; gap: 4px; }
    .chat-diffstat-add { color: var(--color-green, #4a9d5f); }
    .chat-diffstat-del { color: var(--color-red, #cc4444); }
    .chat-tool-status.is-failed { color: var(--color-red, #cc4444); background: rgba(220,80,80,0.1); }
    .chat-part-tool.is-failed { border-color: rgba(220, 80, 80, 0.45); }
    .chat-tool-error { margin: 6px 0 0; padding: 6px 8px; border-radius: 4px; background: rgba(220, 80, 80, 0.09); color: var(--color-red, #cc4444); overflow-x: auto; max-height: 240px; font-size: 0.85em; font-family: var(--font-monospace, monospace); white-space: pre-wrap; }
    .chat-tool-timeline.has-failed > .chat-tool-timeline-header::before { background: var(--color-red, #cc4444); }
    .chat-run-error { margin: 8px auto; max-width: 760px; padding: 8px 12px; border-radius: 6px; border: 1px solid rgba(220, 80, 80, 0.35); background: rgba(220, 80, 80, 0.07); color: var(--color-red, #cc4444); font-size: 0.85em; }
    .chat-part-thinking { border-left: 2px solid var(--background-modifier-border, rgba(120,120,140,0.3)); padding-left: 12px; }
    .chat-thinking-header { font-size: 0.8em; color: var(--text-muted, #999); cursor: pointer; user-select: none; padding: 2px 0; transition: color 0.12s ease; }
    .chat-thinking-header:hover { color: var(--text-normal, #444); }
    .chat-part-thinking:not(.is-collapsed) > .chat-thinking-header { margin-bottom: 4px; }
    .chat-part-thinking.is-streaming > .chat-thinking-header { animation: chat-shimmer 1.6s ease-in-out infinite; }
    .chat-part-thinking.is-collapsed > .chat-thinking-body { display: none; }
    .chat-thinking-body { font-size: 0.9em; opacity: 0.75; }
    @keyframes chat-shimmer { 0%, 100% { opacity: 0.5; } 50% { opacity: 1; } }
    .chat-message-user.is-collapsible:not(.is-expanded) .chat-message-parts { max-height: 220px; overflow: hidden; -webkit-mask-image: linear-gradient(to bottom, black 70%, transparent); mask-image: linear-gradient(to bottom, black 70%, transparent); }
    .chat-show-more { border: none; background: none; cursor: pointer; color: var(--text-accent, #7c6ae0); font-size: 0.8em; padding: 2px 0; align-self: flex-start; }
    .agent-view-root { max-width: 640px; margin: 0 auto; padding: 24px; display: flex; flex-direction: column; gap: 20px; }
    .agent-view-section-title { font-size: 0.8em; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted, #999); margin-bottom: 6px; }
    .agent-prop { display: flex; gap: 12px; padding: 3px 0; font-size: 0.9em; }
    .agent-prop-label { flex: 0 0 120px; color: var(--text-muted, #999); }
    .agent-prop-value { flex: 1 1 auto; overflow-wrap: anywhere; }
    .agent-view-hint { font-size: 0.85em; color: var(--text-faint, #aaa); font-style: italic; }
    .agent-view-action { align-self: flex-start; cursor: pointer; }
    .agent-view-empty { padding: 24px; color: var(--text-muted, #999); }
    .agent-board-view { overflow-y: auto; }
    .agent-board-header { max-width: 960px; margin: 0 auto; padding: 24px 24px 0; display: flex; align-items: center; justify-content: space-between; }
    .agent-board-title { font-size: 1.4em; font-weight: 600; }
    .agent-board-create { cursor: pointer; }
    .agent-board-grid { max-width: 960px; margin: 0 auto; padding: 16px 24px 24px; display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 12px; }
    .agent-board-empty { grid-column: 1 / -1; padding: 32px 0; text-align: center; color: var(--text-muted, #999); }
    .agent-card { border: 1px solid var(--background-modifier-border, rgba(120,120,140,0.25)); border-radius: 10px; padding: 14px 16px; cursor: pointer; display: flex; flex-direction: column; gap: 8px; transition: border-color 0.12s ease, background 0.12s ease; }
    .agent-card:hover { background: var(--background-primary-alt, rgba(120,120,140,0.05)); border-color: var(--background-modifier-border-hover, rgba(120,120,140,0.45)); box-shadow: 0 3px 14px rgba(0,0,0,0.07); }
    .agent-card-header { display: flex; align-items: center; gap: 8px; min-width: 0; }
    .agent-card-status { width: 8px; height: 8px; border-radius: 50%; background: var(--background-modifier-border, rgba(120,120,140,0.5)); flex: 0 0 auto; }
    .agent-card.is-running .agent-card-status { background: var(--interactive-accent, #7c6ae0); animation: chat-thinking 1.2s ease-in-out infinite; }
    .agent-card-title { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .agent-card-meta { display: flex; gap: 10px; font-size: 0.8em; color: var(--text-muted, #999); }
    .agent-card.is-running .agent-card-state { color: var(--interactive-accent, #7c6ae0); }
    .agent-card-usage { font-size: 0.8em; color: var(--text-faint, #aaa); }
    .agent-card-actions { display: flex; gap: 8px; margin-top: 2px; }
    .agent-card-action { cursor: pointer; font-size: 0.8em; }
    .agent-board-buttons { display: flex; gap: 8px; }
    .multi-agent-participants { flex: 0 0 auto; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 8px 24px; border-bottom: 1px solid var(--background-modifier-border, rgba(120,120,140,0.2)); font-size: 0.85em; }
    .multi-agent-participants-label { color: var(--text-muted, #999); font-size: 0.85em; text-transform: uppercase; letter-spacing: 0.04em; }
    .multi-agent-participants-hint { color: var(--text-faint, #aaa); font-style: italic; }
    .multi-agent-chip { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--background-modifier-border, rgba(120,120,140,0.3)); border-radius: 999px; padding: 2px 10px; }
    .multi-agent-chip-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--interactive-accent, #7c6ae0); }
    .chat-composer { flex: 0 0 auto; border-top: 1px solid var(--background-modifier-border, rgba(120,120,140,0.25)); padding: 12px 24px 16px; position: relative; }
    .chat-composer-row { max-width: 760px; margin: 0 auto; display: flex; gap: 8px; align-items: flex-end; }
    .chat-composer-input { flex: 1 1 auto; min-height: 44px; max-height: 200px; overflow-y: auto; border-radius: 10px; border: 1px solid var(--background-modifier-border, rgba(120,120,140,0.25)); background: var(--background-primary, white); transition: border-color 0.12s ease, box-shadow 0.12s ease; }
    .chat-composer-input:focus-within { border-color: var(--interactive-accent, #7c6ae0); box-shadow: 0 0 0 2px rgba(124,106,224,0.14); }
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
    .chat-composer-send { padding: 8px 18px; border-radius: 10px; cursor: pointer; border: none; background: var(--interactive-accent, #7c6ae0); color: var(--text-on-accent, #fff); font-weight: 500; transition: background 0.12s ease; }
    .chat-composer-send:hover { background: var(--interactive-accent-hover, #6a58d0); }
    .chat-composer-send.is-running { background: var(--background-modifier-error, #c0392b); color: white; }
    .chat-slash-suggest { position: absolute; bottom: 100%; left: 24px; right: 24px; max-width: 760px; margin: 0 auto 4px; border: 1px solid var(--background-modifier-border, rgba(120,120,140,0.25)); border-radius: 8px; background: var(--background-primary, white); box-shadow: 0 4px 18px rgba(0,0,0,0.12); overflow: hidden; z-index: 10; }
    .chat-slash-item { display: flex; gap: 10px; padding: 8px 12px; cursor: pointer; }
    .chat-slash-item.is-selected, .chat-slash-item:hover { background: var(--background-secondary, rgba(120,120,140,0.12)); }
    .chat-slash-name { font-family: var(--font-monospace, monospace); font-size: 0.9em; }
    .chat-slash-desc { opacity: 0.6; font-size: 0.85em; }
    .stream-scroll-bottom { position: sticky; bottom: 8px; left: 100%; width: 34px; height: 34px; border-radius: 50%; border: 1px solid var(--background-modifier-border, rgba(120,120,140,0.3)); background: var(--background-primary, white); color: var(--text-muted, #888); cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,0.15); transition: transform 0.12s ease, color 0.12s ease; }
    .stream-scroll-bottom:hover { transform: translateY(-2px); color: var(--interactive-accent, #7c6ae0); }
    .chat-error { max-width: 760px; margin: 8px auto 0; color: var(--text-error, #c0392b); font-size: 0.85em; }
    .chat-unknown-block { white-space: pre-wrap; }
    .chat-compact-divider { display: flex; align-items: center; gap: 10px; margin: 4px 0; }
    .chat-compact-divider::before, .chat-compact-divider::after { content: ""; flex: 1; border-top: 1px dashed var(--background-modifier-border, rgba(120,120,140,0.35)); }
    .chat-compact-label { font-size: 0.75em; opacity: 0.55; white-space: nowrap; }
    .chat-view .markdown-rendered pre { overflow-x: auto; }
    .chat-view .block-language-mermaid svg { min-height: 60px; max-width: 100%; height: auto; }
`;
