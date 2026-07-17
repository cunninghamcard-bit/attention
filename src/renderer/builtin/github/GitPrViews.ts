import { Keymap, type UserEvent } from "../../app/hotkeys/Keymap";
import { createDiv, createEl, createSpan } from "../../dom/dom";
import { MarkdownRenderer } from "../../markdown/MarkdownRenderer";
import { Notice } from "../../ui/Notice";
import { ItemView } from "../../views/ItemView";
import type { ViewStateResult } from "../../views/View";
import { formatRelativeDate } from "../git/relativeDate";
import { ReviewSurface } from "../git/review/ReviewSurface";
import { GITHUB_VIEW, openCommitDetail } from "./open";
import { toReviewFiles } from "./patchUtils";
import type { GitHubRepositoryRef, PrDetail } from "./types";
import { prStateLabel, renderMetaStrip } from "./widgets";

/**
 * Center detail for a single pull request: a header, three in-view tabs
 * (Conversation / Commits / Files changed) and the shared `ReviewSurface` for
 * the diff. No breadcrumb and no "File tree | Full review" sub-toggle — the
 * left nav is the way back, and the review surface is the only diff pane.
 */
export class PrDetailView extends ItemView {
  static readonly VIEW_TYPE = GITHUB_VIEW.prDetail;

  /** A navigable center destination: `recordHistory` ignores views that do not
   * declare this, so it is required alongside `result.history` for back/forward. */
  navigation = true;

  private submitting = false;
  private number: number | null = null;
  private owner: string | null = null;
  private repoName: string | null = null;
  private repo: GitHubRepositoryRef | null = null;
  private detail: PrDetail | null = null;
  private unifiedDiff = "";
  private tab: "conversation" | "commits" | "files" = "files";
  private surface: ReviewSurface | null = null;
  private request = 0;

  getViewType(): string {
    return PrDetailView.VIEW_TYPE;
  }

  getDisplayText(): string {
    if (this.number && this.owner && this.repoName)
      return `${this.owner}/${this.repoName}#${this.number}`;
    return this.number ? `PR #${this.number}` : "Pull request";
  }

  getIcon(): string {
    return "lucide-git-pull-request";
  }

  async onOpen(): Promise<void> {
    this.contentEl.classList.add("git-pr-view");
    // Fire, don't await: holding the leaf open on a network round-trip keeps
    // its `working` latch closed, and setViewState drops re-entrant calls.
    if (this.number !== null) void this.loadDetail();
  }

  async setState(state: unknown, result?: ViewStateResult): Promise<void> {
    await super.setState(state, result);
    if (!state || typeof state !== "object") return;
    const previous = `${this.owner}/${this.repoName}#${this.number}`;
    const next = state as { number?: unknown; owner?: unknown; repo?: unknown };
    if (typeof next.number === "number") this.number = next.number;
    if (typeof next.owner === "string") this.owner = next.owner;
    if (typeof next.repo === "string") this.repoName = next.repo;
    // Re-targeting this reused detail leaf records history (the FileView
    // pattern), so back returns to the previous pull request.
    if (result && `${this.owner}/${this.repoName}#${this.number}` !== previous)
      result.history = true;
    if (this.owner && this.repoName)
      this.app.github.setRepository({ owner: this.owner, repo: this.repoName });
    if (this.number !== null)
      this.app.github.session.select({
        kind: "pr",
        owner: this.owner,
        repo: this.repoName,
        number: this.number,
      });
    // Take the target synchronously and let the load run on its own request
    // token: setViewState drops re-entrant calls while a leaf is working, so
    // awaiting the fetch here would silently lose the user's next click.
    void this.loadDetail();
    this.leaf.updateHeader();
  }

  /** Manual reload entry (`github:refresh`) — the header has no button. */
  refresh(): void {
    void this.loadDetail();
  }

  getState(): Record<string, unknown> {
    return { number: this.number, owner: this.owner, repo: this.repoName };
  }

  async onClose(): Promise<void> {
    this.request += 1;
    this.surface?.destroy();
    this.surface = null;
    await super.onClose();
  }

  private async loadDetail(): Promise<void> {
    if (this.number === null) return;
    const request = ++this.request;
    this.surface?.destroy();
    this.surface = null;
    this.contentEl.empty();
    createDiv({ cls: "git-pr-empty", text: `Loading PR #${this.number}…` }, this.contentEl);
    try {
      const repo =
        this.owner && this.repoName
          ? {
              owner: this.owner,
              repo: this.repoName,
              host: "github.com" as const,
            }
          : await this.app.github.resolveRepository();
      if (!repo) throw new Error("No repository selected");
      const [detail, diff] = await Promise.all([
        this.app.github.getPullRequest(this.number, repo),
        this.app.github.getPullRequestDiff(this.number, repo).catch(() => ""),
      ]);
      if (request !== this.request) return;
      this.repo = repo;
      this.detail = detail;
      this.unifiedDiff = diff;
      this.renderDetail();
    } catch (error) {
      if (request !== this.request) return;
      this.contentEl.empty();
      createDiv({ cls: "git-pr-error", text: errorText(error) }, this.contentEl);
    }
  }

  private renderDetail(): void {
    if (!this.detail || !this.repo || this.number === null) return;
    this.surface?.destroy();
    this.surface = null;
    const detail = this.detail;
    this.contentEl.empty();
    const root = createDiv("git-pr-detail", this.contentEl);
    const header = createEl("header", "git-pr-detail-header", root);
    createEl("h1", { cls: "git-pr-title", text: detail.title }, header);
    const meta = createDiv("git-pr-meta", header);
    // Same chip primitive the issue detail uses.
    const state = prStateLabel(detail.state, detail.isDraft);
    createSpan({ cls: `gh-chip mod-${state}`, text: state }, meta);
    createSpan(
      {
        text: `${detail.author.login} · #${detail.number} · ${detail.headRefName} → ${detail.baseRefName}`,
      },
      meta,
    );
    const stat = createSpan("git-pr-diffstat", meta);
    createEl("ins", { text: `+${detail.additions}` }, stat);
    createEl("del", { text: `−${detail.deletions}` }, stat);
    renderMetaStrip(header, {
      labels: detail.labels,
      assignees: detail.assignees,
      milestone: detail.milestone,
    });
    const tabs = createDiv("github-segmented-control git-pr-tabs", root);
    this.tabButton(tabs, "conversation", "Conversation");
    this.tabButton(tabs, "commits", `Commits ${detail.commits.length}`);
    this.tabButton(tabs, "files", `Files changed ${detail.files.length}`);
    const body = createDiv("git-pr-body", root);
    if (this.tab === "files") this.renderFiles(body, detail);
    else if (this.tab === "conversation") this.renderConversation(body, detail);
    else this.renderCommits(body, detail);
  }

  private tabButton(parent: HTMLElement, tab: typeof this.tab, label: string): void {
    const button = createEl(
      "button",
      {
        cls: `github-segmented-control-item git-pr-tab${this.tab === tab ? " is-active" : ""}`,
        text: label,
        attr: { type: "button" },
      },
      parent,
    );
    button.addEventListener("click", () => {
      this.tab = tab;
      this.renderDetail();
    });
  }

  private renderFiles(parent: HTMLElement, detail: PrDetail): void {
    const host = createDiv("git-pr-review", parent);
    if (!detail.files.length) {
      createDiv({ cls: "git-pr-empty", text: "No files changed." }, host);
      return;
    }
    this.surface = new ReviewSurface(host, {
      files: toReviewFiles(detail.files, this.unifiedDiff, detail.headRefOid),
      storageRoot: null,
      title: `PR #${detail.number}`,
      subtitle: detail.title,
      review: {
        onSubmit: async (event, body, comments) => {
          const error = await this.app.github.submitReview(
            detail.number,
            event,
            body,
            comments,
            this.repo ?? undefined,
          );
          if (!error) void this.loadDetail();
          return error;
        },
      },
      onRefresh: () => void this.loadDetail(),
    });
  }

  private renderConversation(parent: HTMLElement, detail: PrDetail): void {
    const root = createDiv("git-pr-conversation", parent);
    const card = createDiv("git-pr-comment", root);
    const cardMeta = createDiv("git-pr-comment-header", card);
    createEl("strong", { text: detail.author.login }, cardMeta);
    createSpan(
      {
        cls: "git-pr-comment-date",
        text: formatRelativeDate(detail.createdAt),
      },
      cardMeta,
    );
    markdown(card, detail.body || "*No description provided.*");
    const review = createDiv("git-pr-review-bar", root);
    const input = createEl(
      "textarea",
      {
        cls: "git-pr-review-input",
        placeholder: "Leave a comment on this pull request",
        attr: { rows: 3 },
      },
      review,
    );
    const actions = createDiv("git-pr-review-actions", review);
    const comment = button(actions, "Comment", "git-pr-action mod-cta");
    const approve = button(actions, "Approve", "git-pr-action mod-approve");
    const changes = button(actions, "Request changes", "git-pr-action mod-request-changes");
    // A merged pull request has no open/closed toggle left to offer. No new
    // API: GitHub keeps pull requests in the issues namespace, so the issue
    // state PATCH already drives them.
    if (detail.state !== "merged") {
      const open = detail.state === "open";
      const state = button(
        actions,
        open ? "Close pull request" : "Reopen pull request",
        "git-pr-action",
      );
      state.addEventListener(
        "click",
        () =>
          void this.submit(
            () =>
              this.app.github.updateIssueState(
                detail.number,
                open ? "closed" : "open",
                this.repo ?? undefined,
              ),
            open ? "Pull request closed" : "Pull request reopened",
          ),
      );
    }
    comment.disabled = true;
    changes.disabled = true;
    input.addEventListener("input", () => {
      comment.disabled = !input.value.trim();
      changes.disabled = !input.value.trim();
    });
    comment.addEventListener(
      "click",
      () =>
        void this.submit(
          () =>
            this.app.github.createComment(
              detail.number,
              input.value.trim(),
              this.repo ?? undefined,
            ),
          "Comment posted",
        ),
    );
    approve.addEventListener(
      "click",
      () =>
        void this.submit(
          () =>
            this.app.github.submitReview(
              detail.number,
              "APPROVE",
              input.value.trim(),
              [],
              this.repo ?? undefined,
            ),
          "Approved",
        ),
    );
    changes.addEventListener(
      "click",
      () =>
        void this.submit(
          () =>
            this.app.github.submitReview(
              detail.number,
              "REQUEST_CHANGES",
              input.value.trim(),
              [],
              this.repo ?? undefined,
            ),
          "Changes requested",
        ),
    );
  }

  /** Every write on this view goes through here, and each one is a POST that
   * creates something: a comment, a review. A second click while the first is
   * still in flight posts it twice, and GitHub keeps both — so the guard is on
   * the operation, not on the button. Guarding a button only covers the clicks
   * that button knows about; this covers every caller. */
  private async submit(action: () => Promise<string | null>, success: string): Promise<void> {
    if (this.submitting) return;
    this.submitting = true;
    try {
      const error = await action();
      if (error) new Notice(`Failed: ${error}`);
      else {
        new Notice(success);
        await this.loadDetail();
      }
    } finally {
      // finally, not a plain assignment after the await: the service returns
      // its errors today, but a throw would otherwise leave the flag set and
      // the view permanently unable to submit again.
      this.submitting = false;
    }
  }

  private renderCommits(parent: HTMLElement, detail: PrDetail): void {
    const root = createDiv("git-pr-commits", parent);
    if (!detail.commits.length)
      createDiv({ cls: "git-pr-empty", text: "No commits on this pull request." }, root);
    for (const commit of detail.commits) {
      const row = createDiv("git-pr-commit-row is-clickable", root);
      row.setAttribute("role", "button");
      row.tabIndex = 0;
      const main = createDiv("git-pr-commit-main", row);
      createDiv({ cls: "git-pr-commit-headline", text: commit.messageHeadline }, main);
      createDiv(
        {
          cls: "git-pr-commit-sub",
          text: `${commit.author.login} · ${formatRelativeDate(commit.committedDate)}`,
        },
        main,
      );
      createSpan({ cls: "git-pr-commit-sha", text: commit.shortSha }, row);
      const repo = this.repo;
      // Center rows honour cmd/ctrl-activate too — the event has to reach here.
      const activate = (event: UserEvent): void => {
        if (repo)
          void openCommitDetail(
            this.app,
            repo.owner,
            repo.repo,
            commit.sha,
            Keymap.isModEvent(event),
          );
      };
      row.addEventListener("click", activate);
      row.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        activate(event);
      });
    }
  }
}

function markdown(parent: HTMLElement, text: string): void {
  const host = createDiv("markdown-rendered", parent);
  void MarkdownRenderer.renderMarkdown(text, host, "");
}

function button(parent: HTMLElement, text: string, cls: string): HTMLButtonElement {
  return createEl("button", { cls, text, attr: { type: "button" } }, parent);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
