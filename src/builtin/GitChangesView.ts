import { FileDiff } from "@pierre/diffs";
import { ItemView } from "../views/ItemView";
import { openGitDiff } from "../views/DiffView";
import { setIcon } from "../ui/Icon";
import type { GitFileStatus } from "../git/GitService";

const MAX_RENDERED_FILES = 50;

/**
 * The change-set browser: every working-tree change (git status) rendered as
 * a read-only unified diff via @pierre/diffs — out-of-the-box syntax
 * highlighting and hunk layout. Clicking a file header jumps into the
 * editable DiffView review (accept/reject against HEAD). Rendering large
 * multi-file change sets is exactly what @pierre/diffs is built for; the
 * editable single-file review stays on @codemirror/merge.
 */
export class GitChangesView extends ItemView {
  static readonly VIEW_TYPE = "git-changes";
  private listEl: HTMLElement | null = null;
  private diffs: FileDiff[] = [];

  getViewType(): string { return GitChangesView.VIEW_TYPE; }
  getDisplayText(): string { return "Git changes"; }
  getIcon(): string { return "lucide-file-diff"; }

  async onOpen(): Promise<void> {
    this.contentEl.classList.add("git-changes-view");
    this.listEl = this.contentEl.ownerDocument.createElement("div");
    this.listEl.className = "git-changes-list";
    this.contentEl.appendChild(this.listEl);
    this.addAction("lucide-rotate-ccw", "Refresh", () => void this.refresh());
    await this.refresh();
  }

  async onClose(): Promise<void> {
    this.disposeDiffs();
    await super.onClose();
  }

  async refresh(): Promise<void> {
    if (!this.listEl) return;
    this.disposeDiffs();
    this.listEl.replaceChildren();
    if (!this.app.git.isAvailable()) {
      this.renderMessage("Git is not available in this runtime. Open the desktop app inside a git repository.");
      return;
    }
    if (!(await this.app.git.isRepository())) {
      this.renderMessage("This vault is not a git repository.");
      return;
    }
    const status = await this.app.git.status();
    if (status.length === 0) {
      this.renderMessage("Working tree clean — no changes.");
      return;
    }
    const shown = status.slice(0, MAX_RENDERED_FILES);
    for (const entry of shown) await this.renderEntry(entry);
    if (status.length > shown.length) {
      this.renderMessage(`…and ${status.length - shown.length} more changed files.`);
    }
  }

  private async renderEntry(entry: GitFileStatus): Promise<void> {
    if (!this.listEl) return;
    const doc = this.listEl.ownerDocument;
    const sectionEl = doc.createElement("div");
    sectionEl.className = "git-changes-file";

    const headerEl = doc.createElement("div");
    headerEl.className = "git-changes-file-header tappable";
    const iconEl = doc.createElement("span");
    iconEl.className = "git-changes-file-icon";
    setIcon(iconEl, "lucide-file-diff");
    const nameEl = doc.createElement("span");
    nameEl.className = "git-changes-file-name";
    nameEl.textContent = entry.path;
    const statusEl = doc.createElement("span");
    statusEl.className = `git-changes-file-status mod-${statusClass(entry.status)}`;
    statusEl.textContent = statusLabel(entry.status);
    headerEl.append(iconEl, nameEl, statusEl);
    headerEl.addEventListener("click", () => {
      const file = this.app.vault.getFileByPath(entry.path);
      if (file) void openGitDiff(this.app, file);
    });
    sectionEl.appendChild(headerEl);
    // Attach before rendering: the async highlight pass measures the DOM and
    // silently stalls on a disconnected container.
    this.listEl.appendChild(sectionEl);

    const oldContents = (await this.app.git.readHeadFile(entry.path)) ?? "";
    const workingFile = this.app.vault.getFileByPath(entry.path);
    const newContents = entry.status.includes("D") || !workingFile ? "" : await this.app.vault.read(workingFile);
    if (isProbablyBinary(oldContents) || isProbablyBinary(newContents)) {
      const binaryEl = doc.createElement("div");
      binaryEl.className = "git-changes-binary";
      binaryEl.textContent = "Binary file";
      sectionEl.appendChild(binaryEl);
    } else {
      const diffContainer = doc.createElement("div");
      sectionEl.appendChild(diffContainer);
      const diff = new FileDiff({
        diffStyle: "unified",
        themeType: document.body.classList.contains("theme-dark") ? "dark" : "light",
      });
      // containerWrapper (not fileContainer): the library creates its own
      // <diffs-container> custom element inside, whose shadow root carries
      // the core layout stylesheet via adoptedStyleSheets. A plain div
      // renders unstyled.
      diff.render({
        oldFile: { name: entry.path, contents: oldContents },
        newFile: { name: entry.path, contents: newContents },
        containerWrapper: diffContainer,
      });
      this.diffs.push(diff);
    }
  }

  private disposeDiffs(): void {
    for (const diff of this.diffs) diff.cleanUp();
    this.diffs = [];
  }

  private renderMessage(text: string): void {
    if (!this.listEl) return;
    const messageEl = this.listEl.ownerDocument.createElement("div");
    messageEl.className = "git-changes-message";
    messageEl.textContent = text;
    this.listEl.appendChild(messageEl);
  }
}

function isProbablyBinary(contents: string): boolean {
  return contents.includes("\0");
}

function statusLabel(status: string): string {
  if (status.includes("?")) return "untracked";
  if (status.includes("A")) return "added";
  if (status.includes("D")) return "deleted";
  if (status.includes("R")) return "renamed";
  return "modified";
}

function statusClass(status: string): string {
  return statusLabel(status);
}
