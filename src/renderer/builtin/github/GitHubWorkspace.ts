import { FileDiff, type FileDiffMetadata } from "@pierre/diffs";
import type { App } from "../../app/App";
import { createDiv, createEl, createSpan } from "../../dom/dom";
import { setIcon } from "../../ui/Icon";
import { Notice } from "../../ui/Notice";
import { ItemView } from "../../views/ItemView";
import type { ViewStateResult } from "../../views/View";
import { formatRelativeDate } from "../git/relativeDate";
import { openGitReview } from "../git/review/GitReviewView";
import { mountGitHubExtraPanel, type GitHubExtraPanel } from "./GitHubExtraPanels";
import { fileDiffFromGithubPatch, fileDiffsFromUnifiedDiff } from "./patchUtils";
import { readGithubPrPrefs, writeGithubPrPrefs } from "./prefs";
import type {
  CommitDetail,
  CommitSummary,
  GitHubAuthState,
  GitHubBranch,
  GitHubRepositoryRef,
  GithubWorkspaceSection,
} from "./types";

const SECTIONS: { id: GithubWorkspaceSection; label: string; icon: string }[] = [
  { id: "pulls", label: "Pull requests", icon: "lucide-git-pull-request" },
  { id: "issues", label: "Issues", icon: "lucide-circle-dot" },
  { id: "commits", label: "Commits", icon: "lucide-git-commit" },
  { id: "files", label: "Files", icon: "lucide-folder" },
  { id: "actions", label: "Actions", icon: "lucide-play" },
  { id: "branches", label: "Branches", icon: "lucide-git-branch" },
  { id: "inbox", label: "Inbox", icon: "lucide-inbox" },
  { id: "local", label: "Local", icon: "lucide-file-diff" },
];

export class GitHubWorkspaceView extends ItemView {
  static readonly VIEW_TYPE = "github-workspace";

  private section: GithubWorkspaceSection = "pulls";
  private auth: GitHubAuthState | null = null;
  private repo: GitHubRepositoryRef | null = null;
  private panel: GitHubExtraPanel | null = null;
  private request = 0;
  private commitRef = "";
  private commitPage = 1;

  getViewType(): string {
    return GitHubWorkspaceView.VIEW_TYPE;
  }

  getDisplayText(): string {
    const prefs = readGithubPrPrefs();
    return prefs.owner && prefs.repo ? `${prefs.owner}/${prefs.repo}` : "GitHub";
  }

  getIcon(): string {
    return "lucide-github";
  }

  async onOpen(): Promise<void> {
    this.contentEl.classList.add("gh-workspace");
    await this.loadWorkspace();
  }

  async setState(state: unknown, result?: ViewStateResult): Promise<void> {
    await super.setState(state, result);
    if (!state || typeof state !== "object") return;
    const next = state as { section?: GithubWorkspaceSection; owner?: string; repo?: string };
    if (next.section) this.section = next.section;
    if (next.owner && next.repo)
      this.app.github.setRepository({ owner: next.owner, repo: next.repo });
    await this.loadWorkspace();
    this.leaf.updateHeader();
  }

  getState(): Record<string, unknown> {
    const prefs = readGithubPrPrefs();
    return { section: this.section, owner: prefs.owner, repo: prefs.repo };
  }

  async onClose(): Promise<void> {
    this.request += 1;
    this.panel?.destroy();
    this.panel = null;
    await super.onClose();
  }

  private async loadWorkspace(): Promise<void> {
    const request = ++this.request;
    this.panel?.destroy();
    this.panel = null;
    this.contentEl.empty();
    createDiv({ cls: "gh-empty", text: "Loading GitHub workspace…" }, this.contentEl);
    const [auth, repo] = await Promise.all([
      this.app.github.getAuth(),
      this.app.github.resolveRepository(),
    ]);
    if (request !== this.request) return;
    this.auth = auth;
    this.repo = repo;
    this.renderShell();
  }

  private renderShell(): void {
    this.panel?.destroy();
    this.panel = null;
    this.contentEl.empty();
    if (!this.auth?.login) {
      this.renderEmptyAction("Sign in to GitHub to browse this repository.", "Connect GitHub");
      return;
    }
    if (!this.repo) {
      this.renderEmptyAction("Choose a repository first.", "Choose repository");
      return;
    }
    const shell = createDiv("gh-shell", this.contentEl);
    const sidebar = createEl("aside", "gh-sidebar", shell);
    const repoHead = createDiv("gh-sidebar-repo", sidebar);
    icon(repoHead, "lucide-github");
    const repoText = createDiv("gh-sidebar-repo-text", repoHead);
    createDiv(
      { cls: "gh-sidebar-repo-name", text: `${this.repo.owner}/${this.repo.repo}` },
      repoText,
    );
    linkButton(repoText, "Switch repo", () => void openPullRequestsView(this.app));
    const nav = createEl("nav", "gh-section-nav", sidebar);
    for (const item of SECTIONS) {
      const button = createEl(
        "button",
        {
          cls: `gh-section-btn${this.section === item.id ? " is-active" : ""}`,
          attr: { type: "button" },
        },
        nav,
      );
      icon(button, item.icon);
      createSpan({ text: item.label }, button);
      button.addEventListener("click", () => {
        if (item.id === "pulls") return void openPullRequestsView(this.app);
        this.section = item.id;
        this.commitPage = 1;
        this.renderShell();
        this.leaf.updateHeader();
      });
    }
    const user = createDiv("gh-sidebar-user", sidebar);
    if (this.auth.avatarUrl) {
      createEl(
        "img",
        { cls: "gh-avatar", attr: { src: this.auth.avatarUrl, alt: "", width: 20, height: 20 } },
        user,
      );
    }
    createSpan({ text: this.auth.login }, user);
    const main = createEl("main", "gh-main", shell);
    this.renderSection(main, this.repo);
  }

  private renderEmptyAction(message: string, label: string): void {
    const empty = createDiv("gh-empty-center", this.contentEl);
    createEl("p", { text: message }, empty);
    const button = createEl(
      "button",
      { cls: "mod-cta", text: label, attr: { type: "button" } },
      empty,
    );
    button.addEventListener("click", () => void openPullRequestsView(this.app));
  }

  private renderSection(main: HTMLElement, repo: GitHubRepositoryRef): void {
    if (
      this.section === "issues" ||
      this.section === "files" ||
      this.section === "actions" ||
      this.section === "inbox"
    ) {
      this.panel = mountGitHubExtraPanel(main, this.section, this.app, repo);
    } else if (this.section === "commits") {
      void this.renderCommits(main, repo);
    } else if (this.section === "branches") {
      void this.renderBranches(main, repo);
    } else if (this.section === "local") {
      this.renderLocal(main);
    } else {
      const empty = createDiv("gh-empty-center", main);
      createEl("p", { text: "Opening pull requests…" }, empty);
    }
  }

  private async renderCommits(main: HTMLElement, repo: GitHubRepositoryRef): Promise<void> {
    const request = ++this.request;
    main.empty();
    const root = createDiv("gh-commits", main);
    const header = createEl("header", "gh-commits-header", root);
    const heading = createDiv(undefined, header);
    createEl("h1", { cls: "gh-page-title", text: "Commits" }, heading);
    const subtitle = createEl(
      "p",
      { cls: "gh-muted", text: `${repo.owner}/${repo.repo}` },
      heading,
    );
    const controls = createDiv("gh-commits-controls", header);
    const select = createEl(
      "select",
      { cls: "gh-select", attr: { "aria-label": "Branch" } },
      controls,
    );
    iconButton(controls, "Refresh", "lucide-rotate-ccw", () => void this.renderCommits(main, repo));
    createDiv({ cls: "gh-empty", text: "Loading commits…" }, root);
    try {
      const [branches, defaultBranch] = await Promise.all([
        this.app.github.listBranches(repo),
        this.app.github.getDefaultBranch(repo),
      ]);
      if (request !== this.request) return;
      const preferred = this.commitRef || readGithubPrPrefs().lastBranch;
      this.commitRef =
        preferred && branches.some((branch) => branch.name === preferred)
          ? preferred
          : defaultBranch;
      for (const branch of branches) {
        createEl("option", { value: branch.name, text: branch.name }, select);
      }
      select.value = this.commitRef;
      select.addEventListener("change", () => {
        this.commitRef = select.value;
        this.commitPage = 1;
        writeGithubPrPrefs({ lastBranch: this.commitRef });
        void this.renderCommits(main, repo);
      });
      subtitle.textContent = `${repo.owner}/${repo.repo} @ ${this.commitRef}`;
      const data = await this.app.github.listCommits(
        { ref: this.commitRef, page: this.commitPage, perPage: 30 },
        repo,
      );
      if (request !== this.request) return;
      root.querySelector(".gh-empty")?.remove();
      if (!data.items.length)
        createDiv({ cls: "gh-empty", text: "No commits on this branch." }, root);
      else this.renderCommitRows(root, data.items, repo);
      if (data.hasNextPage || data.hasPreviousPage) {
        const pagination = createDiv("gh-pagination", root);
        const previous = button(pagination, "Previous");
        previous.disabled = !data.hasPreviousPage;
        previous.addEventListener("click", () => {
          this.commitPage = Math.max(1, this.commitPage - 1);
          void this.renderCommits(main, repo);
        });
        createSpan({ cls: "gh-muted", text: `Page ${this.commitPage}` }, pagination);
        const next = button(pagination, "Next");
        next.disabled = !data.hasNextPage;
        next.addEventListener("click", () => {
          this.commitPage += 1;
          void this.renderCommits(main, repo);
        });
      }
    } catch (error) {
      if (request !== this.request) return;
      root.querySelector(".gh-empty")?.remove();
      createDiv({ cls: "gh-error", text: errorText(error) }, root);
    }
  }

  private renderCommitRows(
    parent: HTMLElement,
    commits: CommitSummary[],
    repo: GitHubRepositoryRef,
  ): void {
    const list = createDiv("gh-commit-list", parent);
    for (const commit of commits) {
      const row = button(list, undefined, "gh-commit-row");
      if (commit.author.avatarUrl) {
        createEl(
          "img",
          {
            cls: "gh-avatar",
            attr: { src: commit.author.avatarUrl, alt: "", width: 28, height: 28 },
          },
          row,
        );
      } else {
        createSpan(
          { cls: "gh-avatar-fallback", text: commit.author.login.slice(0, 1).toUpperCase() },
          row,
        );
      }
      const main = createDiv("gh-commit-main", row);
      createDiv({ cls: "gh-commit-headline", text: commit.headline }, main);
      const meta = createDiv(
        {
          cls: "gh-muted",
          text: `${commit.author.login} committed ${formatRelativeDate(commit.committedDate)}`,
        },
        main,
      );
      meta.querySelector("strong");
      createEl("code", { cls: "gh-sha", text: commit.shortSha }, row);
      iconButton(row, "Copy SHA", "lucide-copy", () => {
        void navigator.clipboard.writeText(commit.sha).then(() => new Notice("SHA copied"));
      });
      row.addEventListener("click", () => void openCommitDetail(this.app, commit.sha, repo));
    }
  }

  private async renderBranches(main: HTMLElement, repo: GitHubRepositoryRef): Promise<void> {
    const request = ++this.request;
    main.empty();
    const root = createDiv("gh-commits", main);
    const header = createEl("header", "gh-commits-header", root);
    const heading = createDiv(undefined, header);
    createEl("h1", { cls: "gh-page-title", text: "Branches" }, heading);
    createEl("p", { cls: "gh-muted", text: `${repo.owner}/${repo.repo}` }, heading);
    const search = createEl("input", { cls: "gh-search", placeholder: "Filter branches…" }, header);
    const body = createDiv(undefined, root);
    createDiv({ cls: "gh-empty", text: "Loading branches…" }, body);
    try {
      const [branches, defaultBranch] = await Promise.all([
        this.app.github.listBranches(repo),
        this.app.github.getDefaultBranch(repo),
      ]);
      if (request !== this.request) return;
      const render = () => {
        body.empty();
        const query = search.value.trim().toLowerCase();
        const table = createDiv("gh-branch-table", body);
        for (const branch of branches.filter(
          (item) => !query || item.name.toLowerCase().includes(query),
        )) {
          this.renderBranch(table, branch, defaultBranch, repo);
        }
      };
      search.addEventListener("input", render);
      render();
    } catch (error) {
      body.empty();
      createDiv({ cls: "gh-error", text: errorText(error) }, body);
    }
  }

  private renderBranch(
    parent: HTMLElement,
    branch: GitHubBranch,
    defaultBranch: string,
    repo: GitHubRepositoryRef,
  ): void {
    const row = createDiv("gh-branch-row", parent);
    icon(row, "lucide-git-branch");
    const main = createDiv("gh-branch-row-main", row);
    const name = createDiv({ cls: "gh-branch-row-name", text: branch.name }, main);
    if (branch.name === defaultBranch) createSpan({ cls: "gh-chip", text: "default" }, name);
    if (branch.protected) createSpan({ cls: "gh-chip", text: "protected" }, name);
    createEl("code", { text: branch.commitSha.slice(0, 7) }, createDiv("gh-muted", main));
    linkButton(row, "View commits", () => {
      this.commitRef = branch.name;
      this.commitPage = 1;
      writeGithubPrPrefs({ owner: repo.owner, repo: repo.repo, lastBranch: branch.name });
      this.section = "commits";
      this.renderShell();
    });
    if (branch.commitSha)
      linkButton(row, "Tip commit", () => void openCommitDetail(this.app, branch.commitSha, repo));
  }

  private renderLocal(main: HTMLElement): void {
    const root = createDiv("gh-local-panel", main);
    createEl("h1", { cls: "gh-page-title", text: "Local vault" }, root);
    createEl(
      "p",
      {
        cls: "gh-muted",
        text: "Working-tree tools for the vault on disk (independent of GitHub auth).",
      },
      root,
    );
    const actions = createDiv("gh-local-actions", root);
    const changes = button(actions, "Open local changes", "mod-cta");
    changes.addEventListener(
      "click",
      () =>
        void this.app.workspace.getLeaf("tab").setViewState({ type: "git-changes", active: true }),
    );
    button(actions, "Review working tree").addEventListener(
      "click",
      () => void openGitReview(this.app),
    );
  }
}

export class GitCommitView extends ItemView {
  static readonly VIEW_TYPE = "git-commit";

  private sha: string | null = null;
  private owner: string | null = null;
  private repoName: string | null = null;
  private detail: CommitDetail | null = null;
  private repo: GitHubRepositoryRef | null = null;
  private selectedPath: string | null = null;
  private patchByPath = new Map<string, FileDiffMetadata>();
  private request = 0;

  getViewType(): string {
    return GitCommitView.VIEW_TYPE;
  }

  getDisplayText(): string {
    return this.sha ? `Commit ${this.sha.slice(0, 7)}` : "Commit";
  }

  getIcon(): string {
    return "lucide-git-commit";
  }

  async onOpen(): Promise<void> {
    this.contentEl.classList.add("gh-workspace");
    if (this.sha) await this.loadCommit();
  }

  async setState(state: unknown, result?: ViewStateResult): Promise<void> {
    await super.setState(state, result);
    if (!state || typeof state !== "object") return;
    const next = state as { sha?: string; owner?: string; repo?: string };
    if (typeof next.sha === "string") this.sha = next.sha;
    if (typeof next.owner === "string") this.owner = next.owner;
    if (typeof next.repo === "string") this.repoName = next.repo;
    await this.loadCommit();
    this.leaf.updateHeader();
  }

  getState(): Record<string, unknown> {
    return { sha: this.sha, owner: this.owner, repo: this.repoName };
  }

  async onClose(): Promise<void> {
    this.request += 1;
    await super.onClose();
  }

  private async loadCommit(): Promise<void> {
    if (!this.sha) return;
    const request = ++this.request;
    this.contentEl.empty();
    createDiv({ cls: "gh-empty", text: "Loading commit…" }, this.contentEl);
    try {
      const repo =
        this.owner && this.repoName
          ? { owner: this.owner, repo: this.repoName, host: "github.com" as const }
          : await this.app.github.resolveRepository();
      if (!repo) throw new Error("No repository selected");
      const [detail, diff] = await Promise.all([
        this.app.github.getCommit(this.sha, repo),
        this.app.github.getCommitDiff(this.sha, repo).catch(() => ""),
      ]);
      if (request !== this.request) return;
      this.repo = repo;
      this.detail = detail;
      this.selectedPath = detail.files[0]?.path ?? null;
      this.patchByPath = new Map(fileDiffsFromUnifiedDiff(diff).map((file) => [file.name, file]));
      this.render();
    } catch (error) {
      if (request !== this.request) return;
      this.contentEl.empty();
      const empty = createDiv("gh-empty-center", this.contentEl);
      createEl("p", { text: errorText(error) }, empty);
      const back = button(empty, "Back to commits", "mod-cta");
      back.addEventListener(
        "click",
        () => void openGitHubWorkspace(this.app, { section: "commits" }),
      );
    }
  }

  private render(): void {
    if (!this.detail || !this.repo) return;
    const detail = this.detail;
    const repo = this.repo;
    this.contentEl.empty();
    const root = createDiv("gh-commit-detail", this.contentEl);
    const header = createEl("header", "gh-commit-detail-header", root);
    const breadcrumb = createDiv("gh-breadcrumb", header);
    linkButton(
      breadcrumb,
      "← Commits",
      () =>
        void openGitHubWorkspace(this.app, {
          section: "commits",
          owner: repo.owner,
          repo: repo.repo,
        }),
    );
    createSpan({ cls: "gh-chip", text: `${repo.owner}/${repo.repo}` }, breadcrumb);
    createEl("h1", { cls: "gh-page-title", text: detail.headline }, header);
    const meta = createDiv("gh-commit-meta", header);
    if (detail.author.avatarUrl)
      createEl(
        "img",
        {
          cls: "gh-avatar",
          attr: { src: detail.author.avatarUrl, alt: "", width: 22, height: 22 },
        },
        meta,
      );
    createEl("strong", { text: detail.author.login }, meta);
    createSpan(
      { cls: "gh-muted", text: `committed ${formatRelativeDate(detail.committedDate)}` },
      meta,
    );
    createEl("code", { cls: "gh-sha", text: detail.shortSha }, meta);
    linkButton(
      meta,
      "Copy",
      () => void navigator.clipboard.writeText(detail.sha).then(() => new Notice("SHA copied")),
    );
    if (detail.verification?.verified)
      createSpan({ cls: "gh-chip mod-ok", text: "Verified" }, meta);
    if (detail.ciState)
      createSpan({ cls: `gh-chip mod-ci-${detail.ciState}`, text: detail.ciState }, meta);
    const stats = createSpan("gh-diffstat", meta);
    createEl("ins", { text: `+${detail.stats.additions}` }, stats);
    createEl("del", { text: `−${detail.stats.deletions}` }, stats);
    stats.append(` · ${detail.files.length} files`);
    linkButton(meta, "Open on GitHub", () => window.open(detail.url, "_blank"));
    if (detail.message.includes("\n"))
      createEl(
        "pre",
        { cls: "gh-commit-body", text: detail.message.split("\n").slice(1).join("\n").trim() },
        header,
      );
    if (detail.parents.length) {
      const parents = createDiv(
        { cls: "gh-muted", text: `Parent${detail.parents.length > 1 ? "s" : ""}: ` },
        header,
      );
      for (const parent of detail.parents)
        linkButton(
          parents,
          parent.shortSha,
          () => void openCommitDetail(this.app, parent.sha, repo),
        );
    }
    const split = createDiv("gh-commit-files-split", root);
    const tree = createEl("aside", "gh-file-tree", split);
    const summary = createDiv(
      { cls: "gh-file-tree-summary", text: `${detail.files.length} files` },
      tree,
    );
    const total = createSpan("gh-diffstat", summary);
    createEl("ins", { text: `+${detail.stats.additions}` }, total);
    createEl("del", { text: `−${detail.stats.deletions}` }, total);
    for (const file of detail.files) {
      const row = button(
        tree,
        undefined,
        `gh-file-row${this.selectedPath === file.path ? " is-active" : ""}`,
      );
      createSpan({ cls: `gh-file-status mod-${file.status}`, text: statusGlyph(file.status) }, row);
      createSpan({ cls: "gh-file-name", text: file.path, attr: { title: file.path } }, row);
      const stat = createSpan("gh-diffstat", row);
      if (file.additions) createEl("ins", { text: `+${file.additions}` }, stat);
      if (file.deletions) createEl("del", { text: `−${file.deletions}` }, stat);
      row.addEventListener("click", () => {
        this.selectedPath = file.path;
        this.render();
      });
    }
    const preview = createDiv("gh-file-preview", split);
    const selected =
      detail.files.find((file) => file.path === this.selectedPath) ?? detail.files[0];
    if (selected)
      this.renderPatch(
        preview,
        selected.path,
        this.patchByPath.get(selected.path) ??
          fileDiffFromGithubPatch(selected.path, selected.patch),
        selected.patch,
        selected.status,
        selected.additions,
        selected.deletions,
      );
    else createDiv({ cls: "gh-empty", text: "No files in this commit." }, preview);
  }

  private renderPatch(
    parent: HTMLElement,
    path: string,
    fileDiff: FileDiffMetadata | null,
    patch: string | null,
    status: string,
    additions: number,
    deletions: number,
  ): void {
    const inner = createDiv("gh-preview-inner", parent);
    const header = createDiv("gh-preview-header", inner);
    createSpan({ cls: `gh-file-status mod-${status}`, text: statusGlyph(status) }, header);
    createEl("code", { text: path }, header);
    const stat = createSpan("gh-diffstat", header);
    if (additions) createEl("ins", { text: `+${additions}` }, stat);
    if (deletions) createEl("del", { text: `−${deletions}` }, stat);
    const host = createDiv(undefined, inner);
    if (!fileDiff || typeof globalThis.ResizeObserver === "undefined") {
      createEl(
        "pre",
        { cls: "gh-patch-pre", text: patch ?? "No patch available (binary or too large)." },
        host,
      );
      return;
    }
    try {
      const wrapper = createDiv(undefined, host);
      new FileDiff({
        diffStyle: "unified",
        themeType: document.body.classList.contains("theme-dark") ? "dark" : "light",
        disableFileHeader: true,
      }).render({ fileDiff, containerWrapper: wrapper });
    } catch {
      host.empty();
      createEl("pre", { cls: "gh-patch-pre", text: patch ?? "" }, host);
    }
  }
}

export async function openGitHubWorkspace(
  app: App,
  options: { section?: GithubWorkspaceSection; owner?: string; repo?: string } = {},
): Promise<void> {
  if (options.owner && options.repo)
    app.github.setRepository({ owner: options.owner, repo: options.repo });
  const existing = app.workspace.getLeavesOfType(GitHubWorkspaceView.VIEW_TYPE)[0];
  const state = { section: options.section ?? "pulls", owner: options.owner, repo: options.repo };
  if (existing) {
    await existing.setViewState({ type: GitHubWorkspaceView.VIEW_TYPE, active: true, state });
    app.workspace.setActiveLeaf(existing, { focus: true });
  } else {
    await app.workspace
      .getLeaf("tab")
      .setViewState({ type: GitHubWorkspaceView.VIEW_TYPE, active: true, state });
  }
}

export async function openCommitDetail(
  app: App,
  sha: string,
  repo?: { owner: string; repo: string },
): Promise<void> {
  const prefs = readGithubPrPrefs();
  const owner = repo?.owner ?? prefs.owner ?? "";
  const name = repo?.repo ?? prefs.repo ?? "";
  if (owner && name) app.github.setRepository({ owner, repo: name });
  await app.workspace.getLeaf("tab").setViewState({
    type: GitCommitView.VIEW_TYPE,
    active: true,
    state: { sha, owner, repo: name },
  });
}

async function openPullRequestsView(app: App): Promise<void> {
  const existing = app.workspace.getLeavesOfType("git-prs")[0];
  if (existing) app.workspace.setActiveLeaf(existing, { focus: true });
  else await app.workspace.getLeaf("tab").setViewState({ type: "git-prs", active: true });
}

function button(parent: HTMLElement, text?: string, cls?: string): HTMLButtonElement {
  return createEl("button", { cls, text, attr: { type: "button" } }, parent);
}

function linkButton(parent: HTMLElement, text: string, action: () => void): HTMLButtonElement {
  const element = button(parent, text, "gh-linkish");
  element.addEventListener("click", (event) => {
    event.stopPropagation();
    action();
  });
  return element;
}

function icon(parent: HTMLElement, name: string): HTMLElement {
  const element = createSpan("gh-icon", parent);
  setIcon(element, name);
  return element;
}

function iconButton(
  parent: HTMLElement,
  label: string,
  name: string,
  action: () => void,
): HTMLButtonElement {
  const element = button(parent, undefined, "clickable-icon");
  element.setAttribute("aria-label", label);
  setIcon(element, name);
  element.addEventListener("click", (event) => {
    event.stopPropagation();
    action();
  });
  return element;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function statusGlyph(status: string): string {
  if (status === "added") return "A";
  if (status === "removed") return "D";
  if (status === "renamed") return "R";
  return "M";
}
