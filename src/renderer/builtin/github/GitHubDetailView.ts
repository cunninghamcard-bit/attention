import { createDiv, createEl, createSpan } from "../../dom/dom";
import { MarkdownRenderer } from "../../markdown/MarkdownRenderer";
import { Notice } from "../../ui/Notice";
import { ItemView } from "../../views/ItemView";
import type { ViewStateResult } from "../../views/View";
import { formatRelativeDate } from "../git/relativeDate";
import { GITHUB_VIEW, type GitHubDetailTarget } from "./open";
import type { ActionRunDetail, GitHubRepositoryRef, IssueDetail, RepoFileContent } from "./types";
import { linkButton, openInSystemBrowser, renderMetaStrip } from "./widgets";

/**
 * Center detail for the light sections — issues, workflow runs and repository
 * files — driven by the left-dock navigator. One leaf type reused across the
 * three, replacing the four bespoke `gh-split-panel`s.
 */
export class GitHubDetailView extends ItemView {
  static readonly VIEW_TYPE = GITHUB_VIEW.detail;

  /** A navigable center destination: `recordHistory` ignores views that do not
   * declare this, so it is required alongside `result.history` for back/forward. */
  navigation = true;

  private target: GitHubDetailTarget | null = null;
  private issueComment = "";
  private request = 0;

  getViewType(): string {
    return GitHubDetailView.VIEW_TYPE;
  }

  getDisplayText(): string {
    const target = this.target;
    if (!target) return "GitHub";
    if (target.kind === "issue") return `Issue #${target.number}`;
    if (target.kind === "run") return `Run #${target.id}`;
    return target.path.split("/").pop() ?? target.path;
  }

  getIcon(): string {
    if (this.target?.kind === "run") return "lucide-play";
    if (this.target?.kind === "file") return "lucide-file";
    return "lucide-circle-dot";
  }

  async onOpen(): Promise<void> {
    this.contentEl.classList.add("github-detail-view");
    if (this.target) await this.loadTarget();
  }

  async setState(state: unknown, result?: ViewStateResult): Promise<void> {
    await super.setState(state, result);
    if (!state || typeof state !== "object" || !("kind" in state)) return;
    const previous = JSON.stringify(this.target ?? null);
    this.target = state as GitHubDetailTarget;
    // Re-targeting this reused detail leaf records history (the FileView
    // pattern), so back returns to the previous issue / run / file.
    if (result && JSON.stringify(this.target) !== previous) result.history = true;
    this.syncSession();
    this.issueComment = "";
    // Synchronous target, asynchronous load — see PrDetailView.setState.
    void this.loadTarget();
    this.leaf.updateHeader();
  }

  /** The session follows what is rendered, from the one entry point that open,
   * back and forward all share. */
  private syncSession(): void {
    const target = this.target;
    if (!target) return;
    if (target.owner && target.repo)
      this.app.github.setRepository({ owner: target.owner, repo: target.repo });
    this.app.github.session.select(
      target.kind === "issue"
        ? {
            kind: "issue",
            owner: target.owner,
            repo: target.repo,
            number: target.number,
          }
        : target.kind === "run"
          ? {
              kind: "run",
              owner: target.owner,
              repo: target.repo,
              id: target.id,
            }
          : {
              kind: "file",
              owner: target.owner,
              repo: target.repo,
              path: target.path,
            },
    );
  }

  /** Manual reload entry (`github:refresh`) — the header has no button. */
  refresh(): void {
    void this.loadTarget();
  }

  getState(): Record<string, unknown> {
    return { ...(this.target ?? {}) };
  }

  async onClose(): Promise<void> {
    this.request += 1;
    await super.onClose();
  }

  private repo(): GitHubRepositoryRef {
    const target = this.target!;
    return { owner: target.owner, repo: target.repo, host: "github.com" };
  }

  private async loadTarget(): Promise<void> {
    const target = this.target;
    if (!target) return;
    const request = ++this.request;
    this.contentEl.empty();
    createDiv({ cls: "github-detail-empty", text: "Loading…" }, this.contentEl);
    try {
      if (target.kind === "issue") {
        const detail = await this.app.github.getIssue(target.number, this.repo());
        if (request !== this.request) return;
        this.renderIssue(detail);
      } else if (target.kind === "run") {
        const detail = await this.app.github.getWorkflowRun(target.id, this.repo());
        if (request !== this.request) return;
        this.renderRun(detail);
      } else {
        const file = await this.app.github.getFileContent(target.path, target.ref, this.repo());
        if (request !== this.request) return;
        this.renderFile(file);
      }
    } catch (error) {
      if (request !== this.request) return;
      this.contentEl.empty();
      createDiv(
        {
          cls: "github-detail-error",
          text: error instanceof Error ? error.message : String(error),
        },
        this.contentEl,
      );
    }
  }

  private renderIssue(detail: IssueDetail): void {
    this.contentEl.empty();
    const scroll = createDiv("gh-detail-scroll", this.contentEl);
    const head = createDiv("gh-detail-head", scroll);
    const titleRow = createDiv("gh-detail-title-row", head);
    createSpan({ cls: `gh-chip mod-${detail.state}`, text: detail.state }, titleRow);
    const title = createEl("h1", { cls: "gh-page-title", text: `${detail.title} ` }, titleRow);
    createSpan({ cls: "gh-muted", text: `#${detail.number}` }, title);
    const meta = createDiv(
      {
        cls: "gh-muted",
        text: `${detail.author.login} opened ${formatRelativeDate(detail.createdAt)} · `,
      },
      head,
    );
    linkButton(meta, "Open on GitHub", () => openInSystemBrowser(detail.url));

    renderMetaStrip(head, {
      labels: detail.labels,
      assignees: detail.assignees,
      milestone: detail.milestone,
    });

    const actions = createDiv("gh-detail-actions", head);
    const toggle = createEl(
      "button",
      {
        cls: "clickable-icon gh-detail-action",
        text: detail.state === "open" ? "Close issue" : "Reopen issue",
        attr: {
          type: "button",
          "aria-label": detail.state === "open" ? "Close issue" : "Reopen issue",
        },
      },
      actions,
    );
    toggle.addEventListener(
      "click",
      () => void this.setIssueState(detail.number, detail.state === "open" ? "closed" : "open"),
    );

    markdown(createEl("article", "gh-card", scroll), detail.body || "*No description*");
    for (const comment of detail.commentsList) {
      const card = createEl("article", "gh-card", scroll);
      const cardMeta = createDiv("gh-card-meta", card);
      createEl("strong", { text: comment.author.login }, cardMeta);
      createSpan({ cls: "gh-muted", text: formatRelativeDate(comment.createdAt) }, cardMeta);
      markdown(card, comment.body);
    }
    const composer = createDiv("gh-composer", scroll);
    const textarea = createEl(
      "textarea",
      { placeholder: "Leave a comment", attr: { rows: 3 } },
      composer,
    );
    textarea.value = this.issueComment;
    const submit = createEl(
      "button",
      { cls: "mod-cta", text: "Comment", attr: { type: "button" } },
      composer,
    );
    submit.disabled = !this.issueComment.trim();
    textarea.addEventListener("input", () => {
      this.issueComment = textarea.value;
      submit.disabled = !this.issueComment.trim();
    });
    submit.addEventListener("click", () => void this.postComment(detail.number));
  }

  private async postComment(number: number): Promise<void> {
    if (!this.issueComment.trim()) return;
    const error = await this.app.github.createIssueComment(
      number,
      this.issueComment.trim(),
      this.repo(),
    );
    if (error) return void new Notice(error);
    this.issueComment = "";
    new Notice("Comment posted");
    await this.loadTarget();
  }

  private async setIssueState(number: number, state: "open" | "closed"): Promise<void> {
    const error = await this.app.github.updateIssueState(number, state, this.repo());
    if (error) return void new Notice(error);
    new Notice(state === "closed" ? "Issue closed" : "Issue reopened");
    await this.loadTarget();
  }

  private renderRun(detail: ActionRunDetail): void {
    this.contentEl.empty();
    const scroll = createDiv("gh-detail-scroll", this.contentEl);
    const head = createDiv("gh-detail-head", scroll);
    createEl("h1", { cls: "gh-page-title", text: detail.displayTitle }, head);
    const meta = createDiv(
      {
        cls: "gh-muted",
        text: `${detail.name} · ${detail.headBranch} @ ${detail.headSha.slice(0, 7)} · `,
      },
      head,
    );
    linkButton(meta, "Open on GitHub", () => openInSystemBrowser(detail.htmlUrl));
    const chips = createDiv("gh-chip-row", head);
    createSpan(
      {
        cls: `gh-chip mod-ci-${conclusionClass(detail.conclusion, detail.status)}`,
        text: detail.conclusion ?? detail.status,
      },
      chips,
    );
    createSpan({ cls: "gh-chip", text: detail.event }, chips);
    createSpan({ cls: "gh-chip", text: `attempt ${detail.attempt}` }, chips);
    for (const job of detail.jobs) {
      const card = createDiv("gh-card", scroll);
      const cardMeta = createDiv("gh-card-meta", card);
      createSpan(`gh-ci-dot mod-${conclusionClass(job.conclusion, job.status)}`, cardMeta);
      createEl("strong", { text: job.name }, cardMeta);
      createSpan({ cls: "gh-muted", text: job.conclusion ?? job.status }, cardMeta);
      const steps = createDiv("gh-steps", card);
      for (const step of job.steps) {
        const row = createDiv("gh-step-row", steps);
        createSpan(`gh-ci-dot mod-${conclusionClass(step.conclusion, step.status)}`, row);
        createSpan({ text: step.name }, row);
        createSpan({ cls: "gh-muted", text: step.conclusion ?? step.status }, row);
      }
      if (!job.steps.length) createDiv({ cls: "gh-muted", text: "No steps" }, steps);
    }
  }

  private renderFile(file: RepoFileContent): void {
    this.contentEl.empty();
    const header = createDiv("gh-preview-header", this.contentEl);
    createEl("code", { text: file.path }, header);
    createSpan({ cls: "gh-muted", text: formatSize(file.size) }, header);
    if (file.htmlUrl) linkButton(header, "Open on GitHub", () => openInSystemBrowser(file.htmlUrl));
    if (file.text == null)
      createDiv(
        {
          cls: "github-detail-empty",
          text: "Binary or large file — open on GitHub to view.",
        },
        this.contentEl,
      );
    else createEl("pre", { cls: "gh-code-pre", text: file.text }, this.contentEl);
  }
}

function markdown(parent: HTMLElement, text: string): void {
  const element = createDiv("markdown-rendered gh-markdown", parent);
  void MarkdownRenderer.renderMarkdown(text, element, "");
}

function conclusionClass(conclusion: string | null, status: string): string {
  const value = (conclusion ?? status).toLowerCase();
  if (value === "success" || value === "completed") return "success";
  if (value === "failure" || value === "timed_out" || value === "action_required") return "failure";
  if (value === "cancelled" || value === "error") return "error";
  if (["pending", "queued", "in_progress", "waiting"].includes(value)) return "pending";
  return "unknown";
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
