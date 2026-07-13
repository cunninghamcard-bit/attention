import type { App } from "../../app/App";
import { createDiv, createEl, createSpan } from "../../dom/dom";
import { MarkdownRenderer } from "../../markdown/MarkdownRenderer";
import { setIcon } from "../../ui/Icon";
import { Notice } from "../../ui/Notice";
import { formatRelativeDate } from "../git/relativeDate";
import { openPrDetail } from "./GitPrViews";
import type {
  ActionRunDetail,
  ActionRunSummary,
  GitHubRepositoryRef,
  IssueDetail,
  IssueSummary,
  NotificationItem,
  RepoContentItem,
  RepoFileContent,
} from "./types";

export type ExtraPanelKind = "issues" | "actions" | "files" | "inbox";

export interface GitHubExtraPanel {
  destroy(): void;
}

export function mountGitHubExtraPanel(
  container: HTMLElement,
  kind: ExtraPanelKind,
  app: App,
  repo: GitHubRepositoryRef,
): GitHubExtraPanel {
  if (kind === "issues") return new IssuesPanel(container, app, repo);
  if (kind === "actions") return new ActionsPanel(container, app, repo);
  if (kind === "files") return new FilesPanel(container, app, repo);
  return new InboxPanel(container, app);
}

abstract class Panel implements GitHubExtraPanel {
  protected dead = false;

  constructor(protected readonly root: HTMLElement) {}

  destroy(): void {
    this.dead = true;
    this.root.empty();
  }

  protected error(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}

class IssuesPanel extends Panel {
  private state: "open" | "closed" | "all" = "open";
  private items: IssueSummary[] | null = null;
  private selected: number | null = null;
  private detail: IssueDetail | null = null;
  private query = "";
  private comment = "";
  private busy = false;
  private errorText: string | null = null;

  constructor(
    root: HTMLElement,
    private readonly app: App,
    private readonly repo: GitHubRepositoryRef,
  ) {
    super(root);
    this.render();
    void this.load();
  }

  private async load(): Promise<void> {
    this.errorText = null;
    this.items = null;
    this.render();
    try {
      this.items = await this.app.github.listIssues(this.state, this.repo);
    } catch (error) {
      this.errorText = this.error(error);
      this.items = [];
    }
    if (!this.dead) this.render();
  }

  private async select(number: number): Promise<void> {
    this.selected = number;
    this.detail = null;
    this.render();
    try {
      this.detail = await this.app.github.getIssue(number, this.repo);
    } catch (error) {
      this.errorText = this.error(error);
    }
    if (!this.dead && this.selected === number) this.render();
  }

  private async postComment(): Promise<void> {
    if (!this.selected || !this.comment.trim()) return;
    this.busy = true;
    this.render();
    const error = await this.app.github.createIssueComment(
      this.selected,
      this.comment.trim(),
      this.repo,
    );
    this.busy = false;
    if (error) new Notice(error);
    else {
      this.comment = "";
      new Notice("Comment posted");
      this.detail = await this.app.github.getIssue(this.selected, this.repo);
    }
    if (!this.dead) this.render();
  }

  private render(): void {
    this.root.empty();
    const shell = createDiv("gh-split-panel", this.root);
    const list = createDiv("gh-split-list", shell);
    const header = panelHeader(list, "Issues", `${this.repo.owner}/${this.repo.repo}`);
    const pills = createDiv("gh-filter-pills", header);
    for (const state of ["open", "closed", "all"] as const) {
      const button = buttonEl(pills, state, this.state === state ? "is-active" : "");
      button.addEventListener("click", () => {
        this.state = state;
        this.selected = null;
        this.detail = null;
        void this.load();
      });
    }
    const search = createEl("label", "gh-search gh-search-block", list);
    icon(search, "lucide-search");
    const input = createEl("input", { placeholder: "Filter issues…" }, search);
    input.value = this.query;
    input.addEventListener("input", () => {
      this.query = input.value;
      this.render();
    });
    if (this.errorText) createDiv({ cls: "gh-error", text: this.errorText }, list);
    if (this.items === null) createDiv({ cls: "gh-empty", text: "Loading…" }, list);
    const query = this.query.trim().toLowerCase();
    const filtered = (this.items ?? []).filter(
      (issue) =>
        !query ||
        issue.title.toLowerCase().includes(query) ||
        String(issue.number).includes(query) ||
        issue.author.login.toLowerCase().includes(query),
    );
    if (this.items && filtered.length === 0)
      createDiv({ cls: "gh-empty", text: "No issues." }, list);
    const rows = createDiv("gh-item-list", list);
    for (const issue of filtered) {
      const row = buttonEl(
        rows,
        undefined,
        `gh-item-row${this.selected === issue.number ? " is-active" : ""}`,
      );
      createSpan(`gh-dot mod-${issue.state}`, row);
      const main = createDiv("gh-item-main", row);
      createDiv({ cls: "gh-item-title", text: issue.title }, main);
      createDiv(
        {
          cls: "gh-muted",
          text: `#${issue.number} · ${issue.author.login} · ${formatRelativeDate(issue.updatedAt)}${issue.comments ? ` · ${issue.comments} comments` : ""}`,
        },
        main,
      );
      for (const label of issue.labels.slice(0, 2)) {
        const chip = createSpan({ cls: "gh-label", text: label.name }, row);
        chip.style.setProperty("--label-color", `#${label.color}`);
      }
      row.addEventListener("click", () => void this.select(issue.number));
    }
    const detail = createDiv("gh-split-detail", shell);
    if (!this.detail) createDiv({ cls: "gh-empty", text: "Select an issue" }, detail);
    else this.renderDetail(detail, this.detail);
  }

  private renderDetail(parent: HTMLElement, detail: IssueDetail): void {
    const scroll = createDiv("gh-detail-scroll", parent);
    const head = createDiv("gh-detail-head", scroll);
    createSpan({ cls: `gh-chip mod-${detail.state}`, text: detail.state }, head);
    const title = createEl("h2", { cls: "gh-page-title", text: `${detail.title} ` }, head);
    createSpan({ cls: "gh-muted", text: `#${detail.number}` }, title);
    const meta = createDiv(
      {
        cls: "gh-muted",
        text: `${detail.author.login} opened ${formatRelativeDate(detail.createdAt)} · `,
      },
      head,
    );
    linkButton(meta, "Open on GitHub", () => window.open(detail.url, "_blank"));
    const body = createEl("article", "gh-card", scroll);
    markdown(body, detail.body || "*No description*");
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
    textarea.value = this.comment;
    const submit = buttonEl(composer, "Comment", "mod-cta");
    submit.disabled = this.busy || !this.comment.trim();
    textarea.addEventListener("input", () => {
      this.comment = textarea.value;
      submit.disabled = this.busy || !this.comment.trim();
    });
    submit.addEventListener("click", () => void this.postComment());
  }
}

class ActionsPanel extends Panel {
  private runs: ActionRunSummary[] | null = null;
  private selected: number | null = null;
  private detail: ActionRunDetail | null = null;
  private errorText: string | null = null;

  constructor(
    root: HTMLElement,
    private readonly app: App,
    private readonly repo: GitHubRepositoryRef,
  ) {
    super(root);
    this.render();
    void this.load();
  }

  private async load(): Promise<void> {
    this.errorText = null;
    try {
      this.runs = await this.app.github.listWorkflowRuns(1, this.repo);
    } catch (error) {
      this.errorText = this.error(error);
      this.runs = [];
    }
    if (!this.dead) this.render();
  }

  private async select(id: number): Promise<void> {
    this.selected = id;
    this.detail = null;
    this.render();
    try {
      this.detail = await this.app.github.getWorkflowRun(id, this.repo);
    } catch (error) {
      this.errorText = this.error(error);
    }
    if (!this.dead && this.selected === id) this.render();
  }

  private render(): void {
    this.root.empty();
    const shell = createDiv("gh-split-panel", this.root);
    const list = createDiv("gh-split-list", shell);
    const header = panelHeader(list, "Actions", `${this.repo.owner}/${this.repo.repo}`);
    iconButton(header, "Refresh", "lucide-rotate-ccw", () => void this.load());
    if (this.errorText) createDiv({ cls: "gh-error", text: this.errorText }, list);
    if (this.runs === null) createDiv({ cls: "gh-empty", text: "Loading runs…" }, list);
    if (this.runs?.length === 0) createDiv({ cls: "gh-empty", text: "No workflow runs." }, list);
    const rows = createDiv("gh-item-list", list);
    for (const run of this.runs ?? []) {
      const row = buttonEl(
        rows,
        undefined,
        `gh-item-row${this.selected === run.id ? " is-active" : ""}`,
      );
      createSpan(`gh-ci-dot mod-${conclusionClass(run.conclusion, run.status)}`, row);
      const main = createDiv("gh-item-main", row);
      createDiv({ cls: "gh-item-title", text: run.displayTitle }, main);
      createDiv(
        {
          cls: "gh-muted",
          text: `${run.name} · #${run.runNumber} · ${run.headBranch} · ${formatRelativeDate(run.updatedAt)}`,
        },
        main,
      );
      createSpan({ cls: "gh-chip", text: run.conclusion ?? run.status }, row);
      row.addEventListener("click", () => void this.select(run.id));
    }
    const detail = createDiv("gh-split-detail", shell);
    if (!this.detail) createDiv({ cls: "gh-empty", text: "Select a workflow run" }, detail);
    else renderActionDetail(detail, this.detail);
  }
}

class FilesPanel extends Panel {
  private ref = "";
  private path = "";
  private items: RepoContentItem[] | null = null;
  private file: RepoFileContent | null = null;
  private branches: string[] = [];
  private errorText: string | null = null;

  constructor(
    root: HTMLElement,
    private readonly app: App,
    private readonly repo: GitHubRepositoryRef,
  ) {
    super(root);
    this.render();
    void this.initialize();
  }

  private async initialize(): Promise<void> {
    try {
      const [branches, defaultBranch] = await Promise.all([
        this.app.github.listBranches(this.repo),
        this.app.github.getDefaultBranch(this.repo),
      ]);
      this.branches = branches.map((branch) => branch.name);
      this.ref = defaultBranch;
      await this.loadDir("");
    } catch (error) {
      this.errorText = this.error(error);
      if (!this.dead) this.render();
    }
  }

  private async loadDir(path: string): Promise<void> {
    if (!this.ref) return;
    this.file = null;
    this.items = null;
    this.render();
    try {
      this.items = (await this.app.github.listContents(path, this.ref, this.repo))
        .slice()
        .sort((left, right) =>
          left.type === right.type
            ? left.name.localeCompare(right.name)
            : left.type === "dir"
              ? -1
              : 1,
        );
      this.path = path;
    } catch (error) {
      this.errorText = this.error(error);
      this.items = [];
    }
    if (!this.dead) this.render();
  }

  private async openItem(item: RepoContentItem): Promise<void> {
    if (item.type === "dir") return this.loadDir(item.path);
    try {
      this.file = await this.app.github.getFileContent(item.path, this.ref, this.repo);
      if (!this.dead) this.render();
    } catch (error) {
      new Notice(this.error(error));
    }
  }

  private render(): void {
    this.root.empty();
    const shell = createDiv("gh-files-panel", this.root);
    const header = panelHeader(shell, "Files");
    const crumbs = createDiv("gh-crumbs", header.firstElementChild as HTMLElement);
    linkButton(crumbs, this.repo.repo, () => void this.loadDir(""));
    const parts = this.path ? this.path.split("/") : [];
    parts.forEach((part, index) => {
      createSpan({ cls: "gh-muted", text: " / " }, crumbs);
      linkButton(crumbs, part, () => void this.loadDir(parts.slice(0, index + 1).join("/")));
    });
    const select = createEl("select", "gh-select", header);
    for (const branch of this.branches) createEl("option", { text: branch, value: branch }, select);
    select.value = this.ref;
    select.addEventListener("change", () => {
      this.ref = select.value;
      void this.loadDir("");
    });
    if (this.errorText) createDiv({ cls: "gh-error", text: this.errorText }, shell);
    const split = createDiv("gh-files-split", shell);
    const browser = createDiv("gh-file-browser", split);
    if (this.items === null) createDiv({ cls: "gh-empty", text: "Loading…" }, browser);
    for (const item of this.items ?? []) {
      const row = buttonEl(browser, undefined, "gh-file-browser-row");
      icon(row, item.type === "dir" ? "lucide-folder" : "lucide-file");
      createSpan({ text: item.name }, row);
      if (item.type === "file") createSpan({ cls: "gh-muted", text: formatSize(item.size) }, row);
      row.addEventListener("click", () => void this.openItem(item));
    }
    const content = createDiv("gh-file-content", split);
    if (!this.file) createDiv({ cls: "gh-empty", text: "Select a file to preview" }, content);
    else renderFile(content, this.file);
  }
}

class InboxPanel extends Panel {
  private items: NotificationItem[] | null = null;
  private showAll = false;
  private errorText: string | null = null;

  constructor(
    root: HTMLElement,
    private readonly app: App,
  ) {
    super(root);
    this.render();
    void this.load();
  }

  private async load(): Promise<void> {
    this.errorText = null;
    try {
      this.items = await this.app.github.listNotifications({ all: this.showAll });
    } catch (error) {
      this.errorText = this.error(error);
      this.items = [];
    }
    if (!this.dead) this.render();
  }

  private async open(item: NotificationItem): Promise<void> {
    if (item.unread) {
      await this.app.github.markNotificationRead(item.id);
      item.unread = false;
      this.render();
    }
    const match =
      item.url?.match(/\/repos\/([^/]+)\/([^/]+)\/(issues|pulls)\/(\d+)/) ??
      item.subjectUrl?.match(/\/repos\/([^/]+)\/([^/]+)\/(issues|pulls)\/(\d+)/);
    if (match) {
      const repo = { owner: match[1], repo: match[2] };
      this.app.github.setRepository(repo);
      void openPrDetail(this.app, Number(match[4]), repo);
      return;
    }
    const commit = item.url?.match(/\/repos\/([^/]+)\/([^/]+)\/commits\/([a-f0-9]+)/i);
    if (commit) {
      void this.app.workspace.getLeaf("tab").setViewState({
        type: "git-commit",
        active: true,
        state: { sha: commit[3], owner: commit[1], repo: commit[2] },
      });
      return;
    }
    if (item.repository) this.app.github.setRepository({ owner: item.owner, repo: item.repo });
    new Notice(item.title);
  }

  private render(): void {
    this.root.empty();
    const shell = createDiv("gh-commits", this.root);
    const header = panelHeader(shell, "Inbox", "GitHub notifications for your account");
    const controls = createDiv("gh-commits-controls", header);
    const check = createEl("label", { cls: "gh-check", text: " Include read" }, controls);
    const input = createEl("input", { attr: { type: "checkbox" }, prepend: true }, check);
    input.checked = this.showAll;
    input.addEventListener("change", () => {
      this.showAll = input.checked;
      void this.load();
    });
    linkButton(controls, "Mark all read", () => {
      void this.app.github.markAllNotificationsRead().then((error) => {
        if (error) new Notice(error);
        else {
          new Notice("Marked all as read");
          void this.load();
        }
      });
    });
    iconButton(controls, "Refresh", "lucide-rotate-ccw", () => void this.load());
    if (this.errorText) createDiv({ cls: "gh-error", text: this.errorText }, shell);
    if (this.items === null) createDiv({ cls: "gh-empty", text: "Loading notifications…" }, shell);
    if (this.items?.length === 0)
      createDiv({ cls: "gh-empty", text: "You're all caught up." }, shell);
    const rows = createDiv("gh-item-list", shell);
    for (const item of this.items ?? []) {
      const row = buttonEl(rows, undefined, `gh-item-row${item.unread ? " is-unread" : ""}`);
      createSpan(`gh-dot ${item.unread ? "mod-open" : ""}`, row);
      const main = createDiv("gh-item-main", row);
      createDiv({ cls: "gh-item-title", text: item.title }, main);
      createDiv(
        {
          cls: "gh-muted",
          text: `${item.repository} · ${item.type} · ${item.reason} · ${formatRelativeDate(item.updatedAt)}`,
        },
        main,
      );
      row.addEventListener("click", () => void this.open(item));
    }
  }
}

function panelHeader(parent: HTMLElement, title: string, subtitle?: string): HTMLElement {
  const header = createEl("header", "gh-panel-header", parent);
  const heading = createDiv(undefined, header);
  createEl("h1", { cls: "gh-page-title", text: title }, heading);
  if (subtitle) createEl("p", { cls: "gh-muted", text: subtitle }, heading);
  return header;
}

function buttonEl(parent: HTMLElement, text?: string, cls?: string): HTMLButtonElement {
  return createEl("button", { cls, text, attr: { type: "button" } }, parent);
}

function linkButton(parent: HTMLElement, text: string, action: () => void): HTMLButtonElement {
  const button = buttonEl(parent, text, "gh-linkish");
  button.addEventListener("click", action);
  return button;
}

function icon(parent: HTMLElement, name: string): HTMLElement {
  const span = createSpan("gh-icon", parent);
  setIcon(span, name);
  return span;
}

function iconButton(parent: HTMLElement, label: string, name: string, action: () => void): void {
  const button = createEl(
    "button",
    { cls: "clickable-icon", attr: { type: "button", "aria-label": label } },
    parent,
  );
  setIcon(button, name);
  button.addEventListener("click", action);
}

function markdown(parent: HTMLElement, text: string): void {
  const element = createDiv("markdown-rendered gh-markdown", parent);
  void MarkdownRenderer.renderMarkdown(text, element, "");
}

function renderActionDetail(parent: HTMLElement, detail: ActionRunDetail): void {
  const scroll = createDiv("gh-detail-scroll", parent);
  const head = createDiv("gh-detail-head", scroll);
  createEl("h2", { cls: "gh-page-title", text: detail.displayTitle }, head);
  const meta = createDiv(
    {
      cls: "gh-muted",
      text: `${detail.name} · ${detail.headBranch} @ ${detail.headSha.slice(0, 7)} · `,
    },
    head,
  );
  linkButton(meta, "Open on GitHub", () => window.open(detail.htmlUrl, "_blank"));
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

function renderFile(parent: HTMLElement, file: RepoFileContent): void {
  const header = createDiv("gh-preview-header", parent);
  createEl("code", { text: file.path }, header);
  createSpan({ cls: "gh-muted", text: formatSize(file.size) }, header);
  if (file.htmlUrl) linkButton(header, "GitHub", () => window.open(file.htmlUrl!, "_blank"));
  if (file.text == null)
    createDiv({ cls: "gh-empty", text: "Binary or large file — open on GitHub to view." }, parent);
  else createEl("pre", { cls: "gh-code-pre", text: file.text }, parent);
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
