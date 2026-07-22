import { Keymap, type UserEvent } from "../../app/hotkeys/Keymap";
import { createDiv, createEl, createSpan } from "../../dom/dom";
import { MarkdownRenderer } from "../../markdown/MarkdownRenderer";
import { setIcon } from "../../ui/Icon";
import { Notice } from "../../ui/Notice";
import { setTooltip } from "../../ui/Popover";
import { ItemView } from "../../views/ItemView";
import type { ViewStateResult } from "../../views/View";
import { formatRelativeDate } from "../git/relativeDate";
import { ReviewSurface } from "../git/review/ReviewSurface";
import { GITHUB_VIEW, openCommitDetail } from "./open";
import { toReviewFiles } from "./patchUtils";
import { dockCloudReview } from "./reviewDock";
import type { GitHubActor, GitHubRepositoryRef, PrDetail } from "./types";
import { composer } from "../../ui/Composer";
import { avatar, linkButton, openInSystemBrowser, prStateLabel } from "./widgets";

/**
 * Center detail for a single pull request: a header, three in-view tabs
 * (Conversation / Commits / Files changed) and the shared `ReviewSurface` for
 * the diff. No breadcrumb and no "File tree | Full review" sub-toggle — the
 * left nav is the way back, and the review surface is the only diff pane.
 */
type PrTab = "conversation" | "commits" | "files";

const PR_TABS: { id: PrTab; label: string; icon: string }[] = [
  { id: "conversation", label: "Conversation", icon: "lucide-message-square" },
  { id: "commits", label: "Commits", icon: "lucide-git-commit" },
  { id: "files", label: "Files changed", icon: "lucide-file-diff" },
];

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
  private tab: PrTab = "files";
  private surface: ReviewSurface | null = null;
  private request = 0;
  /** The header's Close/Reopen action — same replace-before-add dance as the
   * issue view, because `addAction` prepends a fresh button every call. */
  private stateAction: HTMLElement | null = null;
  /** The header's tab switcher (the GitHubRepoView pattern): `addAction` only
   * makes single icon buttons, so the segmented control attaches to headerEl. */
  private segmentedEl: HTMLElement | null = null;
  /** Detaches the right-dock tree bridge; runs wherever the surface dies. */
  private dockCleanup: (() => void) | null = null;

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
    this.dockCleanup?.();
    this.dockCleanup = null;
    this.surface?.destroy();
    this.surface = null;
    await super.onClose();
  }

  private async loadDetail(): Promise<void> {
    if (this.number === null) return;
    const request = ++this.request;
    this.dockCleanup?.();
    this.dockCleanup = null;
    this.surface?.destroy();
    this.surface = null;
    this.contentEl.empty();
    // A failed load has no state to toggle: clear first, render puts it back.
    this.setStateAction(null);
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
    this.dockCleanup?.();
    this.dockCleanup = null;
    this.surface?.destroy();
    this.surface = null;
    const detail = this.detail;
    this.contentEl.empty();
    // The issue page's vocabulary, not a parallel one: same head, same title
    // row, same chip — a pull request page is the issue page with tabs. The
    // root keeps the PR view's fixed column (the files tab's review surface
    // sizes against it); only the conversation column scrolls.
    const root = createDiv("git-pr-detail", this.contentEl);
    const head = createDiv("gh-detail-head", root);
    // The OMG header shape: chip and number on a small top row, the title
    // alone on its own line. A number appended inside the h1 wraps onto its
    // own orphan line the moment the title is long (owner's screenshot).
    const titleRow = createDiv("gh-detail-title-row", head);
    const state = prStateLabel(detail.state, detail.isDraft);
    createSpan({ cls: `gh-chip mod-${state}`, text: state }, titleRow);
    createSpan(
      { cls: "gh-muted", text: `${this.repo.owner}/${this.repo.repo} #${detail.number}` },
      titleRow,
    );
    createEl("h1", { cls: "gh-page-title", text: detail.title }, head);
    const meta = createDiv(
      {
        cls: "gh-muted",
        text:
          `${detail.author.login} opened ${formatRelativeDate(detail.createdAt)}` +
          ` · ${detail.headRefName} → ${detail.baseRefName} · `,
      },
      head,
    );
    const stat = createSpan("git-pr-diffstat", meta);
    createEl("ins", { text: `+${detail.additions}` }, stat);
    createEl("del", { text: `−${detail.deletions}` }, stat);
    createSpan({ text: " · " }, meta);
    linkButton(meta, "Open on GitHub", () => openInSystemBrowser(detail.url));
    this.setStateAction(detail);
    this.buildHeaderTabs(detail);
    const body = createDiv("git-pr-body", root);
    if (this.tab === "files") this.renderFiles(body, detail);
    else if (this.tab === "conversation") this.renderConversation(body, detail);
    else this.renderCommits(body, detail);
  }

  /** The tab switcher lives in the tab's real `view-header`, the same icon
   * segmented control GitHubRepoView keeps there — not a pill box drawn into
   * the body. Counts ride in the tooltips, where the labels already are. */
  private buildHeaderTabs(detail: PrDetail): void {
    this.segmentedEl?.remove();
    const nav = createDiv("github-segmented-control github-pr-nav");
    for (const tab of PR_TABS) {
      const count =
        tab.id === "commits"
          ? detail.commits.length
          : tab.id === "files"
            ? detail.files.length
            : null;
      const label = count === null ? tab.label : `${tab.label} · ${count}`;
      const button = createEl(
        "button",
        {
          cls: `clickable-icon github-segmented-control-item${
            this.tab === tab.id ? " is-active" : ""
          }`,
          attr: { type: "button", "aria-label": label },
        },
        nav,
      );
      setIcon(button, tab.icon);
      setTooltip(button, label);
      button.addEventListener("click", () => this.setTab(tab.id));
    }
    this.headerEl.insertBefore(nav, this.actionsEl);
    this.segmentedEl = nav;
  }

  /** Redraw from cached detail without setViewState or refetch. Tab changes do
   * not enter workspace history; that requires the RepoView navigation-target
   * treatment and is intentionally deferred. */
  private setTab(tab: PrTab): void {
    if (this.tab === tab) return;
    this.tab = tab;
    this.renderDetail();
  }

  private renderFiles(parent: HTMLElement, detail: PrDetail): void {
    const host = createDiv("git-pr-review", parent);
    if (!detail.files.length) {
      createDiv({ cls: "git-pr-empty", text: "No files changed." }, host);
      return;
    }
    // Tree in the right dock, diff alone in the center — the git plugin's
    // review arrangement, shared through the same session (owner's call).
    const files = toReviewFiles(detail.files, this.unifiedDiff, detail.headRefOid);
    const session = this.app.git.reviewSession;
    this.surface = new ReviewSurface(host, {
      files,
      storageRoot: null,
      title: `PR #${detail.number}`,
      subtitle: detail.title,
      showFileSidebar: false,
      onActivePathChange: (path) => session.selectPath(path),
      onViewedPathsChange: (paths) => session.publishViewed(paths),
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
    this.dockCleanup = dockCloudReview(this.app, this.surface, files, `PR #${detail.number}`);
  }

  /** Close/Reopen lives in the real view header, exactly where the issue page
   * puts it. A merged pull request has no toggle left to offer. No new API:
   * GitHub keeps pull requests in the issues namespace, so the issue state
   * PATCH already drives them. */
  private setStateAction(detail: PrDetail | null): void {
    this.stateAction?.remove();
    this.stateAction = null;
    if (!detail || detail.state === "merged") return;
    const open = detail.state === "open";
    this.stateAction = this.addAction(
      open ? "lucide-circle-check" : "lucide-circle-dot",
      open ? "Close pull request" : "Reopen pull request",
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

  private renderConversation(parent: HTMLElement, detail: PrDetail): void {
    // The issue page's conversation, on the issue page's layout: cards down the
    // main column, the meta column beside it. The comments and reviews were
    // always in `PrDetail` — this page just never drew them. The scroller and
    // the layout are separate elements: git-pr-conversation is a scrolling
    // column, gh-issue-layout is a row, and one element cannot be both.
    const scroll = createDiv("git-pr-conversation", parent);
    const layout = createDiv("gh-issue-layout", scroll);
    const main = createDiv("gh-issue-main", layout);
    this.renderPrMeta(createEl("aside", "gh-issue-meta", layout), detail);

    const description = createEl("article", "gh-card", main);
    const descriptionMeta = createDiv("gh-card-meta", description);
    createEl("strong", { text: detail.author.login }, descriptionMeta);
    createSpan({ cls: "gh-muted", text: formatRelativeDate(detail.createdAt) }, descriptionMeta);
    markdown(description, detail.body || "*No description provided.*");

    for (const item of conversationItems(detail)) {
      const card = createEl("article", "gh-card", main);
      const cardMeta = createDiv("gh-card-meta", card);
      createEl("strong", { text: item.author.login }, cardMeta);
      if (item.chip)
        createSpan({ cls: `gh-chip mod-${item.chip.cls}`, text: item.chip.text }, cardMeta);
      createSpan({ cls: "gh-muted", text: formatRelativeDate(item.date) }, cardMeta);
      if (item.body) markdown(card, item.body);
    }

    composer(main, {
      placeholder: "Leave a comment on this pull request",
      actions: [
        {
          label: "Comment",
          cls: "mod-cta",
          requireBody: true,
          run: (body) =>
            void this.submit(
              () => this.app.github.createComment(detail.number, body, this.repo ?? undefined),
              "Comment posted",
            ),
        },
        {
          label: "Approve",
          run: (body) =>
            void this.submit(
              () =>
                this.app.github.submitReview(
                  detail.number,
                  "APPROVE",
                  body,
                  [],
                  this.repo ?? undefined,
                ),
              "Approved",
            ),
        },
        {
          label: "Request changes",
          requireBody: true,
          run: (body) =>
            void this.submit(
              () =>
                this.app.github.submitReview(
                  detail.number,
                  "REQUEST_CHANGES",
                  body,
                  [],
                  this.repo ?? undefined,
                ),
              "Changes requested",
            ),
        },
      ],
    });
  }

  /** Reviewers / Assignees / Labels / Milestone — the issue page's meta column
   * with the pull request's own sections. Same classes, same look. */
  private renderPrMeta(parent: HTMLElement, detail: PrDetail): void {
    const section = (label: string): HTMLElement => {
      const block = createDiv("gh-meta-section", parent);
      createDiv({ cls: "gh-meta-heading", text: label }, block);
      return block;
    };
    const person = (parentEl: HTMLElement, actor: GitHubActor): void => {
      const item = createDiv("github-meta-person", parentEl);
      avatar(item, actor.login, actor.avatarUrl, 16);
      createSpan({ cls: "github-meta-person-login", text: actor.login }, item);
    };

    const reviewers = section("Reviewers");
    if (detail.requestedReviewers.length)
      for (const actor of detail.requestedReviewers) person(reviewers, actor);
    else createDiv({ cls: "gh-muted", text: "No reviews requested" }, reviewers);

    const assignees = section("Assignees");
    if (detail.assignees.length) for (const actor of detail.assignees) person(assignees, actor);
    else createDiv({ cls: "gh-muted", text: "No one assigned" }, assignees);

    const labels = section("Labels");
    if (detail.labels.length)
      for (const label of detail.labels) {
        const chip = createSpan({ cls: "github-label-chip", text: label.name }, labels);
        chip.style.setProperty(
          "--github-label-color",
          `#${(label.color || "888888").replace(/^#/, "")}`,
        );
        if (label.description) chip.title = label.description;
      }
    else createDiv({ cls: "gh-muted", text: "None yet" }, labels);

    const milestone = section("Milestone");
    if (detail.milestone) {
      const url = detail.milestone.url;
      if (url) linkButton(milestone, detail.milestone.title, () => openInSystemBrowser(url));
      else createDiv({ text: detail.milestone.title }, milestone);
    } else createDiv({ cls: "gh-muted", text: "No milestone" }, milestone);
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

/** Comments and submitted reviews in one chronological run. Pending reviews
 * and empty COMMENTED shells (the container rows GitHub emits around inline
 * review comments) carry no readable content and are skipped. */
function conversationItems(detail: PrDetail): Array<{
  author: GitHubActor;
  body: string;
  date: string;
  chip: { text: string; cls: string } | null;
}> {
  const chips: Record<string, { text: string; cls: string }> = {
    APPROVED: { text: "approved", cls: "approved" },
    CHANGES_REQUESTED: { text: "requested changes", cls: "changes" },
    DISMISSED: { text: "review dismissed", cls: "dismissed" },
  };
  const items = [
    ...detail.comments.map((comment) => ({
      author: comment.author,
      body: comment.body,
      date: comment.createdAt,
      chip: null,
    })),
    ...detail.reviews
      .filter((review) => review.submittedAt && (review.body.trim() || chips[review.state]))
      .map((review) => ({
        author: review.author,
        body: review.body,
        date: review.submittedAt!,
        chip: chips[review.state] ?? null,
      })),
  ];
  return items.sort((a, b) => a.date.localeCompare(b.date));
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
