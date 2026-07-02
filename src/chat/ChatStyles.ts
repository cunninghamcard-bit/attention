let installed = false;

export function ensureChatStyles(): void {
  if (installed || document.getElementById("obsidian-reconstructed-chat-styles")) {
    installed = true;
    return;
  }
  const styleEl = document.createElement("style");
  styleEl.id = "obsidian-reconstructed-chat-styles";
  styleEl.textContent = `
    .chat-view { display: flex; flex-direction: column; height: 100%; padding: 0; }
    .chat-scroll { flex: 1 1 auto; overflow-y: auto; padding: 16px 24px; position: relative; }
    .chat-message-list { max-width: 760px; margin: 0 auto; display: flex; flex-direction: column; gap: 16px; }
    .chat-message { border-radius: 8px; padding: 10px 14px; }
    .chat-message-user { background: var(--background-secondary, rgba(120, 120, 140, 0.12)); }
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
    .chat-part-text.is-streaming > .is-loading { opacity: 0.75; }
    .chat-part-thinking { opacity: 0.6; font-size: 0.92em; border-left: 2px solid var(--interactive-accent, #7c6ae0); padding-left: 10px; }
    .chat-part-tool { border: 1px solid var(--background-modifier-border, rgba(120,120,140,0.25)); border-radius: 6px; padding: 8px 10px; font-size: 0.9em; }
    .chat-tool-header { display: flex; gap: 8px; align-items: baseline; }
    .chat-tool-name { font-weight: 600; font-family: var(--font-monospace, monospace); }
    .chat-tool-status { font-size: 11px; opacity: 0.6; }
    .chat-tool-status.is-running { color: var(--interactive-accent, #7c6ae0); }
    .chat-tool-input, .chat-tool-result { margin: 6px 0 0; padding: 6px 8px; border-radius: 4px; background: var(--background-primary-alt, rgba(120,120,140,0.08)); overflow-x: auto; max-height: 200px; font-size: 0.85em; }
    .chat-composer { flex: 0 0 auto; border-top: 1px solid var(--background-modifier-border, rgba(120,120,140,0.25)); padding: 12px 24px 16px; position: relative; }
    .chat-composer-row { max-width: 760px; margin: 0 auto; display: flex; gap: 8px; align-items: flex-end; }
    .chat-composer-input { flex: 1 1 auto; resize: vertical; min-height: 44px; max-height: 200px; border-radius: 8px; padding: 10px 12px; font: inherit; }
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
    .chat-view .markdown-rendered pre { overflow-x: auto; }
  `;
  document.head.appendChild(styleEl);
  installed = true;
}
