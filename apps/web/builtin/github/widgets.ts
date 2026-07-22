import { createEl, createSpan } from "../../dom/dom";
import type { UserEvent } from "../../app/hotkeys/Keymap";
import { TreeItem } from "../../ui/TreeItem";
import type { PrState } from "./types";

/** A faithful nav-file row (shared by the list and repo center views), keyed
 * for selection sync, with click + keyboard wired via `activate`. */
export interface Row {
  selfEl: HTMLElement;
  innerEl: HTMLElement;
  iconEl: HTMLElement;
  /** The activating event reaches `run` so callers can read `isModEvent` —
   * dropping it here would silently disable cmd/ctrl-activate for every row. */
  activate(run: (event: UserEvent) => void): void;
}

export function treeRow(
  parent: HTMLElement,
  opts: { cls?: string; key?: string; active?: boolean } = {},
): Row {
  const item = new TreeItem(parent, {
    itemClass: `nav-file github-item ${opts.cls ?? ""}`.trim(),
    selfClass: `nav-file-title tappable is-clickable github-row${opts.active ? " is-active" : ""}`,
    innerClass: "nav-file-title-content github-row-main",
    iconClass: "nav-file-icon github-row-icon",
  });
  const { selfEl, innerEl, iconEl } = item;
  if (opts.key) selfEl.dataset.key = opts.key;
  selfEl.setAttribute("role", "button");
  selfEl.tabIndex = 0;
  return {
    selfEl,
    innerEl,
    iconEl,
    activate(run: (event: UserEvent) => void): void {
      item.onSelfClick = (event) => run(event);
      selfEl.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        run(event);
      });
    },
  };
}

/** Hand a URL to the real browser. Electron's shell when we have it, a plain
 * window otherwise. */
export function openInSystemBrowser(url: string): void {
  const shell = (
    globalThis as {
      electron?: { shell?: { openExternal?: (url: string) => Promise<void> } };
    }
  ).electron?.shell;
  if (shell?.openExternal) void shell.openExternal(url);
  else window.open(url, "_blank", "noopener");
}

/** The one place a pull request's state becomes a word. GitHub keeps
 * `draft: true` on a draft closed without merging, so an unconditional draft
 * check reports "draft" for a PR that is actually closed. Draft only outranks
 * open. Accepts an `IssueState` too — that union is a subset. */
export function prStateLabel(state: PrState, isDraft: boolean): string {
  return isDraft && state === "open" ? "draft" : state;
}

/** Text that reads as a link but acts as a button. The click event reaches
 * `action` so callers can read `isModEvent` — dropping it would silently
 * disable cmd/ctrl-activate on the rows that fork a second tab. */
export function linkButton(
  parent: HTMLElement,
  text: string,
  action: (event: MouseEvent) => void,
): void {
  const button = createEl("button", { cls: "gh-linkish", text, attr: { type: "button" } }, parent);
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    action(event);
  });
}

export function avatar(parent: HTMLElement, login: string, url: string, size = 18): void {
  if (url) {
    createEl(
      "img",
      {
        cls: "github-avatar",
        attr: { src: url, alt: "", width: size, height: size },
      },
      parent,
    );
  } else {
    const fallback = createSpan(
      {
        cls: "github-avatar-fallback",
        text: login.slice(0, 1).toUpperCase() || "?",
      },
      parent,
    );
    fallback.style.width = `${size}px`;
    fallback.style.height = `${size}px`;
  }
}

export function conclusionClass(conclusion: string | null, status: string): string {
  const value = (conclusion ?? status).toLowerCase();
  if (value === "success" || value === "completed") return "success";
  if (value === "failure" || value === "timed_out" || value === "action_required") return "failure";
  if (value === "cancelled" || value === "error") return "error";
  if (["pending", "queued", "in_progress", "waiting"].includes(value)) return "pending";
  return "unknown";
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
