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
    .workspace-split.mod-root .view-content.chat-view, .view-content.chat-view, .chat-view { display: flex; flex-direction: column; height: 100%; padding: 0; background: var(--background-secondary, #f5f5f4); font-size: 14px; }
    .chat-body { position: relative; flex: 1 1 auto; min-height: 0; }
    .chat-scroll { position: absolute; inset: 0; overflow-y: auto; padding: 40px 24px calc(var(--chat-dock-h, 120px) + 32px); }
    .chat-view { --chat-motion-fast: 140ms; --chat-motion: 220ms; --chat-ease: cubic-bezier(0.16, 1, 0.3, 1); }
    .chat-message-list { max-width: 800px; margin: 0 auto; display: flex; flex-direction: column; gap: 24px; }
    .chat-message { line-height: 1.6; }
    .chat-message-parts { font-size: 16px; }
    .chat-message-assistant .chat-message-parts { max-width: 680px; }
    .chat-message-user { background: var(--background-primary, #fff); border: 1px solid var(--background-modifier-border, rgba(0,0,0,0.09)); box-shadow: 0 1px 2px rgba(0,0,0,0.04); align-self: flex-end; max-width: min(663px, 85%); border-radius: 12px; padding: 10px 16px; letter-spacing: -0.2px; }
    .chat-message-assistant { padding-left: 0; padding-right: 0; }
    .chat-message-header { margin-bottom: 4px; }
    .chat-message-role { font-size: 11px; font-weight: 600; opacity: 0.55; text-transform: uppercase; letter-spacing: 0.04em; }
    .chat-message[data-author-id] .chat-message-role { color: hsl(var(--author-hue, 255) 50% 52%); opacity: 0.9; }
    .chat-message-actions { display: flex; gap: 6px; margin-top: 2px; }
    .chat-message-user { position: relative; }
    .chat-message-user .chat-message-actions { position: absolute; bottom: -26px; right: 6px; margin: 0; }
    .chat-message-action { font-size: 11px; padding: 3px 6px; border-radius: 7px; opacity: 0; border: none; background: none; cursor: pointer; color: var(--text-muted, #8c8c8a); transition: opacity var(--chat-motion-fast, 140ms) var(--chat-ease, ease), color var(--chat-motion-fast, 140ms) ease; }
    .chat-message:hover .chat-message-action { opacity: 0.6; }
    .chat-message-action:hover { opacity: 1; color: var(--text-normal, #141412); }
    .chat-message-action:hover { opacity: 1; }
    .chat-view .internal-link, .chat-view .markdown-rendered a { color: var(--text-normal, #141412); cursor: pointer; text-decoration: underline; text-decoration-color: rgba(0, 0, 0, 0.22); text-underline-offset: 2px; }
    .chat-view .internal-link:hover, .chat-view .markdown-rendered a:hover { text-decoration-color: rgba(0, 0, 0, 0.45); }
    .theme-dark .chat-view .internal-link, .theme-dark .chat-view .markdown-rendered a { color: var(--text-normal, #faf9f5); text-decoration-color: rgba(255, 255, 255, 0.3); }
    .chat-empty { text-align: center; padding: 22vh 0 24px; }
    .chat-status-dot { width: 7px; height: 7px; border-radius: 50%; flex: 0 0 auto; background: var(--text-muted, #999); }
    .chat-status-dot.is-idle { background: var(--background-modifier-border, rgba(120,120,140,0.5)); }
    .chat-status-dot.is-on { background: var(--interactive-accent, #7c6ae0); }
    .chat-status-dot.is-running { background: var(--interactive-accent, #7c6ae0); animation: chat-thinking 1.2s ease-in-out infinite; }
    .chat-status-dot.is-done { background: var(--color-green, #4a9d5f); }
    .chat-status-dot.is-failed { background: var(--color-red, #cc4444); }
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
    
    .chat-tool-timeline { border: 1px solid var(--background-modifier-border, rgba(0,0,0,0.08)); border-radius: 12px; overflow: hidden; background: var(--background-primary, #fff); box-shadow: 0 1px 2px rgba(0,0,0,0.03); }
    .chat-tool-timeline-header { padding: 8px 14px; font-size: 0.85em; cursor: pointer; display: flex; align-items: center; gap: 8px; transition: background 0.12s ease; }
    .chat-tool-timeline-header:hover { background: var(--background-modifier-hover, rgba(120,120,140,0.12)); }
        .chat-tool-timeline-summary { opacity: 0.75; }
    .chat-tool-timeline-clip { display: grid; grid-template-rows: 1fr; transition: grid-template-rows var(--chat-motion, 220ms) var(--chat-ease, ease); }
    .chat-tool-timeline.is-collapsed > .chat-tool-timeline-clip { grid-template-rows: 0fr; }
    .chat-tool-timeline-body { display: flex; flex-direction: column; min-height: 0; overflow: hidden; }
    .chat-tool-timeline-body .chat-part-tool { border: none; border-top: 1px solid var(--background-modifier-border, rgba(120,120,140,0.15)); border-radius: 0; position: relative; padding-left: 26px; }
    .chat-tool-timeline-body .chat-part-tool::before { content: ""; position: absolute; left: 12px; top: 14px; width: 6px; height: 6px; border-radius: 50%; background: var(--background-modifier-border, rgba(120,120,140,0.5)); }
    .chat-part-tool { border: 1px solid var(--background-modifier-border, rgba(0,0,0,0.08)); border-radius: 10px; padding: 8px 12px; font-size: 0.9em; background: var(--background-primary, #fff); }
    .chat-tool-header { display: flex; gap: 8px; align-items: baseline; cursor: pointer; }
    .chat-tool-name { font-weight: 600; font-family: var(--font-monospace, monospace); }
    .chat-tool-status { font-size: 11px; padding: 1px 8px; border-radius: 999px; color: var(--text-muted, #888); background: var(--background-secondary, rgba(120,120,140,0.1)); flex: 0 0 auto; }
    .chat-tool-status.is-running { color: var(--interactive-accent, #7c6ae0); background: rgba(124,106,224,0.12); }
    .chat-tool-input, .chat-tool-result { margin: 6px 0 0; padding: 6px 8px; border-radius: 4px; background: var(--background-primary-alt, rgba(120,120,140,0.08)); overflow-x: auto; max-height: 200px; font-size: 0.85em; }
    .chat-tool-verb { font-weight: 600; font-family: var(--font-monospace, monospace); color: var(--interactive-accent, #7c6ae0); flex: 0 0 auto; }
    .chat-tool-title { font-family: var(--font-monospace, monospace); opacity: 0.85; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1 1 auto; }
    .chat-tool-subtitle { display: block; font-family: var(--font-monospace, monospace); font-size: 0.8em; opacity: 0.6; margin: 6px 0 0; }
    .chat-tool-cmd, .chat-tool-output { margin: 6px 0 0; padding: 6px 8px; border-radius: 4px; overflow-x: auto; max-height: 240px; font-size: 0.85em; font-family: var(--font-monospace, monospace); }
    .chat-tool-cmd { background: var(--background-secondary, #f6f4f2); }
    .chat-tool-cmd::before { content: "$ "; opacity: 0.5; }
    .chat-tool-output { background: var(--background-secondary, #f6f4f2); white-space: pre-wrap; }
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
    .chat-run-error { margin: 8px auto; max-width: 760px; padding: 8px 12px; border-radius: 10px; border: 1px solid #fecaca; background: #fef2f2; color: #b91c1c; font-size: 0.85em; }
    .theme-dark .chat-run-error { border-color: rgba(127,29,29,0.4); background: rgba(69,10,10,0.3); color: #fca5a5; }
    .chat-part-thinking { background: var(--background-primary, #fff); border: 1px solid var(--background-modifier-border, rgba(0,0,0,0.07)); border-radius: 10px; padding: 8px 12px; }
    .chat-thinking-header { font-size: 0.8em; color: var(--text-muted, #999); cursor: pointer; user-select: none; padding: 2px 0; transition: color 0.12s ease; }
    .chat-thinking-header:hover { color: var(--text-normal, #444); }
    .chat-part-thinking:not(.is-collapsed) > .chat-thinking-header { margin-bottom: 4px; }
    .chat-part-thinking.is-streaming > .chat-thinking-header { animation: chat-shimmer 1.6s ease-in-out infinite; }
    .chat-thinking-clip { display: grid; grid-template-rows: 1fr; transition: grid-template-rows var(--chat-motion, 220ms) var(--chat-ease, ease); }
    .chat-part-thinking.is-collapsed > .chat-thinking-clip { grid-template-rows: 0fr; }
    .chat-thinking-body { min-height: 0; overflow: hidden; }
    .chat-thinking-body { font-size: 0.9em; color: var(--text-muted, #8c8c8a); }
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
    .multi-agent-chip { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--background-modifier-border, rgba(0,0,0,0.09)); border-radius: 999px; padding: 2px 10px; background: var(--background-primary, #fff); transition: border-color 0.15s ease; }
    .multi-agent-chip .chat-status-dot.is-on, .multi-agent-chip .chat-status-dot.is-running { background: hsl(var(--author-hue, 255) 50% 55%); }
    .multi-agent-chip.is-speaking { border-color: hsl(var(--author-hue, 255) 50% 55%); }
    .chat-composer { position: absolute; left: 0; right: 0; bottom: 0; padding: 28px 24px 18px; background: linear-gradient(to bottom, transparent, var(--background-secondary, #f5f5f4) 26px); transition: bottom 320ms cubic-bezier(0.16, 1, 0.3, 1); }
    .chat-view.is-empty .chat-composer { bottom: 52%; background: transparent; }
    .chat-view.is-empty .chat-scroll { display: none; }
    .chat-composer-card { max-width: 760px; margin: 0 auto; border-radius: 20px; border: 1px solid rgba(0, 0, 0, 0.14); background: var(--background-primary, #fff); box-shadow: 0 2px 16px -4px rgba(0,0,0,0.07); transition: border-color 0.2s ease, box-shadow 0.2s ease; padding: 6px 8px 8px; }
    .chat-composer-card:focus-within { border-color: rgba(0, 0, 0, 0.28); box-shadow: 0 2px 6px -1px rgba(0,0,0,0.04); }
    .theme-dark .chat-composer-card { border-color: rgba(255, 255, 255, 0.08); }
    .theme-dark .chat-composer-card:focus-within { border-color: rgba(255, 255, 255, 0.25); }
    .chat-composer-input { min-height: 40px; max-height: 200px; overflow-y: auto; }
    .chat-composer-toolbar { display: flex; align-items: center; justify-content: flex-end; gap: 8px; padding: 0 4px 0 10px; }
    .chat-composer-actions { display: flex; align-items: center; gap: 6px; }
    .chat-composer-input .cm-editor { outline: none; }
    .chat-composer-input .cm-scroller { font-family: inherit; line-height: 1.5; }
    .chat-composer-input .cm-content { padding: 10px 10px 6px; font: inherit; min-height: 24px; }
    .chat-composer-input .cm-line { padding: 0; }
    .chat-composer-input .cm-placeholder { color: var(--text-muted, #999); white-space: nowrap !important; overflow: hidden; text-overflow: ellipsis; max-width: 100%; display: inline-block; }
    .chat-attachment-bar { max-width: 760px; margin: 0 auto 8px; display: flex; flex-wrap: wrap; gap: 8px; }
    .chat-attachment-card { display: flex; align-items: center; gap: 8px; border: 1px solid var(--background-modifier-border, rgba(120,120,140,0.25)); border-radius: 6px; padding: 6px 10px; font-size: 0.85em; background: var(--background-primary-alt, rgba(120,120,140,0.06)); }
    .chat-attachment-name { font-weight: 600; }
    .chat-attachment-meta { opacity: 0.55; font-size: 0.9em; }
    .chat-attachment-remove { border: none; background: none; cursor: pointer; opacity: 0.5; font-size: 14px; padding: 0 2px; }
    .chat-attachment-remove:hover { opacity: 1; }
    .chat-part-attachment { border: 1px solid var(--background-modifier-border, rgba(0,0,0,0.08)); border-radius: 10px; padding: 8px 12px; font-size: 0.9em; background: var(--background-primary, #fff); }
    .chat-attachment-header { display: flex; gap: 8px; align-items: baseline; }
    .chat-attachment-content { margin: 6px 0 0; padding: 6px 8px; border-radius: 4px; background: var(--background-primary-alt, rgba(120,120,140,0.08)); overflow: auto; max-height: 160px; font-size: 0.85em; }
    .chat-composer-send { width: 31.5px; height: 31.5px; padding: 0; border-radius: 8px; cursor: pointer; border: none; background: var(--background-primary, #fff); color: var(--text-normal, #1a1a19); display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; transform: scale(0); opacity: 0; pointer-events: none; transition: transform 281ms cubic-bezier(0.34, 1.56, 0.64, 1), opacity 150ms ease, background-color 60ms ease; }
    .chat-composer-send.is-ready, .chat-composer-send.is-running { transform: scale(1); opacity: 1; pointer-events: auto; }
    .chat-composer-send.is-ready:hover { background: var(--background-modifier-hover, #ebebeb); }
    .chat-composer-send.is-ready:active { transform: scale(0.93); opacity: 0.75; }
    .chat-composer-send.is-running { background: var(--background-primary, #fff); border: 1px solid var(--background-modifier-border, rgba(0,0,0,0.14)); }
    .chat-composer-send.is-running:hover { background: var(--background-secondary, #f6f6f6); }
    .chat-composer-send.is-running:active { transform: scale(0.97); opacity: 0.82; }
    .chat-composer-send svg { width: 17px; height: 17px; }
    .chat-composer-send .chat-stop-glyph { display: none; width: 14px; height: 14px; border-radius: 999px; border: 1.3px solid var(--text-normal, #1a1a19); align-items: center; justify-content: center; flex: 0 0 auto; }
    .chat-composer-send .chat-stop-glyph-square { width: 5px; height: 5px; border-radius: 1px; background: var(--text-normal, #1a1a19); flex: 0 0 auto; }
    .chat-composer-send.is-running svg { display: none; }
    .chat-composer-send.is-running .chat-stop-glyph { display: inline-flex; }
    .chat-composer-send.is-running { background: rgba(220, 80, 80, 0.14); color: var(--color-red, #cc4444); }
    .chat-composer-send.is-running svg { width: 12px; height: 12px; }
    .chat-slash-suggest { position: absolute; bottom: 100%; left: 24px; right: 24px; max-width: 760px; margin: 0 auto 6px; border: 1px solid var(--background-modifier-border, rgba(120,120,140,0.25)); border-radius: 8px; background: var(--background-primary, white); box-shadow: 0 4px 18px rgba(0,0,0,0.12); overflow: hidden; z-index: 10; }
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
    .chat-queued-list { display: flex; flex-direction: column; gap: 8px; align-items: flex-end; }
    .chat-queued { display: flex; align-items: center; gap: 8px; max-width: 85%; align-self: flex-end; border: 1px dashed var(--background-modifier-border, rgba(0,0,0,0.18)); border-radius: 18px 18px 6px 18px; padding: 8px 12px; opacity: 0.6; }
    .chat-queued-label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; opacity: 0.7; flex: 0 0 auto; }
    .chat-queued-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 320px; }
    .chat-queued-cancel { flex: 0 0 auto; border: none; background: none; cursor: pointer; opacity: 0.5; font-size: 14px; line-height: 1; padding: 0 2px; color: var(--text-normal, #1a1a19); }
    .chat-queued-cancel:hover { opacity: 1; }
    .chat-composer-attach-input { display: none; }
    .chat-composer-attach { width: 31.5px; height: 31.5px; padding: 0; border-radius: 8px; cursor: pointer; border: none; background: transparent; color: var(--text-muted, #8c8c8a); display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; transition: background-color 60ms ease, color 60ms ease; }
    .chat-composer-attach:hover { background: var(--background-modifier-hover, rgba(120,120,140,0.12)); color: var(--text-normal, #1a1a19); }
    .chat-composer-attach svg { width: 17px; height: 17px; }
    .chat-composer-card.is-dragging { border-color: rgba(0, 0, 0, 0.32); }
    .theme-dark .chat-composer-card.is-dragging { border-color: rgba(255, 255, 255, 0.35); }
    .chat-author-avatar { width: 18px; height: 18px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 600; color: #fff; background: hsl(var(--author-hue, 255) 45% 55%); flex: 0 0 auto; user-select: none; }
    .chat-message-header { display: flex; align-items: center; gap: 6px; }
    .multi-agent-chip.is-speaking .chat-author-avatar { box-shadow: 0 0 0 2px hsl(var(--author-hue, 255) 50% 55% / 0.35); animation: chat-shimmer 1.6s ease-in-out infinite; }
    .chat-mention { font-weight: 600; background: rgba(0, 0, 0, 0.06); border-radius: 4px; padding: 0 3px; }
    .theme-dark .chat-mention { background: rgba(255, 255, 255, 0.1); }
    .multi-agent-invite { width: 22px; height: 22px; border-radius: 999px; border: 1px dashed var(--background-modifier-border, rgba(0,0,0,0.2)); background: transparent; color: var(--text-muted, #8c8c8a); cursor: pointer; padding: 0; line-height: 1; font-size: 14px; }
    .multi-agent-invite:hover { color: var(--text-normal, #1a1a19); border-color: rgba(0, 0, 0, 0.3); }
    .chat-permission-list { display: flex; flex-direction: column; gap: 8px; }
    .chat-permission { background: var(--background-primary, #fff); border: 1px solid var(--background-modifier-border, rgba(0,0,0,0.08)); border-radius: 12px; box-shadow: 0 1px 2px rgba(0,0,0,0.03); padding: 10px 14px; font-size: 0.9em; }
    .chat-permission-title { font-weight: 600; margin-bottom: 4px; }
    .chat-permission-tool { font-family: var(--font-monospace, monospace); opacity: 0.8; }
    .chat-permission-input { margin: 6px 0 0; padding: 6px 8px; border-radius: 4px; background: var(--background-primary-alt, rgba(120,120,140,0.08)); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-height: 60px; font-size: 0.85em; }
    .chat-permission-actions { display: flex; gap: 8px; margin-top: 8px; }
    .chat-permission-allow { border: none; border-radius: 8px; padding: 5px 14px; cursor: pointer; background: var(--text-normal, #1a1a19); color: var(--background-primary, #fff); font-size: 0.9em; transition: transform 60ms ease, opacity 60ms ease; }
    .chat-permission-allow:active { transform: scale(0.93); opacity: 0.85; }
    .chat-permission-deny { border: 1px solid transparent; border-radius: 8px; padding: 5px 14px; cursor: pointer; background: none; color: var(--text-muted, #8c8c8a); font-size: 0.9em; transition: color 60ms ease, background-color 60ms ease; }
    .chat-permission-deny:hover { color: var(--color-red, #cc4444); background: rgba(220,80,80,0.08); }
    .chat-permission.is-resolved { padding: 4px 14px; box-shadow: none; opacity: 0.55; font-size: 0.85em; align-self: flex-start; }
    .agent-prop-input { flex: 1 1 auto; max-width: 260px; padding: 4px 8px; border-radius: 6px; border: 1px solid var(--background-modifier-border, rgba(0,0,0,0.12)); background: var(--background-primary, #fff); font-size: 0.9em; color: var(--text-normal, #1a1a19); }
    .agent-prop-input:focus { outline: none; border-color: rgba(0, 0, 0, 0.3); }
    .agent-params { display: flex; flex-direction: column; gap: 6px; padding: 3px 0; }
    .agent-param-row { display: flex; gap: 6px; align-items: center; }
    .agent-param-key { flex: 0 0 120px; }
    .agent-param-key, .agent-param-value { padding: 4px 8px; border-radius: 6px; border: 1px solid var(--background-modifier-border, rgba(0,0,0,0.12)); background: var(--background-primary, #fff); font-size: 0.85em; font-family: var(--font-monospace, monospace); }
    .agent-param-value { flex: 1 1 auto; max-width: 200px; }
    .agent-param-remove { border: none; background: none; cursor: pointer; opacity: 0.45; font-size: 14px; padding: 0 4px; }
    .agent-param-remove:hover { opacity: 1; }
    .agent-param-add { align-self: flex-start; border: 1px dashed var(--background-modifier-border, rgba(0,0,0,0.2)); background: transparent; border-radius: 6px; padding: 3px 10px; cursor: pointer; font-size: 0.8em; color: var(--text-muted, #8c8c8a); }
    .agent-param-add:hover { color: var(--text-normal, #1a1a19); border-color: rgba(0, 0, 0, 0.3); }
    .chat-view .markdown-rendered p { margin: 0 0 0.5em; letter-spacing: 0.01px; }
    .chat-view .markdown-rendered p:last-child { margin-bottom: 0; }
    .chat-view .markdown-rendered h1 { font-size: 1.25em; font-weight: 600; line-height: 1.35; margin: 1.5em 0 0.5em; letter-spacing: -0.3px; }
    .chat-view .markdown-rendered h2 { font-size: 1.2em; font-weight: 600; line-height: 1.35; margin: 1.4em 0 0.5em; letter-spacing: -0.2px; }
    .chat-view .markdown-rendered h3 { font-size: 1.05em; font-weight: 600; line-height: 1.4; margin: 1.2em 0 0.4em; }
    .chat-view .markdown-rendered h4, .chat-view .markdown-rendered h5, .chat-view .markdown-rendered h6 { font-size: 1em; font-weight: 600; line-height: 1.4; margin: 1em 0 0.4em; }
    .chat-view .markdown-rendered h1:first-child, .chat-view .markdown-rendered h2:first-child, .chat-view .markdown-rendered h3:first-child { margin-top: 0; }
    .chat-view .markdown-rendered ul, .chat-view .markdown-rendered ol { margin: 0 0 1em; padding-left: 2em; }
    .chat-view .markdown-rendered li { margin-bottom: 0.3em; }
    .chat-view .markdown-rendered pre { background: var(--background-primary, #fff); border: 1px solid var(--background-modifier-border, rgba(0,0,0,0.08)); border-radius: 10px; padding: 14px 16px; font-size: 13.5px; line-height: 1.65; margin: 0.6em 0 1em; overflow-x: auto; }
    .chat-view .markdown-rendered :not(pre) > code { background: rgba(0, 0, 0, 0.05); border: 1px solid rgba(0, 0, 0, 0.06); border-radius: 6px; padding: 1px 5px; font-size: 0.875em; color: #7f2c29; }
    .theme-dark .chat-view .markdown-rendered :not(pre) > code { background: rgba(255, 255, 255, 0.07); border-color: rgba(255, 255, 255, 0.08); color: #ed8784; }
    .chat-view .markdown-rendered table { border-collapse: separate; border-spacing: 0; border: 1px solid var(--background-modifier-border, rgba(0,0,0,0.1)); border-radius: 10px; margin: 0.6em 0 1em; font-size: 15px; overflow: hidden; }
    .chat-view .markdown-rendered th { font-size: 14px; font-weight: 600; color: var(--text-muted, #555); background: var(--background-secondary, #f8f7f6); white-space: nowrap; text-align: left; }
    .chat-view .markdown-rendered th, .chat-view .markdown-rendered td { padding: 8px 12px; border-right: 1px solid var(--background-modifier-border, rgba(0,0,0,0.07)); border-bottom: 1px solid var(--background-modifier-border, rgba(0,0,0,0.07)); }
    .chat-view .markdown-rendered tr > :last-child { border-right: none; }
    .chat-view .markdown-rendered tr:last-child > td { border-bottom: none; }
    .chat-view .markdown-rendered th:first-child { border-top-left-radius: 10px; }
    .chat-view .markdown-rendered th:last-child { border-top-right-radius: 10px; }
    .chat-view .markdown-rendered blockquote { border-left: 3px solid var(--background-modifier-border, #e4e3df); padding-left: 1em; margin: 1em 0; color: var(--text-muted, #666); font-style: italic; }
    .chat-view .markdown-rendered hr { border: none; border-top: 1px solid var(--background-modifier-border, rgba(0,0,0,0.09)); margin: 1.5em 0; }
    .chat-view .markdown-rendered strong { font-weight: 600; color: var(--text-normal, #141412); }
    .chat-view .markdown-rendered em { color: var(--text-muted, #555); }
    .chat-view .markdown-rendered p:has(+ h1), .chat-view .markdown-rendered p:has(+ h2), .chat-view .markdown-rendered p:has(+ h3) { margin-bottom: 0.3em; }
    .chat-view .markdown-rendered p + h1 { margin-top: 0.65em; }
    .chat-view .markdown-rendered p + h2, .chat-view .markdown-rendered p + h3 { margin-top: 0.55em; }
    .chat-model-chip { display: inline-flex; align-items: center; gap: 3px; height: 28px; padding: 0 8px 0 10px; border: none; border-radius: 8px; background: transparent; color: var(--text-muted, #8c8c8a); font-size: 13px; cursor: pointer; max-width: 260px; overflow: hidden; white-space: nowrap; margin-right: auto; transition: background-color 120ms ease, color 120ms ease; }
    .chat-model-chip:hover { background: var(--background-modifier-hover, rgba(120,120,140,0.1)); color: var(--text-normal, #1a1a19); }
    .chat-model-chip-label { overflow: hidden; text-overflow: ellipsis; }
    .chat-model-chip-chevron svg { width: 14px; height: 14px; opacity: 0.6; display: block; }
    .chat-message-provenance { font-size: 11px; color: var(--text-faint, #b0b0b8); margin-right: 4px; align-self: center; }
    .chat-compact-divider.is-running .chat-compact-label { animation: chat-shimmer 1.6s ease-in-out infinite; }
    .chat-compact-divider.is-failed .chat-compact-label { color: #b91c1c; opacity: 1; }
    .agent-prop-stepper { display: inline-flex; align-items: center; gap: 4px; }
    .agent-prop-stepper button { width: 22px; height: 22px; border-radius: 6px; border: 1px solid var(--background-modifier-border, rgba(0,0,0,0.12)); background: var(--background-primary, #fff); cursor: pointer; padding: 0; line-height: 1; color: var(--text-muted, #666); }
    .agent-prop-stepper button:hover { color: var(--text-normal, #1a1a19); }
    .agent-prop-stepper .agent-prop-input { max-width: 84px; text-align: center; }
`;
