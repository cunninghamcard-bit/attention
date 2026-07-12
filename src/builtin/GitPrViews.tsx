import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parsePatchFiles, type FileDiffMetadata } from "@pierre/diffs";
import moment from "moment";
import { ItemView } from "../views/ItemView";
import type { ViewStateResult } from "../views/View";
import type { App } from "../app/App";
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
} from "../github/types";
import { ReviewSurface } from "./review/ReviewSurface";
import { fingerprintContents, type ReviewFile, type ReviewFileStatus } from "./review/reviewModel";
import { MarkdownRenderer } from "../markdown/MarkdownRenderer";
import { setIcon } from "../ui/Icon";
import { Notice } from "../ui/Notice";
import { openGitReview } from "./review/GitReviewView";

/**
 * Cloud GitHub pull requests — app-owned token auth (no gh CLI).
 * List + detail (Conversation / Commits / Files) with Oh My GitHub–style layout.
 */

export class PrListView extends ItemView {
  static readonly VIEW_TYPE = "git-prs";
  private root: Root | null = null;

  getViewType(): string { return PrListView.VIEW_TYPE; }
  getDisplayText(): string { return "Pull requests"; }
  getIcon(): string { return "lucide-git-pull-request"; }

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

  getViewType(): string { return PrDetailView.VIEW_TYPE; }
  getDisplayText(): string { return this.number ? `PR #${this.number}` : "Pull request"; }
  getIcon(): string { return "lucide-git-pull-request"; }

  async onOpen(): Promise<void> {
    this.contentEl.classList.add("git-pr-view");
    this.root = createRoot(this.contentEl);
    this.renderPanel();
  }

  async setState(state: unknown, result?: ViewStateResult): Promise<void> {
    await super.setState(state, result);
    if (state && typeof state === "object" && typeof (state as { number?: unknown }).number === "number") {
      this.number = (state as { number: number }).number;
      this.renderPanel();
      this.leaf.updateHeader();
    }
  }

  getState(): Record<string, unknown> {
    return { number: this.number };
  }

  private renderPanel(): void {
    if (this.root && this.number !== null) this.root.render(<PrDetailPanel app={this.app} number={this.number} />);
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

export async function openPrDetail(app: App, number: number): Promise<void> {
  await app.workspace.getLeaf("tab").setViewState({ type: PrDetailView.VIEW_TYPE, active: true, state: { number } });
}

// --- List ----------------------------------------------------------------

const FILTERS: { id: PrListFilter; label: string }[] = [
  { id: "open", label: "Open" },
  { id: "mine", label: "Mine" },
  { id: "review-requested", label: "Review requested" },
  { id: "all", label: "All" },
];

function PrListPanel({ app }: { app: App }): ReactNode {
  const [auth, setAuth] = useState<GitHubAuthState | null>(null);
  const [repo, setRepo] = useState<GitHubRepositoryRef | null | undefined>(undefined);
  const [filter, setFilter] = useState<PrListFilter>("open");
  const [query, setQuery] = useState("");
  const [prs, setPrs] = useState<PrSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [localDirty, setLocalDirty] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const bootstrap = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [authState, repoRef] = await Promise.all([app.github.getAuth(), app.github.resolveRepository()]);
    setAuth(authState);
    setRepo(repoRef);
    if (app.git.isAvailable() && (await app.git.isRepository())) {
      const status = await app.git.status();
      setLocalDirty(status.length);
    } else {
      setLocalDirty(null);
    }
    setLoading(false);
  }, [app]);

  const loadList = useCallback(async () => {
    if (!auth?.login || !repo) {
      setPrs(null);
      return;
    }
    setPrs(null);
    setError(null);
    try {
      setPrs(await app.github.listPullRequests(filter));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPrs([]);
    }
  }, [app, auth?.login, filter, repo]);

  useEffect(() => { void bootstrap(); }, [bootstrap]);
  useEffect(() => { void loadList(); }, [loadList]);

  const filtered = useMemo(() => {
    if (!prs) return null;
    const q = query.trim().toLowerCase();
    if (!q) return prs;
    return prs.filter((pr) =>
      pr.title.toLowerCase().includes(q) ||
      String(pr.number).includes(q) ||
      pr.author.login.toLowerCase().includes(q) ||
      pr.headRefName.toLowerCase().includes(q));
  }, [prs, query]);

  if (loading && auth === null) {
    return <ShellSkeleton title="Pull requests" />;
  }

  if (repo === null) {
    return (
      <EmptyState
        icon="lucide-git-branch"
        title="No GitHub repository"
        body="Open a vault that is a git clone with an origin remote pointing at GitHub. Local changes still work from Git changes."
        actionLabel="Open local changes"
        onAction={() => void app.workspace.getLeaf("tab").setViewState({ type: "git-changes", active: true })}
      />
    );
  }

  if (!auth?.hasToken || !auth.login) {
    return (
      <SignInPanel
        app={app}
        repo={repo}
        invalidToken={Boolean(auth?.hasToken && !auth.login)}
        onSignedIn={(next) => {
          setAuth(next);
          void loadList();
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
            {repo && <span className="git-pr-repo-badge">{repo.owner}/{repo.repo}</span>}
          </div>
          <div className="git-pr-filter-tabs" role="tablist">
            {FILTERS.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={filter === item.id}
                className={`git-pr-filter-tab${filter === item.id ? " is-active" : ""}`}
                onClick={() => setFilter(item.id)}
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
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter by title, author, branch…"
              aria-label="Filter pull requests"
            />
          </label>
          <AccountChip auth={auth} onSignOut={() => {
            app.github.clearToken();
            setAuth({ hasToken: false, login: null, avatarUrl: null, name: null });
            setPrs(null);
          }} />
          <button type="button" className="clickable-icon" aria-label="Refresh" onClick={() => void loadList()}>
            <Icon name="lucide-rotate-ccw" />
          </button>
        </div>
      </header>

      {localDirty != null && localDirty > 0 && (
        <button
          type="button"
          className="git-pr-local-banner"
          onClick={() => void app.workspace.getLeaf("tab").setViewState({ type: "git-changes", active: true })}
        >
          <Icon name="lucide-file-diff" />
          <span><strong>{localDirty}</strong> local change{localDirty === 1 ? "" : "s"} in this vault</span>
          <span className="git-pr-local-banner-action">View</span>
        </button>
      )}

      {error && (
        <div className="git-pr-error" role="alert">
          <Icon name="lucide-alert-circle" />
          <span>{error}</span>
          <button type="button" className="git-pr-action" onClick={() => void loadList()}>Retry</button>
        </div>
      )}

      {filtered === null && !error && <ListSkeleton />}

      {filtered && filtered.length === 0 && !error && (
        <EmptyState
          icon="lucide-git-pull-request"
          title="No pull requests"
          body={query ? "Nothing matches this filter." : "There are no pull requests in this category."}
        />
      )}

      {filtered && filtered.length > 0 && (
        <div className="git-pr-list" role="list">
          {filtered.map((pr) => (
            <button
              key={pr.number}
              type="button"
              className="git-pr-row"
              role="listitem"
              onClick={() => void openPrDetail(app, pr.number)}
            >
              <span className={`git-pr-state-icon mod-${pr.isDraft ? "draft" : pr.state}`}>
                <Icon name="lucide-git-pull-request" />
              </span>
              <span className="git-pr-row-main">
                <span className="git-pr-row-title-line">
                  <span className="git-pr-row-title">{pr.title}</span>
                  {pr.labels.slice(0, 3).map((label) => (
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
                  #{pr.number} opened by <strong>{pr.author.login}</strong>
                  {" · "}
                  {pr.headRefName} → {pr.baseRefName}
                  {" · "}
                  updated {moment(pr.updatedAt).fromNow()}
                </span>
              </span>
              <span className="git-pr-row-side">
                {pr.ciState && <CiDot state={pr.ciState} />}
                {pr.changedFiles > 0 && (
                  <span className="git-pr-diffstat">
                    <ins>+{pr.additions}</ins> <del>−{pr.deletions}</del>
                  </span>
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

// --- Detail --------------------------------------------------------------

function PrDetailPanel({ app, number }: { app: App; number: number }): ReactNode {
  const [detail, setDetail] = useState<PrDetail | null>(null);
  const [patchText, setPatchText] = useState<string | null>(null);
  const [tab, setTab] = useState<"conversation" | "commits" | "files">("conversation");
  const [error, setError] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [filesMode, setFilesMode] = useState<"tree" | "review">("tree");

  const load = useCallback(async () => {
    setError(null);
    try {
      const [view, diff] = await Promise.all([
        app.github.getPullRequest(number),
        app.github.getPullRequestDiff(number).catch(() => ""),
      ]);
      setDetail(view);
      setPatchText(diff);
      if (!selectedPath && view.files[0]) setSelectedPath(view.files[0].path);
    } catch (err) {
      setDetail(null);
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [app, number, selectedPath]);

  useEffect(() => { void load(); }, [number]); // eslint-disable-line react-hooks/exhaustive-deps -- load once per PR

  const patchFiles = useMemo(() => {
    if (!patchText) return [] as FileDiffMetadata[];
    try {
      return parsePatchFiles(patchText).flatMap((patch) => patch.files);
    } catch {
      return [];
    }
  }, [patchText]);

  const reviewFiles = useMemo<ReviewFile[]>(() => {
    if (!detail) return [];
    const statByPath = new Map(detail.files.map((file) => [file.path, file]));
    if (patchFiles.length > 0) {
      return patchFiles.map((fileDiff) => {
        const stat = statByPath.get(fileDiff.name);
        return {
          path: fileDiff.name,
          status: PR_STATUS_BY_CHANGE_TYPE[fileDiff.type] ?? "modified",
          fileDiff,
          additions: stat?.additions ?? 0,
          deletions: stat?.deletions ?? 0,
          fingerprint: fingerprintContents(fileDiff.name, detail.headRefOid),
          binary: false,
        };
      });
    }
    // Fallback: synthesize empty diffs when only file list is available
    return detail.files.map((file) => ({
      path: file.path,
      status: (file.status === "added" ? "added" : file.status === "removed" ? "deleted" : file.status === "renamed" ? "renamed" : "modified") as ReviewFileStatus,
      fileDiff: {
        name: file.path,
        type: file.status === "added" ? "new" : file.status === "removed" ? "deleted" : "change",
      } as FileDiffMetadata,
      additions: file.additions,
      deletions: file.deletions,
      fingerprint: fingerprintContents(file.path, detail.headRefOid),
      binary: !file.patch,
    }));
  }, [detail, patchFiles]);

  const submitInlineReview = useCallback(
    async (event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT", body: string, comments: { path: string; line: number; side: "additions" | "deletions"; body: string }[]) => {
      const err = await app.github.submitReview(number, event, body, comments);
      if (!err) void load();
      return err;
    },
    [app, load, number],
  );

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

  if (!detail) return <ShellSkeleton title={`PR #${number}`} />;

  const selectedFile = detail.files.find((file) => file.path === selectedPath) ?? detail.files[0] ?? null;
  const selectedPatch = selectedFile
    ? patchFiles.find((file) => file.name === selectedFile.path) ?? null
    : null;

  return (
    <div className="git-pr-detail">
      <header className="git-pr-header">
        <div className="git-pr-title-row">
          <h2 className="git-pr-title">
            {detail.title}
            <span className="git-pr-number">#{detail.number}</span>
          </h2>
          <div className="git-pr-header-actions">
            <button type="button" className="git-pr-action" onClick={() => window.open(detail.url, "_blank")}>
              Open on GitHub
            </button>
            <button type="button" className="git-pr-action" onClick={() => void load()}>
              Refresh
            </button>
          </div>
        </div>
        <div className="git-pr-meta-row">
          <StateChip state={detail.state} isDraft={detail.isDraft} />
          {detail.ciState && <CiChip state={detail.ciState} />}
          {detail.mergeable === false && <span className="git-pr-chip mod-conflict">Conflicts</span>}
          <span className="git-pr-row-meta">
            <Avatar actor={detail.author} size={18} />
            <strong>{detail.author.login}</strong>
            {" wants to merge "}
            <code>{detail.headRefName}</code>
            {" into "}
            <code>{detail.baseRefName}</code>
          </span>
          <span className="git-pr-diffstat">
            <ins>+{detail.additions}</ins> <del>−{detail.deletions}</del>
            {" · "}
            {detail.changedFiles || detail.files.length} files
          </span>
        </div>
      </header>

      <div className="git-pr-body-layout">
        <div className="git-pr-main">
          <div className="git-pr-tabs" role="tablist">
            <TabButton active={tab === "conversation"} onClick={() => setTab("conversation")}>
              Conversation
              <span className="git-pr-tab-count">{detail.comments.length + detail.reviews.length}</span>
            </TabButton>
            <TabButton active={tab === "commits"} onClick={() => setTab("commits")}>
              Commits
              <span className="git-pr-tab-count">{detail.commits.length}</span>
            </TabButton>
            <TabButton active={tab === "files"} onClick={() => setTab("files")}>
              Files
              <span className="git-pr-tab-count">{detail.files.length}</span>
              <span className="git-pr-diffstat"><ins>+{detail.additions}</ins> <del>−{detail.deletions}</del></span>
            </TabButton>
          </div>

          {tab === "conversation" && (
            <div className="git-pr-conversation">
              <CommentCard author={detail.author} date={detail.createdAt} body={detail.body || "*No description provided.*"} badge="Author" />
              {detail.reviews.map((review) => (
                <ReviewCard key={review.id} review={review} />
              ))}
              {detail.comments.map((comment) => (
                <CommentCard key={comment.id} author={comment.author} date={comment.createdAt} body={comment.body} />
              ))}
              {detail.reviewComments.length > 0 && (
                <section className="git-pr-thread-section">
                  <h3 className="git-pr-section-title">Inline review comments ({detail.reviewComments.length})</h3>
                  {detail.reviewComments.map((comment) => (
                    <InlineCommentCard key={comment.id} comment={comment} />
                  ))}
                </section>
              )}
              {detail.checks.length > 0 && <ChecksPanel checks={detail.checks} />}
              <ReviewBar
                app={app}
                number={number}
                onDone={() => void load()}
              />
            </div>
          )}

          {tab === "commits" && (
            <div className="git-pr-commits">
              {detail.commits.length === 0 && <div className="git-pr-empty">No commits on this pull request.</div>}
              {detail.commits.map((commit) => (
                <CommitRow key={commit.sha} commit={commit} />
              ))}
            </div>
          )}

          {tab === "files" && (
            <div className="git-pr-files">
              <div className="git-pr-files-toolbar">
                <div className="git-pr-files-mode">
                  <button type="button" className={filesMode === "tree" ? "is-active" : ""} onClick={() => setFilesMode("tree")}>
                    File tree
                  </button>
                  <button type="button" className={filesMode === "review" ? "is-active" : ""} onClick={() => setFilesMode("review")}>
                    Full review
                  </button>
                </div>
              </div>
              {filesMode === "review" ? (
                reviewFiles.length === 0 ? (
                  <div className="git-pr-empty">No diff available.</div>
                ) : (
                  <ReviewSurface
                    files={reviewFiles}
                    storageRoot={null}
                    title={`PR #${detail.number}`}
                    subtitle={detail.title}
                    review={{ onSubmit: submitInlineReview }}
                    onRefresh={() => void load()}
                  />
                )
              ) : (
                <div className="git-pr-files-split">
                  <aside className="git-pr-file-tree">
                    {detail.files.map((file) => (
                      <button
                        key={file.path}
                        type="button"
                        className={`git-pr-file-row${selectedPath === file.path ? " is-active" : ""}`}
                        onClick={() => setSelectedPath(file.path)}
                      >
                        <span className={`git-pr-file-status mod-${file.status}`}>{fileStatusGlyph(file.status)}</span>
                        <span className="git-pr-file-name" title={file.path}>{file.path}</span>
                        <span className="git-pr-diffstat">
                          {file.additions > 0 && <ins>+{file.additions}</ins>}
                          {file.deletions > 0 && <del>−{file.deletions}</del>}
                        </span>
                      </button>
                    ))}
                  </aside>
                  <div className="git-pr-file-preview">
                    {!selectedFile && <div className="git-pr-empty">Select a file to preview its diff.</div>}
                    {selectedFile && !selectedFile.patch && !selectedPatch && (
                      <div className="git-pr-empty">
                        No patch for <code>{selectedFile.path}</code> (binary or too large).
                      </div>
                    )}
                    {selectedFile && (selectedFile.patch || selectedPatch) && (
                      <FilePatchPreview
                        path={selectedFile.path}
                        patch={selectedFile.patch}
                        fileDiff={selectedPatch}
                      />
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <aside className="git-pr-sidebar">
          <SidebarSection title="Reviewers">
            {detail.requestedReviewers.length === 0 && detail.reviews.length === 0 && (
              <span className="git-pr-sidebar-empty">No reviewers</span>
            )}
            {detail.requestedReviewers.map((actor) => (
              <div key={actor.login} className="git-pr-sidebar-actor">
                <Avatar actor={actor} size={20} />
                <span>{actor.login}</span>
                <span className="git-pr-chip">Awaiting</span>
              </div>
            ))}
            {detail.reviews.filter((r) => r.state === "APPROVED" || r.state === "CHANGES_REQUESTED").map((review) => (
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
            {detail.assignees.length === 0 && <span className="git-pr-sidebar-empty">No one assigned</span>}
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
                <span key={label.name} className="git-pr-label" style={{ ["--label-color" as string]: `#${label.color}` }}>
                  {label.name}
                </span>
              ))}
            </div>
          </SidebarSection>
          <SidebarSection title="Milestone">
            {detail.milestone ? (
              <a className="git-pr-sidebar-link" href={detail.milestone.url} onClick={(e) => { e.preventDefault(); window.open(detail.milestone!.url, "_blank"); }}>
                {detail.milestone.title}
              </a>
            ) : (
              <span className="git-pr-sidebar-empty">No milestone</span>
            )}
          </SidebarSection>
          <SidebarSection title="Local">
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
              onClick={() => void app.workspace.getLeaf("tab").setViewState({ type: "git-changes", active: true })}
            >
              Open local changes
            </button>
          </SidebarSection>
        </aside>
      </div>
    </div>
  );
}

// --- Shared UI pieces ----------------------------------------------------

function SignInPanel({
  app,
  repo,
  invalidToken,
  onSignedIn,
}: {
  app: App;
  repo: GitHubRepositoryRef | null | undefined;
  invalidToken: boolean;
  onSignedIn: (auth: GitHubAuthState) => void;
}): ReactNode {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(invalidToken ? "Saved token is invalid or expired." : null);

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
        <div className="git-pr-signin-icon"><Icon name="lucide-github" /></div>
        <h2>Connect GitHub</h2>
        <p>
          Browse pull requests for{" "}
          {repo ? <strong>{repo.owner}/{repo.repo}</strong> : "this vault"} with an app-owned
          personal access token. No GitHub CLI required — auth stays inside this app.
        </p>
        <ol className="git-pr-signin-steps">
          <li>Create a classic PAT with the <code>repo</code> scope (or fine-grained access to this repository).</li>
          <li>Paste it below. It is stored in this app&apos;s secret storage on this machine.</li>
        </ol>
        <a
          className="git-pr-action"
          href="https://github.com/settings/tokens/new?scopes=repo&description=Arkloop"
          onClick={(event) => {
            event.preventDefault();
            window.open("https://github.com/settings/tokens/new?scopes=repo&description=Arkloop", "_blank");
          }}
        >
          Create a token on GitHub →
        </a>
        <label className="git-pr-signin-field">
          <span>Personal access token</span>
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="ghp_… or github_pat_…"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && token.trim()) void submit();
            }}
          />
        </label>
        {error && <div className="git-pr-error" role="alert">{error}</div>}
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

function ReviewBar({ app, number, onDone }: { app: App; number: number; onDone: () => void }): ReactNode {
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
        placeholder="Leave a comment"
        rows={3}
        value={body}
        onChange={(event) => setBody(event.target.value)}
      />
      <div className="git-pr-review-actions">
        <button
          type="button"
          className="git-pr-action mod-cta"
          disabled={busy || !body.trim()}
          onClick={() => void submit(() => app.github.createComment(number, body.trim()), "Comment posted")}
        >
          Comment
        </button>
        <button
          type="button"
          className="git-pr-action mod-approve"
          disabled={busy}
          onClick={() => void submit(() => app.github.submitReview(number, "APPROVE", body.trim(), []), "Approved")}
        >
          Approve
        </button>
        <button
          type="button"
          className="git-pr-action mod-request-changes"
          disabled={busy || !body.trim()}
          onClick={() => void submit(() => app.github.submitReview(number, "REQUEST_CHANGES", body.trim(), []), "Changes requested")}
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
        <span className={`git-pr-chip mod-${review.state.toLowerCase()}`}>{prettyReviewState(review.state)}</span>
        {review.submittedAt && <span className="git-pr-comment-date">{moment(review.submittedAt).fromNow()}</span>}
      </header>
      {review.body ? <Markdown text={review.body} /> : <div className="git-pr-markdown git-pr-muted">No review body.</div>}
    </article>
  );
}

function InlineCommentCard({ comment }: { comment: PrReviewComment }): ReactNode {
  return (
    <article className="git-pr-inline-comment">
      <header className="git-pr-comment-header">
        <Avatar actor={comment.author} size={18} />
        <span className="git-pr-comment-author">{comment.author.login}</span>
        <code className="git-pr-inline-path">{comment.path}{comment.line != null ? `:${comment.line}` : ""}</code>
        <span className="git-pr-comment-date">{moment(comment.createdAt).fromNow()}</span>
      </header>
      {comment.diffHunk && <pre className="git-pr-diff-hunk">{comment.diffHunk}</pre>}
      <Markdown text={comment.body} />
    </article>
  );
}

function CommitRow({ commit }: { commit: PrCommit }): ReactNode {
  return (
    <div className="git-pr-commit-row">
      <Avatar actor={commit.author} size={22} />
      <div className="git-pr-commit-main">
        <div className="git-pr-commit-headline">{commit.messageHeadline}</div>
        <div className="git-pr-row-meta">
          {commit.author.login} committed {moment(commit.committedDate).fromNow()}
        </div>
      </div>
      <code className="git-pr-commit-sha">{commit.shortSha}</code>
      <button
        type="button"
        className="clickable-icon"
        aria-label="Open on GitHub"
        onClick={() => window.open(commit.url, "_blank")}
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
        {checks.map((check) => (
          <div key={`${check.name}-${check.startedAt}`} className="git-pr-check-row">
            <CiDot state={conclusionToCi(check.conclusion, check.status)} />
            <span className="git-pr-check-name">{check.name}</span>
            <span className="git-pr-row-meta">{check.conclusion ?? check.status}</span>
            {check.detailsUrl && (
              <button type="button" className="clickable-icon" aria-label="Details" onClick={() => window.open(check.detailsUrl!, "_blank")}>
                <Icon name="lucide-external-link" />
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function FilePatchPreview({
  path,
  patch,
  fileDiff,
}: {
  path: string;
  patch: string | null;
  fileDiff: FileDiffMetadata | null;
}): ReactNode {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.replaceChildren();
    if (fileDiff) {
      // Lazy: show patch text with simple highlighting when pierre FileDiff
      // isn't mounted as React; prefer readable patch dump for reliability.
    }
    const pre = el.ownerDocument.createElement("pre");
    pre.className = "git-pr-patch-pre";
    pre.textContent = patch ?? formatFileDiffFallback(fileDiff);
    el.appendChild(pre);
  }, [path, patch, fileDiff]);

  return (
    <div className="git-pr-file-preview-inner">
      <div className="git-pr-file-preview-header">
        <code>{path}</code>
      </div>
      <div ref={containerRef} className="git-pr-file-preview-body" />
    </div>
  );
}

function formatFileDiffFallback(fileDiff: FileDiffMetadata | null): string {
  if (!fileDiff) return "";
  return `// ${fileDiff.name}\n// Diff metadata loaded — open Full review for highlighted view.`;
}

function SidebarSection({ title, children }: { title: string; children: ReactNode }): ReactNode {
  return (
    <section className="git-pr-sidebar-section">
      <h3 className="git-pr-sidebar-title">{title}</h3>
      <div className="git-pr-sidebar-body">{children}</div>
    </section>
  );
}

function AccountChip({ auth, onSignOut }: { auth: GitHubAuthState; onSignOut: () => void }): ReactNode {
  return (
    <div className="git-pr-account">
      {auth.avatarUrl ? <img className="git-pr-avatar" src={auth.avatarUrl} alt="" width={20} height={20} /> : <Icon name="lucide-user" />}
      <span>{auth.login}</span>
      <button type="button" className="git-pr-action" onClick={onSignOut}>Sign out</button>
    </div>
  );
}

function Avatar({ actor, size }: { actor: { login: string; avatarUrl: string }; size: number }): ReactNode {
  if (actor.avatarUrl) {
    return <img className="git-pr-avatar" src={actor.avatarUrl} alt="" width={size} height={size} style={{ width: size, height: size }} />;
  }
  return <span className="git-pr-avatar-fallback" style={{ width: size, height: size }}>{actor.login.slice(0, 1).toUpperCase()}</span>;
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
  const label = isDraft ? "Draft" : state;
  return <span className={`git-pr-chip mod-${isDraft ? "draft" : state}`}>{label}</span>;
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

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }): ReactNode {
  return (
    <button type="button" role="tab" aria-selected={active} className={`git-pr-tab${active ? " is-active" : ""}`} onClick={onClick}>
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
      <div className="git-pr-empty-icon"><Icon name={icon} /></div>
      <h2>{title}</h2>
      <p>{body}</p>
      {actionLabel && onAction && (
        <button type="button" className="mod-cta" onClick={onAction}>{actionLabel}</button>
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
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index} className="git-pr-skeleton-row" />
      ))}
    </div>
  );
}

function prettyReviewState(state: string): string {
  switch (state) {
    case "APPROVED": return "Approved";
    case "CHANGES_REQUESTED": return "Changes requested";
    case "COMMENTED": return "Commented";
    case "DISMISSED": return "Dismissed";
    default: return state;
  }
}

function conclusionToCi(conclusion: string | null, status: string): CiState {
  const value = (conclusion ?? status).toLowerCase();
  if (value === "success" || value === "completed") return "success";
  if (value === "failure" || value === "timed_out" || value === "action_required") return "failure";
  if (value === "cancelled" || value === "error" || value === "startup_failure") return "error";
  if (value === "pending" || value === "queued" || value === "in_progress" || value === "waiting") return "pending";
  if (value === "neutral" || value === "skipped") return "neutral";
  return "unknown";
}

function fileStatusGlyph(status: string): string {
  switch (status) {
    case "added": return "A";
    case "removed": return "D";
    case "renamed": return "R";
    default: return "M";
  }
}

const PR_STATUS_BY_CHANGE_TYPE: Record<FileDiffMetadata["type"], ReviewFileStatus> = {
  change: "modified",
  "rename-pure": "renamed",
  "rename-changed": "renamed",
  new: "added",
  deleted: "deleted",
};
