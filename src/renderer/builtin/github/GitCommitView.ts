import { Keymap } from "../../app/hotkeys/Keymap";
import { createDiv, createEl, createSpan } from "../../dom/dom";
import { Notice } from "../../ui/Notice";
import { ItemView } from "../../views/ItemView";
import type { ViewStateResult } from "../../views/View";
import { formatRelativeDate } from "../git/relativeDate";
import { ReviewSurface } from "../git/review/ReviewSurface";
import { GITHUB_VIEW, openCommitDetail } from "./open";
import { toReviewFiles } from "./patchUtils";
import type { CommitDetail, GitHubRepositoryRef } from "./types";
import { linkButton, openInSystemBrowser } from "./widgets";

/** Center detail for a single cloud commit: a compact header plus the shared
 * `ReviewSurface` for the files+diff. No breadcrumb — the persistent left nav
 * is the way back. */
export class GitCommitView extends ItemView {
  static readonly VIEW_TYPE = GITHUB_VIEW.commit;

  /** A navigable center destination: `recordHistory` ignores views that do not
   * declare this, so it is required alongside `result.history` for back/forward. */
  navigation = true;

  private sha: string | null = null;
  private owner: string | null = null;
  private repoName: string | null = null;
  private surface: ReviewSurface | null = null;
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
    this.contentEl.classList.add("github-detail-view", "gh-commit-detail");
    if (this.sha) await this.loadCommit();
  }

  async setState(state: unknown, result?: ViewStateResult): Promise<void> {
    await super.setState(state, result);
    if (!state || typeof state !== "object") return;
    const previous = `${this.owner}/${this.repoName}@${this.sha}`;
    const next = state as { sha?: string; owner?: string; repo?: string };
    if (typeof next.sha === "string") this.sha = next.sha;
    if (typeof next.owner === "string") this.owner = next.owner;
    if (typeof next.repo === "string") this.repoName = next.repo;
    // Re-targeting this reused detail leaf records history (the FileView
    // pattern), so back returns to the previous commit.
    if (result && `${this.owner}/${this.repoName}@${this.sha}` !== previous) result.history = true;
    if (this.owner && this.repoName)
      this.app.github.setRepository({ owner: this.owner, repo: this.repoName });
    if (this.sha)
      this.app.github.session.select({
        kind: "commit",
        owner: this.owner,
        repo: this.repoName,
        sha: this.sha,
      });
    // Synchronous target, asynchronous load — see PrDetailView.setState.
    void this.loadCommit();
    this.leaf.updateHeader();
  }

  /** Manual reload entry (`github:refresh`) — the header has no button. */
  refresh(): void {
    void this.loadCommit();
  }

  getState(): Record<string, unknown> {
    return { sha: this.sha, owner: this.owner, repo: this.repoName };
  }

  async onClose(): Promise<void> {
    this.request += 1;
    this.surface?.destroy();
    this.surface = null;
    await super.onClose();
  }

  private async loadCommit(): Promise<void> {
    if (!this.sha) return;
    const request = ++this.request;
    this.surface?.destroy();
    this.surface = null;
    this.contentEl.empty();
    createDiv({ cls: "github-detail-empty", text: "Loading commit…" }, this.contentEl);
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
        this.app.github.getCommit(this.sha, repo),
        this.app.github.getCommitDiff(this.sha, repo).catch(() => ""),
      ]);
      if (request !== this.request) return;
      this.render(detail, diff, repo);
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

  private render(detail: CommitDetail, diff: string, repo: GitHubRepositoryRef): void {
    this.contentEl.empty();
    const header = createEl("header", "gh-commit-detail-header", this.contentEl);
    createEl("h1", { cls: "gh-page-title", text: detail.headline }, header);
    const meta = createDiv("gh-commit-meta", header);
    if (detail.author.avatarUrl)
      createEl(
        "img",
        {
          cls: "gh-avatar",
          attr: {
            src: detail.author.avatarUrl,
            alt: "",
            width: 22,
            height: 22,
          },
        },
        meta,
      );
    createEl("strong", { text: detail.author.login }, meta);
    createSpan(
      {
        cls: "gh-muted",
        text: `committed ${formatRelativeDate(detail.committedDate)}`,
      },
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
    linkButton(meta, "Open on GitHub", () => openInSystemBrowser(detail.url));
    if (detail.message.includes("\n"))
      createEl(
        "pre",
        {
          cls: "gh-commit-body",
          text: detail.message.split("\n").slice(1).join("\n").trim(),
        },
        header,
      );
    if (detail.parents.length) {
      const parents = createDiv(
        {
          cls: "gh-muted",
          text: `Parent${detail.parents.length > 1 ? "s" : ""}: `,
        },
        header,
      );
      for (const parent of detail.parents)
        linkButton(parents, parent.shortSha, (event) => {
          const openIn = Keymap.isModEvent(event);
          // Walk this tab's own history; the global opener would drive the
          // first commit leaf when a deliberate second one is open.
          if (openIn) void openCommitDetail(this.app, repo.owner, repo.repo, parent.sha, openIn);
          else
            void this.leaf.setViewState({
              type: GITHUB_VIEW.commit,
              active: true,
              state: { sha: parent.sha, owner: repo.owner, repo: repo.repo },
            });
        });
    }
    const host = createDiv("github-detail-review", this.contentEl);
    if (!detail.files.length) {
      createDiv({ cls: "github-detail-empty", text: "No files in this commit." }, host);
      return;
    }
    this.surface = new ReviewSurface(host, {
      files: toReviewFiles(detail.files, diff, detail.sha),
      storageRoot: null,
      title: `Commit ${detail.shortSha}`,
      subtitle: detail.headline,
      onRefresh: () => void this.loadCommit(),
    });
  }
}
