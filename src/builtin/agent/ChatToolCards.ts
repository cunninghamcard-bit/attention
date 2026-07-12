import { createDiv, createEl, createSpan } from "../../dom/dom";
import { registerChatToolRenderer } from "./ChatRegistry";
import type { ToolChatPart } from "./Agent";
import { STRINGS } from "./AgentStrings";

// Builtin tool cards: the common coding-agent tools (bash, edit, read, write,
// grep, glob) render a purpose-built card instead of raw JSON input + output.
// This is the biggest visible difference between "a log of tool calls" and an
// agent UI. Registered through the same public seam plugins use, so a plugin
// can override any of these by re-registering the tool name.
//
// Each spec provides a verb + a one-line title pulled from the (streamed) JSON
// input, and a body renderer. The frame (header, status, click-to-expand) is
// shared with the generic renderer's markup so existing CSS carries over.

interface ToolCardSpec {
  verb: string;
  title(input: Record<string, unknown>): string;
  body(part: ToolChatPart, input: Record<string, unknown>, bodyEl: HTMLElement): void;
  // Optional header badge, e.g. the edit card's "+3 −1" diff stat.
  badge?(input: Record<string, unknown>): { add: number; del: number } | null;
}

function parseInput(raw: string): Record<string, unknown> {
  // Partial while streaming -> parse fails -> {}. The title fills in once the
  // input closes; the running status already tells the user work is happening.
  try {
    const value = JSON.parse(raw) as unknown;
    return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function str(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  return typeof value === "string" ? value : "";
}

function basename(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  return trimmed.slice(trimmed.lastIndexOf("/") + 1) || path;
}

function codeBlock(cls: string, text: string, parentEl: HTMLElement): void {
  createEl("pre", { cls, text, parent: parentEl });
}

// Failed executions render their text through the central error block, not
// as a normal output block — the two would otherwise duplicate.
function outputOf(part: ToolChatPart): string | undefined {
  return part.error === undefined ? part.result : undefined;
}

// old_string -> new_string is already the two sides of the edit; showing them
// as a removed block above an added block is the honest diff with no algorithm.
function renderDiff(oldText: string, newText: string, parentEl: HTMLElement): void {
  const diffEl = createDiv("chat-diff", parentEl);
  const side = (text: string, kind: "del" | "add", sign: string) => {
    if (!text) return;
    for (const line of text.split("\n")) {
      const lineEl = createDiv(`chat-diff-line chat-diff-${kind}`, diffEl);
      createSpan({ cls: "chat-diff-sign", text: sign, parent: lineEl });
      createSpan({ cls: "chat-diff-text", text: line, parent: lineEl });
    }
  };
  side(oldText, "del", "-");
  side(newText, "add", "+");
}

const SPECS: Record<string, ToolCardSpec> = {
  bash: {
    verb: "bash",
    title: (input) => str(input, "command").split("\n")[0] ?? "",
    body: (part, input, bodyEl) => {
      const command = str(input, "command");
      if (command) codeBlock("chat-tool-cmd", command, bodyEl);
      const output = outputOf(part);
      if (output !== undefined) codeBlock("chat-tool-output", output, bodyEl);
    },
  },
  edit: {
    verb: "edit",
    title: (input) => basename(str(input, "file_path")),
    badge: (input) => {
      const oldText = str(input, "old_string");
      const newText = str(input, "new_string");
      if (!oldText && !newText) return null;
      return { add: newText ? newText.split("\n").length : 0, del: oldText ? oldText.split("\n").length : 0 };
    },
    body: (_part, input, bodyEl) => {
      renderDiff(str(input, "old_string"), str(input, "new_string"), bodyEl);
    },
  },
  write: {
    verb: "write",
    title: (input) => basename(str(input, "file_path")),
    body: (_part, input, bodyEl) => {
      const content = str(input, "content");
      if (content) codeBlock("chat-tool-output", content, bodyEl);
    },
  },
  read: {
    verb: "read",
    title: (input) => basename(str(input, "file_path")),
    body: (part, _input, bodyEl) => {
      const output = outputOf(part);
      if (output !== undefined) codeBlock("chat-tool-output", output, bodyEl);
    },
  },
  grep: {
    verb: "grep",
    title: (input) => str(input, "pattern"),
    body: (part, input, bodyEl) => {
      const path = str(input, "path");
      if (path) createSpan({ cls: "chat-tool-subtitle", text: path, parent: bodyEl });
      const output = outputOf(part);
      if (output !== undefined) codeBlock("chat-tool-output", output, bodyEl);
    },
  },
  glob: {
    verb: "glob",
    title: (input) => str(input, "pattern"),
    body: (part, _input, bodyEl) => {
      const output = outputOf(part);
      if (output !== undefined) codeBlock("chat-tool-output", output, bodyEl);
    },
  },
};

function renderCard(spec: ToolCardSpec, part: ToolChatPart, el: HTMLElement): void {
  const input = parseInput(part.input);
  const failed = part.error !== undefined;
  el.toggleClass("is-failed", failed);
  const headerEl = createDiv("chat-tool-header", el);
  createSpan({ cls: "chat-tool-verb", text: spec.verb, parent: headerEl });
  const title = spec.title(input);
  if (title) createSpan({ cls: "chat-tool-title", text: title, parent: headerEl });
  const stat = spec.badge?.(input);
  if (stat) {
    const statEl = createSpan({ cls: "chat-tool-diffstat", parent: headerEl });
    createSpan({ cls: "chat-diffstat-add", text: `+${stat.add}`, parent: statEl });
    createSpan({ cls: "chat-diffstat-del", text: `−${stat.del}`, parent: statEl });
  }
  createSpan({
    cls: `chat-tool-status ${failed ? "is-failed" : part.closed ? "is-done" : "is-running"}`,
    text: failed ? STRINGS.tool.failed : part.closed ? (part.result !== undefined ? STRINGS.tool.done : STRINGS.tool.called) : STRINGS.tool.running,
    parent: headerEl,
  });

  const detailsEl = createDiv("chat-tool-details", el);
  spec.body(part, input, detailsEl);
  if (failed) createEl("pre", { cls: "chat-tool-error", text: part.error, parent: detailsEl });

  // A closed part never re-renders (its signature is stable), so local expand
  // state is enough — the DOM and this handler persist. Running parts force
  // open so the streaming call stays in view; failures stay open so the
  // error is never hidden behind a click.
  let expanded = failed;
  detailsEl.toggle(!part.closed || expanded);
  headerEl.addEventListener("click", () => {
    expanded = !expanded;
    detailsEl.toggle(!part.closed || expanded);
  });
}

export function registerBuiltinToolCards(): void {
  for (const [name, spec] of Object.entries(SPECS)) {
    const renderer = { render: (part: ToolChatPart, el: HTMLElement) => renderCard(spec, part, el) };
    // Claude Code emits TitleCase names (Bash), pi emits lowercase (bash).
    registerChatToolRenderer(name, renderer);
    registerChatToolRenderer(name.charAt(0).toUpperCase() + name.slice(1), renderer);
  }
}
