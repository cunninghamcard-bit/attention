import { CodeView } from "@pierre/diffs";
import { createDiv, createEl, createSpan } from "../../dom/dom";
import { highlightWorkers } from "../../ui/highlightWorkers";
import { MarkdownRenderer } from "../../markdown/MarkdownRenderer";
import { getFileTypeInfo } from "../../ui/FileTypeIcon";
import { Notice } from "../../ui/Notice";
import { ItemView } from "../../views/ItemView";
import type { ViewStateResult } from "../../views/View";
import { formatRelativeDate } from "../git/relativeDate";
import { GITHUB_VIEW, type GitHubDetailTarget } from "./open";
import type {
  ActionRunDetail,
  GitHubActor,
  GitHubRepositoryRef,
  IssueDetail,
  IssueTimelineEvent,
  RepoFileContent,
} from "./types";
import { composer } from "../../ui/Composer";
import { avatar, linkButton, openInSystemBrowser } from "./widgets";

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
  /** One in-flight write at a time (comment or close/reopen) — see the guard
   * comment above postComment. */
  private submitting = false;
  private request = 0;
  private codeView: CodeView | null = null;
  /** The header's Close/Reopen action. `addAction` prepends a fresh button
   * every call, so the old one is dropped before a reload adds the next. */
  private stateAction: HTMLElement | null = null;

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
    // A file tab gets the host's real icon for its type, the same resolver
    // `CodeFileView` uses — a remote file is still a file, and every other
    // place in the app that names one says which kind it is.
    if (this.target?.kind === "file") return getFileTypeInfo(this.target.path).icon;
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
    this.disposeCodeView();
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
    this.disposeCodeView();
    this.contentEl.empty();
    // Runs and files have no state to toggle, and a failed load has nothing to
    // act on: clear first, and only an issue puts it back.
    this.setStateAction(null);
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
    // The OMG header shape: chip and number on a small top row, the title
    // alone on its own line. A number appended inside the h1 wraps onto its
    // own orphan line the moment the title is long (owner's screenshot).
    const titleRow = createDiv("gh-detail-title-row", head);
    createSpan({ cls: `gh-chip mod-${detail.state}`, text: detail.state }, titleRow);
    createSpan(
      { cls: "gh-muted", text: `${this.target?.owner}/${this.target?.repo} #${detail.number}` },
      titleRow,
    );
    createEl("h1", { cls: "gh-page-title", text: detail.title }, head);
    const meta = createDiv(
      {
        cls: "gh-muted",
        text:
          `${detail.author.login} opened ${formatRelativeDate(detail.createdAt)}` +
          ` · updated ${formatRelativeDate(detail.updatedAt)} · `,
      },
      head,
    );
    linkButton(meta, "Open on GitHub", () => openInSystemBrowser(detail.url));

    // Body beside a meta column — the OMG issue-page shape. The column carries
    // content, not navigation, so it is not the in-page nav column the spec bans.
    this.setStateAction(detail);
    const layout = createDiv("gh-issue-layout", scroll);
    const main = createDiv("gh-issue-main", layout);
    this.renderIssueMeta(createEl("aside", "gh-issue-meta", layout), detail);

    markdown(createEl("article", "gh-card", main), detail.body || "*No description*");
    this.renderTimeline(main, detail);

    composer(main, {
      placeholder: "Leave a comment",
      initial: this.issueComment,
      onInput: (body) => {
        this.issueComment = body;
      },
      actions: [
        {
          label: "Comment",
          cls: "mod-cta",
          requireBody: true,
          run: () => void this.postComment(detail.number),
        },
      ],
    });
  }

  /** Comments and events in one chronological run. Events GitHub itself keeps
   * out of the issue body (subscribed, mentioned, referenced noise) have no
   * sentence here and are skipped rather than printed as a bare event name. */
  private renderTimeline(parent: HTMLElement, detail: IssueDetail): void {
    for (const item of detail.timeline) {
      if (item.kind === "comment") {
        const card = createEl("article", "gh-card", parent);
        const cardMeta = createDiv("gh-card-meta", card);
        createEl("strong", { text: item.author.login }, cardMeta);
        createSpan({ cls: "gh-muted", text: formatRelativeDate(item.createdAt) }, cardMeta);
        markdown(card, item.body);
        continue;
      }
      const sentence = timelineSentence(item);
      if (!sentence) continue;
      const row = createDiv("gh-timeline-event", parent);
      createSpan(`gh-timeline-dot mod-${item.event}`, row);
      createEl("strong", { text: item.actor.login }, row);
      createSpan({ text: ` ${sentence} ` }, row);
      createSpan({ cls: "gh-muted", text: formatRelativeDate(item.createdAt) }, row);
    }
  }

  /** Close/Reopen lives in the real view header (owner's call), not in the
   * body: it is a view action, and the header is where this app puts actions. */
  private setStateAction(detail: IssueDetail | null): void {
    this.stateAction?.remove();
    this.stateAction = null;
    if (!detail) return;
    const open = detail.state === "open";
    this.stateAction = this.addAction(
      open ? "lucide-circle-check" : "lucide-circle-dot",
      open ? "Close issue" : "Reopen issue",
      () => void this.setIssueState(detail.number, open ? "closed" : "open"),
    );
  }

  /** Assignees / Labels / Milestone / Participants. */
  private renderIssueMeta(parent: HTMLElement, detail: IssueDetail): void {
    const section = (label: string): HTMLElement => {
      const block = createDiv("gh-meta-section", parent);
      createDiv({ cls: "gh-meta-heading", text: label }, block);
      return block;
    };

    const assignees = section("Assignees");
    if (detail.assignees.length) for (const person of detail.assignees) person_(assignees, person);
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

    const participants = section("Participants");
    for (const person of issueParticipants(detail)) person_(participants, person);
  }

  // Write operations guard their own re-entry (the CreateIssueModal shape:
  // the flag flips before the await) — a second activation inside the round
  // trip must not create a second resource. The guard sits on the operation,
  // not on the button: disabling UI only decides whether a user can *reach*
  // a second call, not whether the call can run twice.
  private async postComment(number: number): Promise<void> {
    if (!this.issueComment.trim() || this.submitting) return;
    this.submitting = true;
    try {
      const error = await this.app.github.createIssueComment(
        number,
        this.issueComment.trim(),
        this.repo(),
      );
      if (error) return void new Notice(error);
      this.issueComment = "";
      new Notice("Comment posted");
      await this.loadTarget();
    } finally {
      this.submitting = false;
    }
  }

  private async setIssueState(number: number, state: "open" | "closed"): Promise<void> {
    if (this.submitting) return;
    this.submitting = true;
    try {
      const error = await this.app.github.updateIssueState(number, state, this.repo());
      if (error) return void new Notice(error);
      new Notice(state === "closed" ? "Issue closed" : "Issue reopened");
      await this.loadTarget();
    } finally {
      this.submitting = false;
    }
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
    if (file.text == null) {
      createDiv(
        {
          cls: "github-detail-empty",
          text: "Binary or large file — open on GitHub to view.",
        },
        this.contentEl,
      );
      return;
    }
    // The same pierre CodeView the review surface renders diffs with, in its
    // file mode: a remote blob is still code, and it gets the syntax
    // highlighting and wrapping that a bare <pre> cannot.
    this.codeView = new CodeView(
      {
        themeType: document.body.classList.contains("theme-dark") ? "dark" : "light",
        layout: { gap: 12, paddingTop: 10, paddingBottom: 10 },
      },
      highlightWorkers(),
    );
    this.codeView.setup(createDiv("gh-code-view", this.contentEl));
    this.codeView.setItems([
      { id: file.path, type: "file", file: { name: file.path, contents: file.text } },
    ]);
    this.codeView.render(true);
  }

  /** The CodeView owns workers and listeners, which emptying contentEl does not
   * reclaim — every path that replaces the content comes through here first. */
  private disposeCodeView(): void {
    this.codeView?.cleanUp();
    this.codeView = null;
  }
}

function person_(parent: HTMLElement, actor: GitHubActor): void {
  const item = createDiv("github-meta-person", parent);
  avatar(item, actor.login, actor.avatarUrl, 16);
  createSpan({ cls: "github-meta-person-login", text: actor.login }, item);
}

/** Derived, not fetched: REST exposes no participants field, so this is the
 * author plus whoever commented. GitHub's own (GraphQL) list also counts
 * people who only reacted or were assigned — they are missing here. */
function issueParticipants(detail: IssueDetail): GitHubActor[] {
  const seen = new Map<string, GitHubActor>([[detail.author.login, detail.author]]);
  for (const item of detail.timeline)
    if (item.kind === "comment" && !seen.has(item.author.login))
      seen.set(item.author.login, item.author);
  return [...seen.values()];
}

/** The events worth a line in the body, phrased the way GitHub phrases them.
 * Anything absent returns null and is skipped — an unknown event name printed
 * raw is noise, not information. */
function timelineSentence(item: IssueTimelineEvent): string | null {
  switch (item.event) {
    case "closed":
      return "closed this";
    case "reopened":
      return "reopened this";
    case "merged":
      return "merged this";
    case "labeled":
      return item.label ? `added the ${item.label.name} label` : null;
    case "unlabeled":
      return item.label ? `removed the ${item.label.name} label` : null;
    case "assigned":
      return item.assignee ? `assigned ${item.assignee.login}` : null;
    case "unassigned":
      return item.assignee ? `unassigned ${item.assignee.login}` : null;
    case "milestoned":
      return item.milestone ? `added this to ${item.milestone}` : null;
    case "demilestoned":
      return item.milestone ? `removed this from ${item.milestone}` : null;
    case "renamed":
      return item.rename ? `renamed this to ${item.rename.to}` : null;
    default:
      return null;
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
