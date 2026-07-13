import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { FileDiff, type FileDiffMetadata } from "@pierre/diffs";
import moment from "moment";
import { ItemView } from "../../views/ItemView";
import type { ViewStateResult } from "../../views/View";
import type { App } from "../../app/App";
import type {
  CiState,
  GitHubAuthState,
  GitHubRepositoryRef,
  PrCheck,
  PrComment,
  PrCommit,
  PrDetail,
  PrListFilter,
  PrReview,
  PrReviewComment,
  PrSummary,
} from "./types";
import type { GithubRepoListItem } from "./GitHubService";
import { fileDiffFromGithubPatch, fileDiffsFromUnifiedDiff } from "./patchUtils";
import { readGithubPrPrefs, writeGithubPrPrefs } from "./prefs";
import { ReviewSurface } from "../git/review/ReviewSurface";
import {
  fingerprintContents,
  type ReviewFile,
  type ReviewFileStatus,
} from "../git/review/reviewModel";
import { MarkdownRenderer } from "../../markdown/MarkdownRenderer";
import { setIcon } from "../../ui/Icon";
import { Notice } from "../../ui/Notice";
import { openGitReview } from "../git/review/GitReviewView";
import { openCommitDetail, openGitHubWorkspace } from "./GitHubWorkspace";

/**
 * Cloud GitHub pull-request workspace (app-owned token — no gh CLI).
 * Calibrated against real multi-file PRs (e.g. coder/ghostty-web#185).
 */

export class PrListView extends ItemView {
  static readonly VIEW_TYPE = "git-prs";
  private root: Root | null = null;

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
    this.root = createRoot(this.contentEl);
    this.root.render(<PrListPanel app={this.app} />);
  }

  async onClose(): Promise<void> {
    this.root?.unmount();
    this.root = null;
    await super.onClose();
  }
}

export class PrDetailView extends ItemView {
  static readonly VIEW_TYPE = "git-pr";
  private root: Root | null = null;
  private number: number | null = null;
  private owner: string | null = null;
  private repo: string | null = null;

  getViewType(): string {
    return PrDetailView.VIEW_TYPE;
  }
  getDisplayText(): string {
    if (this.number && this.owner && this.repo) return `${this.owner}/${this.repo}#${this.number}`;
    return this.number ? `PR #${this.number}` : "Pull request";
  }
  getIcon(): string {
    return "lucide-git-pull-request";
  }

  async onOpen(): Promise<void> {
    this.contentEl.classList.add("git-pr-view");
    this.root = createRoot(this.contentEl);
    this.renderPanel();
  }

  async setState(state: unknown, result?: ViewStateResult): Promise<void> {
    await super.setState(state, result);
    if (state && typeof state === "object") {
      const s = state as { number?: unknown; owner?: unknown; repo?: unknown };
      if (typeof s.number === "number") this.number = s.number;
      if (typeof s.owner === "string") this.owner = s.owner;
      if (typeof s.repo === "string") this.repo = s.repo;
      this.renderPanel();
      this.leaf.updateHeader();
    }
  }

  getState(): Record<string, unknown> {
    return { number: this.number, owner: this.owner, repo: this.repo };
  }

  private renderPanel(): void {
    if (!this.root || this.number === null) return;
    const repoRef =
      this.owner && this.repo ? { owner: this.owner, repo: this.repo, host: "github.com" } : null;
    this.root.render(<PrDetailPanel app={this.app} number={this.number} repo={repoRef} />);
  }

  async onClose(): Promise<void> {
    this.root?.unmount();
    this.root = null;
    await super.onClose();
  }
}

export async function openPrList(app: App): Promise<void> {
  const existing = app.workspace.getLeavesOfType(PrListView.VIEW_TYPE)[0];
  if (existing) {
    app.workspace.setActiveLeaf(existing, { focus: true });
    return;
  }
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

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

const FILTERS: { id: PrListFilter; label: string }[] = [
  { id: "open", label: "Open" },
  { id: "mine", label: "Mine" },
  { id: "review-requested", label: "Review requested" },
  { id: "all", label: "All" },
];

function PrListPanel({ app }: { app: App }): ReactNode {
  const prefs = readGithubPrPrefs();
  const [auth, setAuth] = useState<GitHubAuthState | null>(null);
  const [repo, setRepo] = useState<GitHubRepositoryRef | null>(null);
  const [pickingRepo, setPickingRepo] = useState(false);
  const [filter, setFilter] = useState<PrListFilter>(prefs.filter ?? "open");
  const [query, setQuery] = useState("");
  const [prs, setPrs] = useState<PrSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [localDirty, setLocalDirty] = useState<number | null>(null);
  const [loadingAuth, setLoadingAuth] = useState(true);
  const [loadingList, setLoadingList] = useState(false);
  const [jump, setJump] = useState("");

  const bootstrap = useCallback(async () => {
    setLoadingAuth(true);
    const [authState, active, origin] = await Promise.all([
      app.github.getAuth(),
      app.github.resolveRepository(),
      app.github.resolveOriginRepository(),
    ]);
    setAuth(authState);
    setRepo(active);
    if (!active) setPickingRepo(true);
    if (app.git.isAvailable() && (await app.git.isRepository())) {
      setLocalDirty((await app.git.status()).length);
    } else {
      setLocalDirty(null);
    }
    // Prefer origin when prefs empty and origin exists
    if (!active && origin) {
      app.github.setRepository(origin);
      setRepo(origin);
      setPickingRepo(false);
    }
    setLoadingAuth(false);
  }, [app]);

  const loadList = useCallback(async () => {
    if (!auth?.login || !repo) {
      setPrs(null);
      return;
    }
    setLoadingList(true);
    setError(null);
    try {
      setPrs(await app.github.listPullRequests(filter, repo));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPrs([]);
    } finally {
      setLoadingList(false);
    }
  }, [app, auth?.login, filter, repo]);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);
  useEffect(() => {
    void loadList();
  }, [loadList]);

  const filtered = useMemo(() => {
    if (!prs) return null;
    const q = query.trim().toLowerCase();
    if (!q) return prs;
    return prs.filter(
      (pr) =>
        pr.title.toLowerCase().includes(q) ||
        String(pr.number).includes(q) ||
        pr.author.login.toLowerCase().includes(q) ||
        pr.headRefName.toLowerCase().includes(q),
    );
  }, [prs, query]);

  const selectRepo = (next: { owner: string; repo: string }) => {
    app.github.setRepository(next);
    setRepo({ ...next, host: "github.com" });
    setPickingRepo(false);
    setPrs(null);
  };

  const openJump = () => {
    const raw = jump.trim();
    // owner/repo#123 or #123 or 123
    const full = /^([^/\s]+)\/([^#\s#]+)#(\d+)$/.exec(raw);
    const numOnly = /^#?(\d+)$/.exec(raw);
    if (full) {
      selectRepo({ owner: full[1], repo: full[2] });
      void openPrDetail(app, Number(full[3]), { owner: full[1], repo: full[2] });
      return;
    }
    if (numOnly && repo) {
      void openPrDetail(app, Number(numOnly[1]), repo);
      return;
    }
    new Notice("Use owner/repo#123 or #123");
  };

  if (loadingAuth) return <ShellSkeleton title="Pull requests" />;

  if (!auth?.hasToken || !auth.login) {
    return (
      <SignInPanel
        app={app}
        onSignedIn={(next) => {
          setAuth(next);
          void bootstrap();
        }}
      />
    );
  }

  if (pickingRepo || !repo) {
    return (
      <RepoPicker
        app={app}
        auth={auth}
        current={repo}
        onSelect={selectRepo}
        onSignOut={() => {
          app.github.clearToken();
          setAuth({ hasToken: false, login: null, avatarUrl: null, name: null });
        }}
      />
    );
  }

  return (
    <div className="git-pr-workspace">
      <header className="git-pr-toolbar">
        <div className="git-pr-toolbar-main">
          <div className="git-pr-toolbar-title-row">
            <Icon name="lucide-git-pull-request" />
            <h1 className="git-pr-toolbar-title">Pull requests</h1>
            <button
              type="button"
              className="git-pr-repo-badge tappable"
              onClick={() => setPickingRepo(true)}
              title="Switch repository"
            >
              {repo.owner}/{repo.repo}
              <Icon name="lucide-chevrons-up-down" />
            </button>
            <button
              type="button"
              className="git-pr-action"
              title="Repository workspace"
              onClick={() =>
                void openGitHubWorkspace(app, {
                  section: "commits",
                  owner: repo.owner,
                  repo: repo.repo,
                })
              }
            >
              Commits
            </button>
            <button
              type="button"
              className="git-pr-action"
              onClick={() =>
                void openGitHubWorkspace(app, {
                  section: "branches",
                  owner: repo.owner,
                  repo: repo.repo,
                })
              }
            >
              Branches
            </button>
          </div>
          <div className="git-pr-filter-tabs" role="tablist">
            {FILTERS.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={filter === item.id}
                className={`git-pr-filter-tab${filter === item.id ? " is-active" : ""}`}
                onClick={() => {
                  setFilter(item.id);
                  writeGithubPrPrefs({ filter: item.id });
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
        <div className="git-pr-toolbar-side">
          <label className="git-pr-search">
            <Icon name="lucide-search" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter title, author, branch…"
              aria-label="Filter pull requests"
            />
          </label>
          <label className="git-pr-jump">
            <input
              value={jump}
              onChange={(e) => setJump(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") openJump();
              }}
              placeholder="#123 or owner/repo#123"
              aria-label="Jump to pull request"
            />
            <button type="button" className="git-pr-action" onClick={openJump}>
              Go
            </button>
          </label>
          <AccountChip
            auth={auth}
            onSignOut={() => {
              app.github.clearToken();
              setAuth({ hasToken: false, login: null, avatarUrl: null, name: null });
              setPrs(null);
            }}
          />
          <button
            type="button"
            className="clickable-icon"
            aria-label="Refresh"
            onClick={() => void loadList()}
          >
            <Icon name="lucide-rotate-ccw" />
          </button>
        </div>
      </header>

      {localDirty != null && localDirty > 0 && (
        <button
          type="button"
          className="git-pr-local-banner"
          onClick={() =>
            void app.workspace.getLeaf("tab").setViewState({ type: "git-changes", active: true })
          }
        >
          <Icon name="lucide-file-diff" />
          <span>
            <strong>{localDirty}</strong> local change{localDirty === 1 ? "" : "s"} in this vault
          </span>
          <span className="git-pr-local-banner-action">View</span>
        </button>
      )}

      {error && (
        <div className="git-pr-error" role="alert">
          <Icon name="lucide-alert-circle" />
          <span>{error}</span>
          <button type="button" className="git-pr-action" onClick={() => void loadList()}>
            Retry
          </button>
        </div>
      )}

      {(loadingList || filtered === null) && !error && <ListSkeleton />}

      {filtered && filtered.length === 0 && !loadingList && !error && (
        <EmptyState
          icon="lucide-git-pull-request"
          title="No pull requests"
          body={
            query
              ? "Nothing matches this filter."
              : `No ${filter === "all" ? "" : filter + " "}pull requests in ${repo.owner}/${repo.repo}.`
          }
        />
      )}

      {filtered && filtered.length > 0 && (
        <div className="git-pr-list" role="list">
          <div className="git-pr-list-count">
            {filtered.length} pull request{filtered.length === 1 ? "" : "s"}
          </div>
          {filtered.map((pr) => (
            <button
              key={pr.number}
              type="button"
              className="git-pr-row"
              role="listitem"
              onClick={() => void openPrDetail(app, pr.number, repo)}
            >
              <span className={`git-pr-state-icon mod-${pr.isDraft ? "draft" : pr.state}`}>
                <Icon name="lucide-git-pull-request" />
              </span>
              <Avatar actor={pr.author} size={28} />
              <span className="git-pr-row-main">
                <span className="git-pr-row-title-line">
                  <span className="git-pr-row-title">{pr.title}</span>
                  {pr.labels.slice(0, 4).map((label) => (
                    <span
                      key={label.name}
                      className="git-pr-label"
                      style={{ ["--label-color" as string]: `#${label.color}` }}
                    >
                      {label.name}
                    </span>
                  ))}
                </span>
                <span className="git-pr-row-meta">
                  <span className="git-pr-row-number">#{pr.number}</span>
                  {" · "}
                  <strong>{pr.author.login}</strong>
                  {" · "}
                  <code className="git-pr-branch">{pr.headRefName}</code>
                  <span className="git-pr-arrow">→</span>
                  <code className="git-pr-branch">{pr.baseRefName}</code>
                  {" · "}
                  {moment(pr.updatedAt).fromNow()}
                </span>
              </span>
              <span className="git-pr-row-side">
                {(pr.additions > 0 || pr.deletions > 0) && (
                  <span className="git-pr-diffstat">
                    <ins>+{pr.additions}</ins> <del>−{pr.deletions}</del>
                  </span>
                )}
                {pr.changedFiles > 0 && (
                  <span className="git-pr-file-count">{pr.changedFiles} files</span>
                )}
                <StateChip state={pr.state} isDraft={pr.isDraft} />
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

function PrDetailPanel({
  app,
  number,
  repo: repoProp,
}: {
  app: App;
  number: number;
  repo: GitHubRepositoryRef | null;
}): ReactNode {
  const [detail, setDetail] = useState<PrDetail | null>(null);
  const [repo, setRepo] = useState<GitHubRepositoryRef | null>(repoProp);
  const [tab, setTab] = useState<"conversation" | "commits" | "files">("files");
  const [error, setError] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [filesMode, setFilesMode] = useState<"tree" | "review">("tree");
  const [fileQuery, setFileQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [unifiedDiff, setUnifiedDiff] = useState("");
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeMethod, setMergeMethod] = useState<"merge" | "squash" | "rebase">("squash");
  const [mergeBusy, setMergeBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const active = repoProp ?? (await app.github.resolveRepository());
      if (!active) throw new Error("No repository selected");
      setRepo(active);
      const [view, diff] = await Promise.all([
        app.github.getPullRequest(number, active),
        app.github.getPullRequestDiff(number, active).catch(() => ""),
      ]);
      setDetail(view);
      setUnifiedDiff(diff);
      setSelectedPath((prev) =>
        prev && view.files.some((f) => f.path === prev) ? prev : (view.files[0]?.path ?? null),
      );
    } catch (err) {
      setDetail(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [app, number, repoProp]);

  useEffect(() => {
    void load();
  }, [load]);

  const patchByPath = useMemo(() => {
    const map = new Map<string, FileDiffMetadata>();
    for (const file of fileDiffsFromUnifiedDiff(unifiedDiff)) {
      map.set(file.name, file);
    }
    return map;
  }, [unifiedDiff]);

  const reviewFiles = useMemo<ReviewFile[]>(() => {
    if (!detail) return [];
    return detail.files.map((file) => {
      const fileDiff = patchByPath.get(file.path) ?? fileDiffFromGithubPatch(file.path, file.patch);
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
  }, [detail, patchByPath]);

  const visibleFiles = useMemo(() => {
    if (!detail) return [];
    const q = fileQuery.trim().toLowerCase();
    return q ? detail.files.filter((f) => f.path.toLowerCase().includes(q)) : detail.files;
  }, [detail, fileQuery]);

  const submitInlineReview = useCallback(
    async (
      event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT",
      body: string,
      comments: { path: string; line: number; side: "additions" | "deletions"; body: string }[],
    ) => {
      const err = await app.github.submitReview(number, event, body, comments, repo ?? undefined);
      if (!err) void load();
      return err;
    },
    [app, load, number, repo],
  );

  if (loading && !detail) return <ShellSkeleton title={`PR #${number}`} />;

  if (error && !detail) {
    return (
      <EmptyState
        icon="lucide-alert-circle"
        title={`Could not load PR #${number}`}
        body={error}
        actionLabel="Retry"
        onAction={() => void load()}
      />
    );
  }

  if (!detail || !repo) return null;

  const selectedFile = detail.files.find((f) => f.path === selectedPath) ?? detail.files[0] ?? null;
  const selectedMeta = selectedFile
    ? (patchByPath.get(selectedFile.path) ??
      fileDiffFromGithubPatch(selectedFile.path, selectedFile.patch))
    : null;

  const timeline = buildTimeline(detail);

  return (
    <div className="git-pr-detail">
      <header className="git-pr-header">
        <div className="git-pr-breadcrumb">
          <button type="button" className="git-pr-action" onClick={() => void openPrList(app)}>
            ← Pull requests
          </button>
          <span className="git-pr-repo-badge">
            {repo.owner}/{repo.repo}
          </span>
        </div>
        <div className="git-pr-title-row">
          <h2 className="git-pr-title">
            {detail.title}
            <span className="git-pr-number">#{detail.number}</span>
          </h2>
          <div className="git-pr-header-actions">
            {detail.state === "open" && !detail.isDraft && (
              <button
                type="button"
                className="mod-cta git-pr-action"
                disabled={detail.mergeable === false}
                title={
                  detail.mergeable === false ? "Resolve conflicts first" : "Merge pull request"
                }
                onClick={() => setMergeOpen((o) => !o)}
              >
                Merge
              </button>
            )}
            <button
              type="button"
              className="git-pr-action"
              onClick={() => window.open(detail.url, "_blank")}
            >
              Open on GitHub
            </button>
            <button type="button" className="git-pr-action" onClick={() => void load()}>
              Refresh
            </button>
          </div>
        </div>
        {mergeOpen && detail.state === "open" && (
          <div className="git-pr-merge-box">
            <div className="git-pr-merge-methods">
              {(["squash", "merge", "rebase"] as const).map((method) => (
                <label key={method} className="git-pr-merge-option">
                  <input
                    type="radio"
                    name="merge-method"
                    checked={mergeMethod === method}
                    onChange={() => setMergeMethod(method)}
                  />
                  {method === "squash"
                    ? "Squash and merge"
                    : method === "merge"
                      ? "Create a merge commit"
                      : "Rebase and merge"}
                </label>
              ))}
            </div>
            <div className="git-pr-merge-actions">
              <button type="button" className="git-pr-action" onClick={() => setMergeOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="mod-cta"
                disabled={mergeBusy || detail.mergeable === false}
                onClick={() => {
                  void (async () => {
                    setMergeBusy(true);
                    const result = await app.github.mergePullRequest(
                      number,
                      { method: mergeMethod, commitTitle: detail.title },
                      repo ?? undefined,
                    );
                    setMergeBusy(false);
                    if ("error" in result) {
                      new Notice(`Merge failed: ${result.error}`);
                      return;
                    }
                    new Notice(result.message || "Merged");
                    setMergeOpen(false);
                    void load();
                  })();
                }}
              >
                {mergeBusy ? "Merging…" : "Confirm merge"}
              </button>
            </div>
          </div>
        )}
        <div className="git-pr-meta-row">
          <StateChip state={detail.state} isDraft={detail.isDraft} />
          {detail.ciState && <CiChip state={detail.ciState} />}
          {detail.mergeable === false && (
            <span className="git-pr-chip mod-conflict">Conflicts</span>
          )}
          {detail.mergeStateStatus &&
            detail.mergeStateStatus !== "clean" &&
            detail.mergeable !== false && (
              <span className="git-pr-chip">{detail.mergeStateStatus}</span>
            )}
          <span className="git-pr-row-meta">
            <Avatar actor={detail.author} size={18} />
            <strong>{detail.author.login}</strong>
            {" wants to merge "}
            <code className="git-pr-branch">{detail.headRefName}</code>
            <span className="git-pr-arrow">→</span>
            <code className="git-pr-branch">{detail.baseRefName}</code>
          </span>
          <span className="git-pr-diffstat">
            <ins>+{detail.additions}</ins> <del>−{detail.deletions}</del>
            {" · "}
            {detail.files.length} files
          </span>
        </div>
      </header>

      <div className="git-pr-body-layout">
        <div className="git-pr-main">
          <div className="git-pr-tabs" role="tablist">
            <TabButton active={tab === "files"} onClick={() => setTab("files")}>
              Files
              <span className="git-pr-tab-count">{detail.files.length}</span>
              <span className="git-pr-diffstat">
                <ins>+{detail.additions}</ins> <del>−{detail.deletions}</del>
              </span>
            </TabButton>
            <TabButton active={tab === "conversation"} onClick={() => setTab("conversation")}>
              Conversation
              <span className="git-pr-tab-count">{timeline.length}</span>
            </TabButton>
            <TabButton active={tab === "commits"} onClick={() => setTab("commits")}>
              Commits
              <span className="git-pr-tab-count">{detail.commits.length}</span>
            </TabButton>
          </div>

          {tab === "files" && (
            <div className="git-pr-files">
              <div className="git-pr-files-toolbar">
                <label className="git-pr-search git-pr-file-search">
                  <Icon name="lucide-search" />
                  <input
                    value={fileQuery}
                    onChange={(e) => setFileQuery(e.target.value)}
                    placeholder="Filter files…"
                  />
                </label>
                <div className="git-pr-files-mode">
                  <button
                    type="button"
                    className={filesMode === "tree" ? "is-active" : ""}
                    onClick={() => setFilesMode("tree")}
                  >
                    File tree
                  </button>
                  <button
                    type="button"
                    className={filesMode === "review" ? "is-active" : ""}
                    onClick={() => setFilesMode("review")}
                  >
                    Full review
                  </button>
                </div>
              </div>
              {filesMode === "review" ? (
                reviewFiles.length === 0 ? (
                  <div className="git-pr-empty">No diff available for this pull request.</div>
                ) : (
                  <div className="git-pr-full-review">
                    <ReviewSurface
                      files={reviewFiles}
                      storageRoot={null}
                      title={`PR #${detail.number}`}
                      subtitle={detail.title}
                      review={{ onSubmit: submitInlineReview }}
                      onRefresh={() => void load()}
                    />
                  </div>
                )
              ) : (
                <div className="git-pr-files-split">
                  <aside className="git-pr-file-tree">
                    <div className="git-pr-file-tree-summary">
                      {visibleFiles.length} file{visibleFiles.length === 1 ? "" : "s"}
                      <span className="git-pr-diffstat">
                        <ins>+{detail.additions}</ins> <del>−{detail.deletions}</del>
                      </span>
                    </div>
                    {visibleFiles.map((file) => (
                      <button
                        key={file.path}
                        type="button"
                        className={`git-pr-file-row${selectedPath === file.path ? " is-active" : ""}`}
                        onClick={() => setSelectedPath(file.path)}
                      >
                        <span className={`git-pr-file-status mod-${file.status}`}>
                          {fileStatusGlyph(file.status)}
                        </span>
                        <span className="git-pr-file-name" title={file.path}>
                          {file.previousPath ? `${file.previousPath} → ${file.path}` : file.path}
                        </span>
                        <span className="git-pr-diffstat">
                          {file.additions > 0 && <ins>+{file.additions}</ins>}
                          {file.deletions > 0 && <del>−{file.deletions}</del>}
                        </span>
                      </button>
                    ))}
                    {visibleFiles.length === 0 && (
                      <div className="git-pr-empty">No files match.</div>
                    )}
                  </aside>
                  <div className="git-pr-file-preview">
                    {!selectedFile && (
                      <div className="git-pr-empty">Select a file to preview its diff.</div>
                    )}
                    {selectedFile && (
                      <PierrePatchView
                        path={selectedFile.path}
                        fileDiff={selectedMeta}
                        patch={selectedFile.patch}
                        status={selectedFile.status}
                        additions={selectedFile.additions}
                        deletions={selectedFile.deletions}
                      />
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {tab === "conversation" && (
            <div className="git-pr-conversation">
              <CommentCard
                author={detail.author}
                date={detail.createdAt}
                body={detail.body || "*No description provided.*"}
                badge="Author"
              />
              {timeline.map((item) => {
                if (item.kind === "review")
                  return <ReviewCard key={item.id} review={item.review} />;
                if (item.kind === "comment") {
                  return (
                    <CommentCard
                      key={item.id}
                      author={item.comment.author}
                      date={item.comment.createdAt}
                      body={item.comment.body}
                    />
                  );
                }
                return <InlineCommentCard key={item.id} comment={item.comment} />;
              })}
              {detail.checks.length > 0 && <ChecksPanel checks={detail.checks} />}
              {detail.checks.length === 0 && detail.ciState && (
                <div className="git-pr-checks">
                  <h3 className="git-pr-section-title">Status</h3>
                  <div className="git-pr-check-row">
                    <CiDot state={detail.ciState} />
                    <span>Combined status: {detail.ciState}</span>
                  </div>
                </div>
              )}
              <ReviewBar app={app} number={number} repo={repo} onDone={() => void load()} />
            </div>
          )}

          {tab === "commits" && (
            <div className="git-pr-commits">
              {detail.commits.length === 0 && (
                <div className="git-pr-empty">No commits on this pull request.</div>
              )}
              {detail.commits.map((commit) => (
                <CommitRow
                  key={commit.sha}
                  commit={commit}
                  onOpen={() => void openCommitDetail(app, commit.sha, repo)}
                />
              ))}
            </div>
          )}
        </div>

        <aside className="git-pr-sidebar">
          <SidebarSection title="Reviewers">
            {detail.requestedReviewers.length === 0 && detail.reviews.length === 0 && (
              <span className="git-pr-sidebar-empty">No reviewers</span>
            )}
            {detail.requestedReviewers.map((actor) => (
              <div key={`req-${actor.login}`} className="git-pr-sidebar-actor">
                <Avatar actor={actor} size={20} />
                <span>{actor.login}</span>
                <span className="git-pr-chip">Awaiting</span>
              </div>
            ))}
            {detail.reviews
              .filter((r) => r.state === "APPROVED" || r.state === "CHANGES_REQUESTED")
              .map((review) => (
                <div key={review.id} className="git-pr-sidebar-actor">
                  <Avatar actor={review.author} size={20} />
                  <span>{review.author.login}</span>
                  <span className={`git-pr-chip mod-${review.state.toLowerCase()}`}>
                    {review.state === "APPROVED" ? "Approved" : "Changes"}
                  </span>
                </div>
              ))}
          </SidebarSection>
          <SidebarSection title="Assignees">
            {detail.assignees.length === 0 && (
              <span className="git-pr-sidebar-empty">No one assigned</span>
            )}
            {detail.assignees.map((actor) => (
              <div key={actor.login} className="git-pr-sidebar-actor">
                <Avatar actor={actor} size={20} />
                <span>{actor.login}</span>
              </div>
            ))}
          </SidebarSection>
          <SidebarSection title="Labels">
            {detail.labels.length === 0 && <span className="git-pr-sidebar-empty">None yet</span>}
            <div className="git-pr-label-list">
              {detail.labels.map((label) => (
                <span
                  key={label.name}
                  className="git-pr-label"
                  style={{ ["--label-color" as string]: `#${label.color}` }}
                >
                  {label.name}
                </span>
              ))}
            </div>
          </SidebarSection>
          <SidebarSection title="Milestone">
            {detail.milestone ? (
              <button
                type="button"
                className="git-pr-sidebar-link"
                onClick={() => window.open(detail.milestone!.url, "_blank")}
              >
                {detail.milestone.title}
              </button>
            ) : (
              <span className="git-pr-sidebar-empty">No milestone</span>
            )}
          </SidebarSection>
          <SidebarSection title="Local vault">
            <button
              type="button"
              className="git-pr-action mod-block"
              onClick={() => void openGitReview(app)}
            >
              Review working tree
            </button>
            <button
              type="button"
              className="git-pr-action mod-block"
              onClick={() =>
                void app.workspace
                  .getLeaf("tab")
                  .setViewState({ type: "git-changes", active: true })
              }
            >
              Open local changes
            </button>
          </SidebarSection>
        </aside>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Repo picker / sign-in
// ---------------------------------------------------------------------------

function RepoPicker({
  app,
  auth,
  current,
  onSelect,
  onSignOut,
}: {
  app: App;
  auth: GitHubAuthState;
  current: GitHubRepositoryRef | null;
  onSelect: (repo: { owner: string; repo: string }) => void;
  onSignOut: () => void;
}): ReactNode {
  const [manual, setManual] = useState(current ? `${current.owner}/${current.repo}` : "");
  const [repos, setRepos] = useState<GithubRepoListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [origin, setOrigin] = useState<GitHubRepositoryRef | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [list, originRepo] = await Promise.all([
          app.github.listUserRepositories(),
          app.github.resolveOriginRepository(),
        ]);
        setRepos(list);
        setOrigin(originRepo);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setRepos([]);
      }
    })();
  }, [app]);

  const filtered = useMemo(() => {
    if (!repos) return null;
    const q = query.trim().toLowerCase();
    if (!q) return repos;
    return repos.filter(
      (r) =>
        r.fullName.toLowerCase().includes(q) || (r.description ?? "").toLowerCase().includes(q),
    );
  }, [repos, query]);

  const applyManual = () => {
    const m = /^([^/\s]+)\/([^/\s]+)$/.exec(manual.trim().replace(/\.git$/i, ""));
    if (!m) {
      new Notice("Enter owner/repo");
      return;
    }
    onSelect({ owner: m[1], repo: m[2] });
  };

  return (
    <div className="git-pr-workspace">
      <header className="git-pr-toolbar">
        <div className="git-pr-toolbar-title-row">
          <Icon name="lucide-github" />
          <h1 className="git-pr-toolbar-title">Choose a repository</h1>
        </div>
        <AccountChip auth={auth} onSignOut={onSignOut} />
      </header>
      <div className="git-pr-repo-picker">
        <section className="git-pr-repo-picker-card">
          <h2>Open repository</h2>
          <p className="git-pr-muted">
            Cloud-first: browse any GitHub repo your token can read. Local git is optional.
          </p>
          <label className="git-pr-signin-field">
            <span>owner/repo</span>
            <div className="git-pr-manual-row">
              <input
                value={manual}
                onChange={(e) => setManual(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") applyManual();
                }}
                placeholder="coder/ghostty-web"
                spellCheck={false}
              />
              <button type="button" className="mod-cta" onClick={applyManual}>
                Open
              </button>
            </div>
          </label>
          {origin && (
            <button type="button" className="git-pr-origin-btn" onClick={() => onSelect(origin)}>
              <Icon name="lucide-git-branch" />
              Use vault origin:{" "}
              <strong>
                {origin.owner}/{origin.repo}
              </strong>
            </button>
          )}
          <button
            type="button"
            className="git-pr-origin-btn"
            onClick={() => {
              setManual("coder/ghostty-web");
              onSelect({ owner: "coder", repo: "ghostty-web" });
            }}
          >
            <Icon name="lucide-star" />
            Example: coder/ghostty-web (your open PR #185)
          </button>
        </section>

        <section className="git-pr-repo-picker-card git-pr-repo-list-card">
          <div className="git-pr-repo-list-header">
            <h2>Your repositories</h2>
            <label className="git-pr-search">
              <Icon name="lucide-search" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter…"
              />
            </label>
          </div>
          {error && <div className="git-pr-error">{error}</div>}
          {filtered === null && <ListSkeleton />}
          {filtered && filtered.length === 0 && (
            <div className="git-pr-empty">No repositories found for this token.</div>
          )}
          {filtered && filtered.length > 0 && (
            <div className="git-pr-repo-list">
              {filtered.map((item) => (
                <button
                  key={item.fullName}
                  type="button"
                  className="git-pr-repo-row"
                  onClick={() => onSelect({ owner: item.owner, repo: item.repo })}
                >
                  <span className="git-pr-repo-row-name">
                    {item.fullName}
                    {item.private && <span className="git-pr-chip">Private</span>}
                  </span>
                  {item.description && <span className="git-pr-row-meta">{item.description}</span>}
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function SignInPanel({
  app,
  onSignedIn,
}: {
  app: App;
  onSignedIn: (auth: GitHubAuthState) => void;
}): ReactNode {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await app.github.setToken(token);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      new Notice(`Signed in as ${result.login}`);
      onSignedIn(result);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="git-pr-signin">
      <div className="git-pr-signin-card">
        <div className="git-pr-signin-icon">
          <Icon name="lucide-github" />
        </div>
        <h2>Connect GitHub</h2>
        <p>
          Browse pull requests with an app-owned personal access token. Auth stays inside this app —
          no GitHub CLI.
        </p>
        <ol className="git-pr-signin-steps">
          <li>
            Create a classic PAT with the <code>repo</code> scope (private repos) or{" "}
            <code>public_repo</code>.
          </li>
          <li>Paste it below. Stored only in this app&apos;s secret storage on this machine.</li>
        </ol>
        <button
          type="button"
          className="git-pr-action"
          onClick={() =>
            window.open(
              "https://github.com/settings/tokens/new?scopes=repo&description=Workbench",
              "_blank",
            )
          }
        >
          Create a token on GitHub →
        </button>
        <label className="git-pr-signin-field">
          <span>Personal access token</span>
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="ghp_… or github_pat_…"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && token.trim()) void submit();
            }}
          />
        </label>
        {error && (
          <div className="git-pr-error" role="alert">
            {error}
          </div>
        )}
        <button
          type="button"
          className="mod-cta git-pr-signin-submit"
          disabled={busy || !token.trim()}
          onClick={() => void submit()}
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Diff preview (pierre FileDiff)
// ---------------------------------------------------------------------------

function PierrePatchView({
  path,
  fileDiff,
  patch,
  status,
  additions,
  deletions,
}: {
  path: string;
  fileDiff: FileDiffMetadata | null;
  patch: string | null;
  status: string;
  additions: number;
  deletions: number;
}): ReactNode {
  const hostRef = useRef<HTMLDivElement>(null);
  const diffRef = useRef<FileDiff | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.replaceChildren();
    diffRef.current = null;

    const meta = fileDiff ?? fileDiffFromGithubPatch(path, patch);
    if (!meta) {
      const empty = host.ownerDocument.createElement("div");
      empty.className = "git-pr-empty";
      empty.textContent = patch
        ? "Could not parse patch for highlighting."
        : "No patch available (binary, generated, or too large for the API).";
      if (patch) {
        const pre = host.ownerDocument.createElement("pre");
        pre.className = "git-pr-patch-pre";
        pre.textContent = patch;
        host.append(empty, pre);
      } else {
        host.appendChild(empty);
      }
      return;
    }

    const wrapper = host.ownerDocument.createElement("div");
    wrapper.className = "git-pr-pierre-host";
    host.appendChild(wrapper);
    try {
      // jsdom (unit tests) lacks ResizeObserver — fall back to plain patch text.
      if (typeof (globalThis as { ResizeObserver?: unknown }).ResizeObserver === "undefined") {
        throw new Error("ResizeObserver unavailable");
      }
      const diff = new FileDiff({
        diffStyle: "unified",
        themeType: document.body.classList.contains("theme-dark") ? "dark" : "light",
        disableFileHeader: true,
      });
      diff.render({ fileDiff: meta, containerWrapper: wrapper });
      diffRef.current = diff;
    } catch {
      const pre = host.ownerDocument.createElement("pre");
      pre.className = "git-pr-patch-pre";
      pre.textContent = patch ?? "";
      host.replaceChildren(pre);
    }
    return () => {
      diffRef.current = null;
      host.replaceChildren();
    };
  }, [path, fileDiff, patch]);

  return (
    <div className="git-pr-file-preview-inner">
      <div className="git-pr-file-preview-header">
        <span className={`git-pr-file-status mod-${status}`}>{fileStatusGlyph(status)}</span>
        <code>{path}</code>
        <span className="git-pr-diffstat">
          {additions > 0 && <ins>+{additions}</ins>}
          {deletions > 0 && <del>−{deletions}</del>}
        </span>
      </div>
      <div ref={hostRef} className="git-pr-file-preview-body" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

function ReviewBar({
  app,
  number,
  repo,
  onDone,
}: {
  app: App;
  number: number;
  repo: GitHubRepositoryRef;
  onDone: () => void;
}): ReactNode {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (action: () => Promise<string | null>, success: string) => {
    setBusy(true);
    try {
      const error = await action();
      if (error) {
        new Notice(`Failed: ${error}`);
        return;
      }
      new Notice(success);
      setBody("");
      onDone();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="git-pr-review-bar">
      <textarea
        className="git-pr-review-input"
        placeholder="Leave a comment on this pull request"
        rows={3}
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />
      <div className="git-pr-review-actions">
        <button
          type="button"
          className="git-pr-action mod-cta"
          disabled={busy || !body.trim()}
          onClick={() =>
            void submit(() => app.github.createComment(number, body.trim(), repo), "Comment posted")
          }
        >
          Comment
        </button>
        <button
          type="button"
          className="git-pr-action mod-approve"
          disabled={busy}
          onClick={() =>
            void submit(
              () => app.github.submitReview(number, "APPROVE", body.trim(), [], repo),
              "Approved",
            )
          }
        >
          Approve
        </button>
        <button
          type="button"
          className="git-pr-action mod-request-changes"
          disabled={busy || !body.trim()}
          onClick={() =>
            void submit(
              () => app.github.submitReview(number, "REQUEST_CHANGES", body.trim(), [], repo),
              "Changes requested",
            )
          }
        >
          Request changes
        </button>
      </div>
    </div>
  );
}

function CommentCard({
  author,
  date,
  body,
  badge,
}: {
  author: { login: string; avatarUrl: string };
  date: string;
  body: string;
  badge?: string;
}): ReactNode {
  return (
    <article className="git-pr-comment">
      <header className="git-pr-comment-header">
        <Avatar actor={author} size={22} />
        <span className="git-pr-comment-author">{author.login}</span>
        {badge && <span className="git-pr-chip">{badge}</span>}
        <span className="git-pr-comment-date">{moment(date).fromNow()}</span>
      </header>
      <Markdown text={body} />
    </article>
  );
}

function ReviewCard({ review }: { review: PrReview }): ReactNode {
  if (!review.body && review.state === "COMMENTED") return null;
  return (
    <article className={`git-pr-comment git-pr-review-card mod-${review.state.toLowerCase()}`}>
      <header className="git-pr-comment-header">
        <Avatar actor={review.author} size={22} />
        <span className="git-pr-comment-author">{review.author.login}</span>
        <span className={`git-pr-chip mod-${review.state.toLowerCase()}`}>
          {prettyReviewState(review.state)}
        </span>
        {review.submittedAt && (
          <span className="git-pr-comment-date">{moment(review.submittedAt).fromNow()}</span>
        )}
      </header>
      {review.body ? (
        <Markdown text={review.body} />
      ) : (
        <div className="git-pr-markdown git-pr-muted">No review body.</div>
      )}
    </article>
  );
}

function InlineCommentCard({ comment }: { comment: PrReviewComment }): ReactNode {
  return (
    <article className="git-pr-inline-comment">
      <header className="git-pr-comment-header">
        <Avatar actor={comment.author} size={18} />
        <span className="git-pr-comment-author">{comment.author.login}</span>
        <code className="git-pr-inline-path">
          {comment.path}
          {comment.line != null ? `:${comment.line}` : ""}
        </code>
        <span className="git-pr-comment-date">{moment(comment.createdAt).fromNow()}</span>
      </header>
      {comment.diffHunk && <pre className="git-pr-diff-hunk">{comment.diffHunk}</pre>}
      <Markdown text={comment.body} />
    </article>
  );
}

function CommitRow({ commit, onOpen }: { commit: PrCommit; onOpen?: () => void }): ReactNode {
  return (
    <div
      className="git-pr-commit-row tappable"
      onClick={onOpen}
      role={onOpen ? "button" : undefined}
    >
      <Avatar actor={commit.author} size={22} />
      <div className="git-pr-commit-main">
        <div className="git-pr-commit-headline">{commit.messageHeadline}</div>
        <div className="git-pr-row-meta">
          {commit.author.login} · {moment(commit.committedDate).fromNow()}
        </div>
      </div>
      <code className="git-pr-commit-sha">{commit.shortSha}</code>
      <button
        type="button"
        className="clickable-icon"
        aria-label="Open on GitHub"
        onClick={(e) => {
          e.stopPropagation();
          window.open(commit.url, "_blank");
        }}
      >
        <Icon name="lucide-external-link" />
      </button>
    </div>
  );
}

function ChecksPanel({ checks }: { checks: PrCheck[] }): ReactNode {
  return (
    <section className="git-pr-checks">
      <h3 className="git-pr-section-title">Checks</h3>
      <div className="git-pr-checks-list">
        {checks.map((check, index) => (
          <div key={`${check.name}-${index}`} className="git-pr-check-row">
            <CiDot state={conclusionToCi(check.conclusion, check.status)} />
            <span className="git-pr-check-name">{check.name}</span>
            <span className="git-pr-row-meta">{check.conclusion ?? check.status}</span>
            {check.detailsUrl && (
              <button
                type="button"
                className="clickable-icon"
                aria-label="Details"
                onClick={() => window.open(check.detailsUrl!, "_blank")}
              >
                <Icon name="lucide-external-link" />
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function SidebarSection({ title, children }: { title: string; children: ReactNode }): ReactNode {
  return (
    <section className="git-pr-sidebar-section">
      <h3 className="git-pr-sidebar-title">{title}</h3>
      <div className="git-pr-sidebar-body">{children}</div>
    </section>
  );
}

function AccountChip({
  auth,
  onSignOut,
}: {
  auth: GitHubAuthState;
  onSignOut: () => void;
}): ReactNode {
  return (
    <div className="git-pr-account">
      {auth.avatarUrl ? (
        <img className="git-pr-avatar" src={auth.avatarUrl} alt="" width={20} height={20} />
      ) : (
        <Icon name="lucide-user" />
      )}
      <span>{auth.login}</span>
      <button type="button" className="git-pr-action" onClick={onSignOut}>
        Sign out
      </button>
    </div>
  );
}

function Avatar({
  actor,
  size,
}: {
  actor: { login: string; avatarUrl: string };
  size: number;
}): ReactNode {
  if (actor.avatarUrl) {
    return (
      <img
        className="git-pr-avatar"
        src={actor.avatarUrl}
        alt=""
        width={size}
        height={size}
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span className="git-pr-avatar-fallback" style={{ width: size, height: size }}>
      {actor.login.slice(0, 1).toUpperCase()}
    </span>
  );
}

function Markdown({ text }: { text: string }): ReactNode {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.replaceChildren();
    void MarkdownRenderer.renderMarkdown(text, el, "");
  }, [text]);
  return <div className="markdown-rendered git-pr-markdown" ref={ref} />;
}

function Icon({ name }: { name: string }): ReactNode {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (ref.current) setIcon(ref.current, name);
  }, [name]);
  return <span className="git-pr-icon" ref={ref} />;
}

function StateChip({ state, isDraft }: { state: string; isDraft: boolean }): ReactNode {
  return (
    <span className={`git-pr-chip mod-${isDraft ? "draft" : state}`}>
      {isDraft ? "Draft" : state}
    </span>
  );
}

function CiChip({ state }: { state: CiState }): ReactNode {
  const labels: Record<CiState, string> = {
    success: "Checks passing",
    pending: "Checks pending",
    failure: "Checks failing",
    error: "Checks error",
    neutral: "Checks neutral",
    unknown: "Checks",
  };
  return (
    <span className={`git-pr-chip mod-ci-${state}`}>
      <CiDot state={state} />
      {labels[state]}
    </span>
  );
}

function CiDot({ state }: { state: CiState }): ReactNode {
  return <span className={`git-pr-ci-dot mod-${state}`} title={state} aria-label={state} />;
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}): ReactNode {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={`git-pr-tab${active ? " is-active" : ""}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function EmptyState({
  icon,
  title,
  body,
  actionLabel,
  onAction,
}: {
  icon: string;
  title: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
}): ReactNode {
  return (
    <div className="git-pr-empty-state">
      <div className="git-pr-empty-icon">
        <Icon name={icon} />
      </div>
      <h2>{title}</h2>
      <p>{body}</p>
      {actionLabel && onAction && (
        <button type="button" className="mod-cta" onClick={onAction}>
          {actionLabel}
        </button>
      )}
    </div>
  );
}

function ShellSkeleton({ title }: { title: string }): ReactNode {
  return (
    <div className="git-pr-workspace">
      <header className="git-pr-toolbar">
        <h1 className="git-pr-toolbar-title">{title}</h1>
      </header>
      <ListSkeleton />
    </div>
  );
}

function ListSkeleton(): ReactNode {
  return (
    <div className="git-pr-skeleton" aria-busy="true">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="git-pr-skeleton-row" />
      ))}
    </div>
  );
}

type TimelineItem =
  | { kind: "review"; id: string; at: string; review: PrReview }
  | { kind: "comment"; id: string; at: string; comment: PrComment }
  | { kind: "inline"; id: string; at: string; comment: PrReviewComment };

function buildTimeline(detail: PrDetail): TimelineItem[] {
  const items: TimelineItem[] = [
    ...detail.reviews.map((review) => ({
      kind: "review" as const,
      id: `review-${review.id}`,
      at: review.submittedAt ?? "",
      review,
    })),
    ...detail.comments.map((comment) => ({
      kind: "comment" as const,
      id: `comment-${comment.id}`,
      at: comment.createdAt,
      comment,
    })),
    ...detail.reviewComments.map((comment) => ({
      kind: "inline" as const,
      id: `inline-${comment.id}`,
      at: comment.createdAt,
      comment,
    })),
  ];
  return items.sort((a, b) => (a.at || "").localeCompare(b.at || ""));
}

function prettyReviewState(state: string): string {
  switch (state) {
    case "APPROVED":
      return "Approved";
    case "CHANGES_REQUESTED":
      return "Changes requested";
    case "COMMENTED":
      return "Commented";
    case "DISMISSED":
      return "Dismissed";
    default:
      return state;
  }
}

function conclusionToCi(conclusion: string | null, status: string): CiState {
  const value = (conclusion ?? status).toLowerCase();
  if (value === "success" || value === "completed") return "success";
  if (value === "failure" || value === "timed_out" || value === "action_required") return "failure";
  if (value === "cancelled" || value === "error" || value === "startup_failure") return "error";
  if (value === "pending" || value === "queued" || value === "in_progress" || value === "waiting")
    return "pending";
  if (value === "neutral" || value === "skipped") return "neutral";
  return "unknown";
}

function fileStatusGlyph(status: string): string {
  switch (status) {
    case "added":
      return "A";
    case "removed":
      return "D";
    case "renamed":
      return "R";
    default:
      return "M";
  }
}

function statusFromGithub(status: string): ReviewFileStatus {
  if (status === "added") return "added";
  if (status === "removed") return "deleted";
  if (status === "renamed") return "renamed";
  return "modified";
}
