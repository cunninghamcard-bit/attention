import { FileDiff, type FileDiffMetadata } from "@pierre/diffs";
import type { App } from "../../app/App";
import { createDiv, createEl, createSpan } from "../../dom/dom";
import { MarkdownRenderer } from "../../markdown/MarkdownRenderer";
import { setIcon } from "../../ui/Icon";
import { Notice } from "../../ui/Notice";
import { ItemView } from "../../views/ItemView";
import type { ViewStateResult } from "../../views/View";
import { formatRelativeDate } from "../git/relativeDate";
import { ReviewSurface } from "../git/review/ReviewSurface";
import {
  fingerprintContents,
  type ReviewFile,
  type ReviewFileStatus,
} from "../git/review/reviewModel";
import { fileDiffFromGithubPatch, fileDiffsFromUnifiedDiff } from "./patchUtils";
import { readGithubPrPrefs, writeGithubPrPrefs } from "./prefs";
import type {
  GitHubAuthState,
  GitHubRepositoryRef,
  PrDetail,
  PrListFilter,
  PrSummary,
} from "./types";
import { openCommitDetail, openGitHubWorkspace } from "./GitHubWorkspace";

const FILTERS: { id: PrListFilter; label: string }[] = [
  { id: "open", label: "Open" },
  { id: "mine", label: "Mine" },
  { id: "review-requested", label: "Review requested" },
  { id: "all", label: "All" },
];

export class PrListView extends ItemView {
  static readonly VIEW_TYPE = "git-prs";

  private auth: GitHubAuthState | null = null;
  private repo: GitHubRepositoryRef | null = null;
  private prs: PrSummary[] | null = null;
  private filter: PrListFilter = readGithubPrPrefs().filter ?? "open";
  private query = "";
  private request = 0;

  getViewType(): string {
    return PrListView.VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Pull requests";
  }

  getIcon(): string {
    return "lucide-git-pull-request";
  }

  async onOpen(): Promise<void> {
    this.contentEl.classList.add("git-pr-view");
    await this.bootstrap();
  }

  async onClose(): Promise<void> {
    this.request += 1;
    await super.onClose();
  }

  private async bootstrap(): Promise<void> {
    const request = ++this.request;
    this.contentEl.empty();
    createDiv({ cls: "git-pr-empty", text: "Loading pull requests…" }, this.contentEl);
    const [auth, active, origin] = await Promise.all([
      this.app.github.getAuth(),
      this.app.github.resolveRepository(),
      this.app.github.resolveOriginRepository(),
    ]);
    if (request !== this.request) return;
    this.auth = auth;
    this.repo = active ?? origin;
    if (!active && origin) this.app.github.setRepository(origin);
    if (!auth.hasToken || !auth.login) this.renderSignIn();
    else if (!this.repo) this.renderRepoPicker();
    else await this.loadPulls();
  }

  private async loadPulls(): Promise<void> {
    if (!this.repo || !this.auth?.login) return;
    const request = ++this.request;
    this.prs = null;
    this.renderList();
    try {
      this.prs = await this.app.github.listPullRequests(this.filter, this.repo);
    } catch (error) {
      if (request !== this.request) return;
      this.contentEl.empty();
      createDiv({ cls: "git-pr-error", text: errorText(error) }, this.contentEl);
      return;
    }
    if (request === this.request) this.renderList();
  }

  private renderList(): void {
    if (!this.repo || !this.auth) return;
    const repo = this.repo;
    this.contentEl.empty();
    const root = createDiv("git-pr-workspace", this.contentEl);
    const toolbar = createEl("header", "git-pr-toolbar", root);
    const main = createDiv("git-pr-toolbar-main", toolbar);
    const titleRow = createDiv("git-pr-toolbar-title-row", main);
    icon(titleRow, "lucide-git-pull-request");
    createEl("h1", { cls: "git-pr-toolbar-title", text: "Pull requests" }, titleRow);
    const badge = button(titleRow, `${repo.owner}/${repo.repo}`, "git-pr-repo-badge tappable");
    badge.title = "Switch repository";
    badge.addEventListener("click", () => this.renderRepoPicker());
    const commits = button(titleRow, "Commits", "git-pr-action");
    commits.addEventListener(
      "click",
      () =>
        void openGitHubWorkspace(this.app, {
          section: "commits",
          owner: repo.owner,
          repo: repo.repo,
        }),
    );
    const branches = button(titleRow, "Branches", "git-pr-action");
    branches.addEventListener(
      "click",
      () =>
        void openGitHubWorkspace(this.app, {
          section: "branches",
          owner: repo.owner,
          repo: repo.repo,
        }),
    );
    const tabs = createDiv("git-pr-filter-tabs", main);
    tabs.setAttribute("role", "tablist");
    for (const item of FILTERS) {
      const tab = button(
        tabs,
        item.label,
        `git-pr-filter-tab${this.filter === item.id ? " is-active" : ""}`,
      );
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-selected", String(this.filter === item.id));
      tab.addEventListener("click", () => {
        this.filter = item.id;
        writeGithubPrPrefs({ filter: item.id });
        void this.loadPulls();
      });
    }
    const side = createDiv("git-pr-toolbar-side", toolbar);
    const search = createEl(
      "input",
      {
        placeholder: "Filter title, author, branch…",
        attr: { "aria-label": "Filter pull requests" },
      },
      side,
    );
    search.value = this.query;
    search.addEventListener("input", () => {
      this.query = search.value;
      this.renderList();
    });
    iconButton(side, "Refresh", "lucide-rotate-ccw", () => void this.loadPulls());
    if (this.prs === null) {
      createDiv({ cls: "git-pr-empty", text: "Loading pull requests…" }, root);
      return;
    }
    const query = this.query.trim().toLowerCase();
    const filtered = this.prs.filter(
      (pr) =>
        !query ||
        pr.title.toLowerCase().includes(query) ||
        String(pr.number).includes(query) ||
        pr.author.login.toLowerCase().includes(query) ||
        pr.headRefName.toLowerCase().includes(query),
    );
    if (!filtered.length) {
      createDiv({ cls: "git-pr-empty", text: "No pull requests" }, root);
      return;
    }
    const list = createDiv("git-pr-list", root);
    list.setAttribute("role", "list");
    createDiv(
      {
        cls: "git-pr-list-count",
        text: `${filtered.length} pull request${filtered.length === 1 ? "" : "s"}`,
      },
      list,
    );
    for (const pr of filtered) this.renderPullRow(list, pr, repo);
  }

  private renderPullRow(parent: HTMLElement, pr: PrSummary, repo: GitHubRepositoryRef): void {
    const row = button(parent, undefined, "git-pr-row");
    row.setAttribute("role", "listitem");
    const state = createSpan(`git-pr-state-icon mod-${pr.isDraft ? "draft" : pr.state}`, row);
    icon(state, "lucide-git-pull-request");
    avatar(row, pr.author.login, pr.author.avatarUrl, 28);
    const main = createSpan("git-pr-row-main", row);
    createSpan(
      { cls: "git-pr-row-title", text: pr.title },
      createSpan("git-pr-row-title-line", main),
    );
    createSpan(
      {
        cls: "git-pr-row-meta",
        text: `#${pr.number} · ${pr.author.login} · ${pr.headRefName} → ${pr.baseRefName} · ${formatRelativeDate(pr.updatedAt)}`,
      },
      main,
    );
    const side = createSpan("git-pr-row-side", row);
    if (pr.additions || pr.deletions) {
      const stat = createSpan("git-pr-diffstat", side);
      createEl("ins", { text: `+${pr.additions}` }, stat);
      createEl("del", { text: `−${pr.deletions}` }, stat);
    }
    if (pr.changedFiles)
      createSpan({ cls: "git-pr-file-count", text: `${pr.changedFiles} files` }, side);
    row.addEventListener("click", () => void openPrDetail(this.app, pr.number, repo));
  }

  private renderSignIn(): void {
    this.contentEl.empty();
    const root = createDiv("git-pr-signin", this.contentEl);
    const card = createDiv("git-pr-signin-card", root);
    const iconEl = createDiv("git-pr-signin-icon", card);
    icon(iconEl, "lucide-github");
    createEl("h2", { text: "Connect GitHub" }, card);
    createEl(
      "p",
      {
        text: "Browse pull requests with an app-owned personal access token. Auth stays inside this app — no GitHub CLI.",
      },
      card,
    );
    const field = createEl("label", "git-pr-signin-field", card);
    createSpan({ text: "Personal access token" }, field);
    const input = createEl(
      "input",
      { attr: { type: "password", autocomplete: "off" }, placeholder: "ghp_… or github_pat_…" },
      field,
    );
    const submit = button(card, "Sign in", "mod-cta git-pr-signin-submit");
    submit.disabled = true;
    input.addEventListener("input", () => (submit.disabled = !input.value.trim()));
    const signIn = async () => {
      submit.disabled = true;
      const result = await this.app.github.setToken(input.value);
      if ("error" in result) {
        createDiv({ cls: "git-pr-error", text: result.error }, card);
        return;
      }
      this.auth = result;
      await this.bootstrap();
    };
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && input.value.trim()) void signIn();
    });
    submit.addEventListener("click", () => void signIn());
  }

  private renderRepoPicker(): void {
    if (!this.auth) return;
    this.contentEl.empty();
    const root = createDiv("git-pr-workspace", this.contentEl);
    const toolbar = createEl("header", "git-pr-toolbar", root);
    createEl("h1", { cls: "git-pr-toolbar-title", text: "Choose a repository" }, toolbar);
    const picker = createDiv("git-pr-repo-picker", root);
    const card = createEl("section", "git-pr-repo-picker-card", picker);
    createEl("h2", { text: "Open repository" }, card);
    const input = createEl("input", { placeholder: "coder/ghostty-web" }, card);
    const open = button(card, "Open", "mod-cta");
    const select = () => {
      const match = /^([^/\s]+)\/([^/\s]+)$/.exec(input.value.trim().replace(/\.git$/i, ""));
      if (!match) return void new Notice("Enter owner/repo");
      this.selectRepo({ owner: match[1], repo: match[2] });
    };
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") select();
    });
    open.addEventListener("click", select);
    const reposCard = createEl("section", "git-pr-repo-picker-card git-pr-repo-list-card", picker);
    createEl("h2", { text: "Your repositories" }, reposCard);
    createDiv({ cls: "git-pr-empty", text: "Loading repositories…" }, reposCard);
    void this.app.github.listUserRepositories().then((repos) => {
      if (!reposCard.isConnected) return;
      reposCard.querySelector(".git-pr-empty")?.remove();
      const list = createDiv("git-pr-repo-list", reposCard);
      for (const repo of repos) {
        const row = button(list, repo.fullName, "git-pr-repo-row");
        row.addEventListener("click", () =>
          this.selectRepo({ owner: repo.owner, repo: repo.repo }),
        );
      }
    });
  }

  private selectRepo(repo: { owner: string; repo: string }): void {
    this.app.github.setRepository(repo);
    this.repo = { ...repo, host: "github.com" };
    void this.loadPulls();
  }
}

export class PrDetailView extends ItemView {
  static readonly VIEW_TYPE = "git-pr";

  private number: number | null = null;
  private owner: string | null = null;
  private repoName: string | null = null;
  private repo: GitHubRepositoryRef | null = null;
  private detail: PrDetail | null = null;
  private selectedPath: string | null = null;
  private tab: "conversation" | "commits" | "files" = "files";
  private filesMode: "tree" | "review" = "tree";
  private unifiedDiff = "";
  private patchByPath = new Map<string, FileDiffMetadata>();
  private reviewSurface: ReviewSurface | null = null;
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
    if (this.number !== null) await this.loadDetail();
  }

  async setState(state: unknown, result?: ViewStateResult): Promise<void> {
    await super.setState(state, result);
    if (!state || typeof state !== "object") return;
    const next = state as { number?: unknown; owner?: unknown; repo?: unknown };
    if (typeof next.number === "number") this.number = next.number;
    if (typeof next.owner === "string") this.owner = next.owner;
    if (typeof next.repo === "string") this.repoName = next.repo;
    await this.loadDetail();
    this.leaf.updateHeader();
  }

  getState(): Record<string, unknown> {
    return { number: this.number, owner: this.owner, repo: this.repoName };
  }

  async onClose(): Promise<void> {
    this.request += 1;
    this.reviewSurface?.destroy();
    this.reviewSurface = null;
    await super.onClose();
  }

  private async loadDetail(): Promise<void> {
    if (this.number === null) return;
    const request = ++this.request;
    this.reviewSurface?.destroy();
    this.reviewSurface = null;
    this.contentEl.empty();
    createDiv({ cls: "git-pr-empty", text: `Loading PR #${this.number}…` }, this.contentEl);
    try {
      const repo =
        this.owner && this.repoName
          ? { owner: this.owner, repo: this.repoName, host: "github.com" as const }
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
      this.patchByPath = new Map(fileDiffsFromUnifiedDiff(diff).map((file) => [file.name, file]));
      if (!this.selectedPath || !detail.files.some((file) => file.path === this.selectedPath)) {
        this.selectedPath = detail.files[0]?.path ?? null;
      }
      this.renderDetail();
    } catch (error) {
      if (request !== this.request) return;
      this.contentEl.empty();
      createDiv({ cls: "git-pr-error", text: errorText(error) }, this.contentEl);
    }
  }

  private renderDetail(): void {
    if (!this.detail || !this.repo || this.number === null) return;
    this.reviewSurface?.destroy();
    this.reviewSurface = null;
    const detail = this.detail;
    this.contentEl.empty();
    const root = createDiv("git-pr-detail", this.contentEl);
    const header = createEl("header", "git-pr-detail-header", root);
    const back = linkButton(header, "← Pull requests", () => void openPrList(this.app));
    back.classList.add("git-pr-back");
    createEl("h1", { cls: "git-pr-title", text: detail.title }, header);
    const meta = createDiv("git-pr-meta", header);
    createSpan(
      {
        text: `${detail.author.login} · #${detail.number} · ${detail.headRefName} → ${detail.baseRefName}`,
      },
      meta,
    );
    const stat = createSpan("git-pr-diffstat", meta);
    createEl("ins", { text: `+${detail.additions}` }, stat);
    createEl("del", { text: `−${detail.deletions}` }, stat);
    const tabs = createDiv("git-pr-tabs", root);
    this.tabButton(tabs, "conversation", "Conversation");
    this.tabButton(tabs, "commits", `Commits ${detail.commits.length}`);
    this.tabButton(tabs, "files", `Files changed ${detail.files.length}`);
    const body = createDiv("git-pr-body", root);
    const main = createDiv("git-pr-main", body);
    if (this.tab === "files") this.renderFiles(main, detail);
    else if (this.tab === "conversation") this.renderConversation(main, detail);
    else this.renderCommits(main, detail);
    const sidebar = createEl("aside", "git-pr-sidebar", body);
    createEl("h3", { cls: "git-pr-sidebar-title", text: "Repository" }, sidebar);
    createDiv(
      { cls: "git-pr-sidebar-empty", text: `${this.repo.owner}/${this.repo.repo}` },
      sidebar,
    );
  }

  private tabButton(parent: HTMLElement, tab: typeof this.tab, label: string): void {
    const buttonEl = button(parent, label, `git-pr-tab${this.tab === tab ? " is-active" : ""}`);
    buttonEl.addEventListener("click", () => {
      this.tab = tab;
      this.renderDetail();
    });
  }

  private renderFiles(parent: HTMLElement, detail: PrDetail): void {
    const root = createDiv("git-pr-files", parent);
    const toolbar = createDiv("git-pr-files-toolbar", root);
    const modes = createDiv("git-pr-files-mode", toolbar);
    const treeMode = button(modes, "File tree", this.filesMode === "tree" ? "is-active" : "");
    const reviewMode = button(modes, "Full review", this.filesMode === "review" ? "is-active" : "");
    treeMode.addEventListener("click", () => {
      this.filesMode = "tree";
      this.renderDetail();
    });
    reviewMode.addEventListener("click", () => {
      this.filesMode = "review";
      this.renderDetail();
    });
    if (this.filesMode === "review") {
      const host = createDiv("git-pr-full-review", root);
      this.reviewSurface = new ReviewSurface(host, {
        files: this.reviewFiles(detail),
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
      return;
    }
    const split = createDiv("git-pr-files-split", root);
    const tree = createEl("aside", "git-pr-file-tree", split);
    const summary = createDiv(
      { cls: "git-pr-file-tree-summary", text: `${detail.files.length} files` },
      tree,
    );
    const total = createSpan("git-pr-diffstat", summary);
    createEl("ins", { text: `+${detail.additions}` }, total);
    createEl("del", { text: `−${detail.deletions}` }, total);
    for (const file of detail.files) {
      const row = button(
        tree,
        undefined,
        `git-pr-file-row${this.selectedPath === file.path ? " is-active" : ""}`,
      );
      createSpan(
        { cls: `git-pr-file-status mod-${file.status}`, text: fileStatusGlyph(file.status) },
        row,
      );
      createSpan({ cls: "git-pr-file-name", text: file.path, attr: { title: file.path } }, row);
      const stat = createSpan("git-pr-diffstat", row);
      if (file.additions) createEl("ins", { text: `+${file.additions}` }, stat);
      if (file.deletions) createEl("del", { text: `−${file.deletions}` }, stat);
      row.addEventListener("click", () => {
        this.selectedPath = file.path;
        this.renderDetail();
      });
    }
    const preview = createDiv("git-pr-file-preview", split);
    const selected =
      detail.files.find((file) => file.path === this.selectedPath) ?? detail.files[0];
    if (selected)
      renderPatch(
        preview,
        selected.path,
        this.patchByPath.get(selected.path) ??
          fileDiffFromGithubPatch(selected.path, selected.patch),
        selected.patch,
        selected.status,
        selected.additions,
        selected.deletions,
      );
    else createDiv({ cls: "git-pr-empty", text: "Select a file to preview its diff." }, preview);
  }

  private reviewFiles(detail: PrDetail): ReviewFile[] {
    return detail.files.map((file) => {
      const fileDiff =
        this.patchByPath.get(file.path) ?? fileDiffFromGithubPatch(file.path, file.patch);
      return {
        path: file.path,
        status: statusFromGithub(file.status),
        fileDiff: fileDiff ?? ({ name: file.path, type: "change" } as FileDiffMetadata),
        additions: file.additions,
        deletions: file.deletions,
        fingerprint: fingerprintContents(file.path, detail.headRefOid),
        binary: !file.patch && !fileDiff,
      };
    });
  }

  private renderConversation(parent: HTMLElement, detail: PrDetail): void {
    const root = createDiv("git-pr-conversation", parent);
    const card = createDiv("git-pr-comment", root);
    const cardMeta = createDiv("git-pr-comment-header", card);
    createEl("strong", { text: detail.author.login }, cardMeta);
    createSpan(
      { cls: "git-pr-comment-date", text: formatRelativeDate(detail.createdAt) },
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

  private async submit(action: () => Promise<string | null>, success: string): Promise<void> {
    const error = await action();
    if (error) new Notice(`Failed: ${error}`);
    else {
      new Notice(success);
      await this.loadDetail();
    }
  }

  private renderCommits(parent: HTMLElement, detail: PrDetail): void {
    const root = createDiv("git-pr-commits", parent);
    if (!detail.commits.length)
      createDiv({ cls: "git-pr-empty", text: "No commits on this pull request." }, root);
    for (const commit of detail.commits) {
      const row = button(root, undefined, "git-pr-commit-row");
      createDiv({ cls: "git-pr-commit-title", text: commit.messageHeadline }, row);
      createDiv(
        {
          cls: "git-pr-row-meta",
          text: `${commit.author.login} · ${formatRelativeDate(commit.committedDate)}`,
        },
        row,
      );
      createEl("code", { text: commit.shortSha }, row);
      row.addEventListener(
        "click",
        () => void openCommitDetail(this.app, commit.sha, this.repo ?? undefined),
      );
    }
  }
}

export async function openPrList(app: App): Promise<void> {
  const existing = app.workspace.getLeavesOfType(PrListView.VIEW_TYPE)[0];
  if (existing) app.workspace.setActiveLeaf(existing, { focus: true });
  else
    await app.workspace.getLeaf("tab").setViewState({ type: PrListView.VIEW_TYPE, active: true });
}

export async function openPrDetail(
  app: App,
  number: number,
  repo?: { owner: string; repo: string },
): Promise<void> {
  const prefs = readGithubPrPrefs();
  const owner = repo?.owner ?? prefs.owner ?? "";
  const name = repo?.repo ?? prefs.repo ?? "";
  if (owner && name) app.github.setRepository({ owner, repo: name });
  await app.workspace.getLeaf("tab").setViewState({
    type: PrDetailView.VIEW_TYPE,
    active: true,
    state: { number, owner, repo: name },
  });
}

function renderPatch(
  parent: HTMLElement,
  path: string,
  fileDiff: FileDiffMetadata | null,
  patch: string | null,
  status: string,
  additions: number,
  deletions: number,
): void {
  const inner = createDiv("git-pr-file-preview-inner", parent);
  const header = createDiv("git-pr-file-preview-header", inner);
  createSpan({ cls: `git-pr-file-status mod-${status}`, text: fileStatusGlyph(status) }, header);
  createEl("code", { text: path }, header);
  const stat = createSpan("git-pr-diffstat", header);
  if (additions) createEl("ins", { text: `+${additions}` }, stat);
  if (deletions) createEl("del", { text: `−${deletions}` }, stat);
  const host = createDiv("git-pr-file-preview-body", inner);
  if (!fileDiff || typeof globalThis.ResizeObserver === "undefined") {
    createEl(
      "pre",
      {
        cls: "git-pr-patch-pre",
        text: patch ?? "No patch available (binary, generated, or too large for the API).",
      },
      host,
    );
    return;
  }
  try {
    const wrapper = createDiv("git-pr-pierre-host", host);
    new FileDiff({
      diffStyle: "unified",
      themeType: document.body.classList.contains("theme-dark") ? "dark" : "light",
      disableFileHeader: true,
    }).render({ fileDiff, containerWrapper: wrapper });
  } catch {
    host.empty();
    createEl("pre", { cls: "git-pr-patch-pre", text: patch ?? "" }, host);
  }
}

function markdown(parent: HTMLElement, text: string): void {
  const host = createDiv("markdown-rendered", parent);
  void MarkdownRenderer.renderMarkdown(text, host, "");
}

function avatar(parent: HTMLElement, login: string, url: string, size: number): void {
  if (url)
    createEl(
      "img",
      { cls: "git-pr-avatar", attr: { src: url, alt: "", width: size, height: size } },
      parent,
    );
  else createSpan({ cls: "git-pr-avatar-fallback", text: login.slice(0, 1).toUpperCase() }, parent);
}

function button(parent: HTMLElement, text?: string, cls?: string): HTMLButtonElement {
  return createEl("button", { cls, text, attr: { type: "button" } }, parent);
}

function linkButton(parent: HTMLElement, text: string, action: () => void): HTMLButtonElement {
  const element = button(parent, text, "git-pr-action");
  element.addEventListener("click", action);
  return element;
}

function icon(parent: HTMLElement, name: string): HTMLElement {
  const element = createSpan("git-pr-icon", parent);
  setIcon(element, name);
  return element;
}

function iconButton(parent: HTMLElement, label: string, name: string, action: () => void): void {
  const element = button(parent, undefined, "clickable-icon");
  element.setAttribute("aria-label", label);
  setIcon(element, name);
  element.addEventListener("click", action);
}

function fileStatusGlyph(status: string): string {
  if (status === "added") return "A";
  if (status === "removed") return "D";
  if (status === "renamed") return "R";
  return "M";
}

function statusFromGithub(status: string): ReviewFileStatus {
  if (status === "added") return "added";
  if (status === "removed") return "deleted";
  if (status === "renamed") return "renamed";
  return "modified";
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
