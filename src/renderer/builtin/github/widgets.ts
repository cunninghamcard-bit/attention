import { createDiv, createEl, createSpan } from "../../dom/dom";
import type { UserEvent } from "../../app/hotkeys/Keymap";
import { TreeItem } from "../../ui/TreeItem";
import type { GitHubActor, PrLabel } from "./types";

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

/** Shared issue/PR meta strip: labels, assignees, milestone. Data-only — no API. */
export function renderMetaStrip(
  parent: HTMLElement,
  opts: {
    labels?: PrLabel[];
    assignees?: GitHubActor[];
    milestone?: { title: string; url: string } | null;
  },
): HTMLElement | null {
  const labels = opts.labels ?? [];
  const assignees = opts.assignees ?? [];
  const milestone = opts.milestone ?? null;
  if (!labels.length && !assignees.length && !milestone) return null;

  const strip = createDiv("github-meta-strip", parent);

  if (labels.length) {
    const row = createDiv("github-meta-row", strip);
    createSpan({ cls: "github-meta-label", text: "Labels" }, row);
    const chips = createDiv("github-meta-chips", row);
    for (const label of labels) {
      const chip = createSpan({ cls: "github-label-chip", text: label.name }, chips);
      const color = (label.color || "888888").replace(/^#/, "");
      chip.style.setProperty("--github-label-color", `#${color}`);
      if (label.description) chip.title = label.description;
    }
  }

  if (assignees.length) {
    const row = createDiv("github-meta-row", strip);
    createSpan({ cls: "github-meta-label", text: "Assignees" }, row);
    const people = createDiv("github-meta-people", row);
    for (const person of assignees) {
      const item = createDiv("github-meta-person", people);
      avatar(item, person.login, person.avatarUrl, 16);
      createSpan({ cls: "github-meta-person-login", text: person.login }, item);
    }
  }

  if (milestone) {
    const row = createDiv("github-meta-row", strip);
    createSpan({ cls: "github-meta-label", text: "Milestone" }, row);
    if (milestone.url) {
      const url = milestone.url;
      const link = createEl(
        "a",
        {
          cls: "github-meta-milestone",
          text: milestone.title,
          attr: { href: url, rel: "noopener" },
        },
        row,
      );
      // The href is here for hover/a11y only; every external jump on the GitHub
      // surface leaves through openInSystemBrowser, never the anchor default.
      link.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        openInSystemBrowser(url);
      });
    } else {
      createSpan({ cls: "github-meta-milestone", text: milestone.title }, row);
    }
  }

  return strip;
}
