import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { FileDiff, type FileDiffMetadata } from "@pierre/diffs";
import moment from "moment";
import { ItemView } from "../views/ItemView";
import type { ViewStateResult } from "../views/View";
import type { App } from "../app/App";
import type {
  CommitDetail,
  CommitSummary,
  GitHubAuthState,
  GitHubBranch,
  GitHubRepositoryRef,
  GithubWorkspaceSection,
} from "../github/types";
import { fileDiffFromGithubPatch, fileDiffsFromUnifiedDiff } from "../github/patchUtils";
import { readGithubPrPrefs, writeGithubPrPrefs } from "../github/prefs";
import { setIcon } from "../ui/Icon";
import { Notice } from "../ui/Notice";
import { openGitReview } from "./review/GitReviewView";
import { ActionsPanel, FilesPanel, InboxPanel, IssuesPanel } from "./GitHubExtraPanels";

/** Avoid circular import with GitPrViews — open by view type string. */
async function openPullRequestsView(app: App): Promise<void> {
  const existing = app.workspace.getLeavesOfType("git-prs")[0];
  if (existing) {
    app.workspace.setActiveLeaf(existing, { focus: true });
    return;
  }
  await app.workspace.getLeaf("tab").setViewState({ type: "git-prs", active: true });
}

/**
 * Oh My GitHub–style repository workspace:
 * sidebar sections → Pull requests | Commits | Branches | Local
 * Commit detail is its own leaf (git-commit).
 */

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
  private root: Root | null = null;
  private section: GithubWorkspaceSection = "pulls";

  getViewType(): string { return GitHubWorkspaceView.VIEW_TYPE; }
  getDisplayText(): string {
    const prefs = readGithubPrPrefs();
    if (prefs.owner && prefs.repo) return `${prefs.owner}/${prefs.repo}`;
    return "GitHub";
  }
  getIcon(): string { return "lucide-github"; }

  async onOpen(): Promise<void> {
    this.contentEl.classList.add("gh-workspace");
    this.root = createRoot(this.contentEl);
    this.render();
  }

  async setState(state: unknown, result?: ViewStateResult): Promise<void> {
    await super.setState(state, result);
    if (state && typeof state === "object") {
      const s = state as { section?: GithubWorkspaceSection; owner?: string; repo?: string };
      if (s.section) this.section = s.section;
      if (s.owner && s.repo) this.app.github.setRepository({ owner: s.owner, repo: s.repo });
      this.render();
      this.leaf.updateHeader();
    }
  }

  getState(): Record<string, unknown> {
    const prefs = readGithubPrPrefs();
    return { section: this.section, owner: prefs.owner, repo: prefs.repo };
  }

  private render(): void {
    this.root?.render(
      <WorkspaceShell
        app={this.app}
        section={this.section}
        onSection={(section) => {
          this.section = section;
          this.render();
          this.leaf.updateHeader();
        }}
      />,
    );
  }

  async onClose(): Promise<void> {
    this.root?.unmount();
    this.root = null;
    await super.onClose();
  }
}

export class GitCommitView extends ItemView {
  static readonly VIEW_TYPE = "git-commit";
  private root: Root | null = null;
  private sha: string | null = null;
  private owner: string | null = null;
  private repo: string | null = null;

  getViewType(): string { return GitCommitView.VIEW_TYPE; }
  getDisplayText(): string {
    return this.sha ? `Commit ${this.sha.slice(0, 7)}` : "Commit";
  }
  getIcon(): string { return "lucide-git-commit"; }

  async onOpen(): Promise<void> {
    this.contentEl.classList.add("gh-workspace");
    this.root = createRoot(this.contentEl);
    this.render();
  }

  async setState(state: unknown, result?: ViewStateResult): Promise<void> {
    await super.setState(state, result);
    if (state && typeof state === "object") {
      const s = state as { sha?: string; owner?: string; repo?: string };
      if (typeof s.sha === "string") this.sha = s.sha;
      if (typeof s.owner === "string") this.owner = s.owner;
      if (typeof s.repo === "string") this.repo = s.repo;
      this.render();
      this.leaf.updateHeader();
    }
  }

  getState(): Record<string, unknown> {
    return { sha: this.sha, owner: this.owner, repo: this.repo };
  }

  private render(): void {
    if (!this.root || !this.sha) return;
    const repo = this.owner && this.repo
      ? { owner: this.owner, repo: this.repo, host: "github.com" as const }
      : null;
    this.root.render(<CommitDetailPanel app={this.app} sha={this.sha} repo={repo} />);
  }

  async onClose(): Promise<void> {
    this.root?.unmount();
    this.root = null;
    await super.onClose();
  }
}

export async function openGitHubWorkspace(
  app: App,
  options: { section?: GithubWorkspaceSection; owner?: string; repo?: string } = {},
): Promise<void> {
  if (options.owner && options.repo) {
    app.github.setRepository({ owner: options.owner, repo: options.repo });
  }
  const existing = app.workspace.getLeavesOfType(GitHubWorkspaceView.VIEW_TYPE)[0];
  if (existing) {
    await existing.setViewState({
      type: GitHubWorkspaceView.VIEW_TYPE,
      active: true,
      state: {
        section: options.section ?? "pulls",
        owner: options.owner,
        repo: options.repo,
      },
    });
    app.workspace.setActiveLeaf(existing, { focus: true });
    return;
  }
  await app.workspace.getLeaf("tab").setViewState({
    type: GitHubWorkspaceView.VIEW_TYPE,
    active: true,
    state: {
      section: options.section ?? "pulls",
      owner: options.owner,
      repo: options.repo,
    },
  });
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

// --- Shell ---------------------------------------------------------------

function WorkspaceShell({
  app,
  section,
  onSection,
}: {
  app: App;
  section: GithubWorkspaceSection;
  onSection: (s: GithubWorkspaceSection) => void;
}): ReactNode {
  const [auth, setAuth] = useState<GitHubAuthState | null>(null);
  const [repo, setRepo] = useState<GitHubRepositoryRef | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void (async () => {
      const [a, r] = await Promise.all([app.github.getAuth(), app.github.resolveRepository()]);
      setAuth(a);
      setRepo(r);
      setReady(true);
    })();
  }, [app, section]);

  if (!ready) {
    return <div className="gh-empty">Loading GitHub workspace…</div>;
  }

  if (!auth?.login) {
    return (
      <div className="gh-empty-center">
        <p>Sign in to GitHub to browse this repository.</p>
        <button type="button" className="mod-cta" onClick={() => void openPullRequestsView(app)}>
          Connect GitHub
        </button>
      </div>
    );
  }

  if (!repo) {
    return (
      <div className="gh-empty-center">
        <p>Choose a repository first.</p>
        <button type="button" className="mod-cta" onClick={() => void openPullRequestsView(app)}>
          Choose repository
        </button>
      </div>
    );
  }

  return (
    <div className="gh-shell">
      <aside className="gh-sidebar">
        <div className="gh-sidebar-repo">
          <Icon name="lucide-github" />
          <div className="gh-sidebar-repo-text">
            <div className="gh-sidebar-repo-name">{repo.owner}/{repo.repo}</div>
            <button type="button" className="gh-linkish" onClick={() => void openPullRequestsView(app)}>
              Switch repo
            </button>
          </div>
        </div>
        <nav className="gh-section-nav">
          {SECTIONS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`gh-section-btn${section === item.id ? " is-active" : ""}`}
              onClick={() => {
                if (item.id === "pulls") {
                  void openPullRequestsView(app);
                  return;
                }
                onSection(item.id);
              }}
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="gh-sidebar-user">
          {auth.avatarUrl && <img src={auth.avatarUrl} alt="" className="gh-avatar" width={20} height={20} />}
          <span>{auth.login}</span>
        </div>
      </aside>
      <main className="gh-main">
        {section === "commits" && <CommitsPanel app={app} repo={repo} />}
        {section === "issues" && <IssuesPanel app={app} repo={repo} />}
        {section === "files" && <FilesPanel app={app} repo={repo} />}
        {section === "actions" && <ActionsPanel app={app} repo={repo} />}
        {section === "branches" && <BranchesPanel app={app} repo={repo} />}
        {section === "inbox" && <InboxPanel app={app} />}
        {section === "local" && <LocalPanel app={app} />}
        {section === "pulls" && (
          <div className="gh-empty-center">
            <p>Opening pull requests…</p>
          </div>
        )}
      </main>
    </div>
  );
}

// --- Commits section -----------------------------------------------------

function CommitsPanel({ app, repo }: { app: App; repo: GitHubRepositoryRef }): ReactNode {
  const [branches, setBranches] = useState<GitHubBranch[]>([]);
  const [ref, setRef] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ items: CommitSummary[]; hasNext: boolean; hasPrev: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [branchQuery, setBranchQuery] = useState("");
  const [branchOpen, setBranchOpen] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const [list, def] = await Promise.all([
          app.github.listBranches(repo),
          app.github.getDefaultBranch(repo),
        ]);
        setBranches(list);
        const preferred = readGithubPrPrefs().lastBranch;
        setRef((current) => current || (preferred && list.some((b) => b.name === preferred) ? preferred : def));
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
  }, [app, repo]);

  const load = useCallback(async () => {
    if (!ref) return;
    setLoading(true);
    setError(null);
    try {
      const result = await app.github.listCommits({ ref, page, perPage: 30 }, repo);
      setData({
        items: result.items,
        hasNext: result.hasNextPage,
        hasPrev: result.hasPreviousPage,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setData({ items: [], hasNext: false, hasPrev: false });
    } finally {
      setLoading(false);
    }
  }, [app, page, ref, repo]);

  useEffect(() => { void load(); }, [load]);

  const filteredBranches = useMemo(() => {
    const q = branchQuery.trim().toLowerCase();
    return q ? branches.filter((b) => b.name.toLowerCase().includes(q)) : branches;
  }, [branchQuery, branches]);

  return (
    <div className="gh-commits">
      <header className="gh-commits-header">
        <div>
          <h1 className="gh-page-title">Commits</h1>
          <p className="gh-muted">{repo.owner}/{repo.repo}{ref ? ` @ ${ref}` : ""}</p>
        </div>
        <div className="gh-commits-controls">
          <div className="gh-branch-select">
            <button type="button" className="gh-branch-trigger" onClick={() => setBranchOpen((o) => !o)}>
              <Icon name="lucide-git-branch" />
              <span>{ref || "Select branch"}</span>
              <Icon name="lucide-chevrons-up-down" />
            </button>
            {branchOpen && (
              <div className="gh-branch-popover">
                <input
                  autoFocus
                  className="gh-branch-search"
                  placeholder="Filter branches…"
                  value={branchQuery}
                  onChange={(e) => setBranchQuery(e.target.value)}
                />
                <div className="gh-branch-list">
                  {filteredBranches.map((b) => (
                    <button
                      key={b.name}
                      type="button"
                      className={`gh-branch-option${b.name === ref ? " is-active" : ""}`}
                      onClick={() => {
                        setRef(b.name);
                        writeGithubPrPrefs({ lastBranch: b.name });
                        setPage(1);
                        setBranchOpen(false);
                        setBranchQuery("");
                      }}
                    >
                      <span>{b.name}</span>
                      {b.protected && <span className="gh-chip">protected</span>}
                    </button>
                  ))}
                  {filteredBranches.length === 0 && <div className="gh-muted-pad">No branches</div>}
                </div>
              </div>
            )}
          </div>
          <button type="button" className="clickable-icon" aria-label="Refresh" onClick={() => void load()}>
            <Icon name="lucide-rotate-ccw" />
          </button>
        </div>
      </header>

      {error && (
        <div className="gh-error">
          {error}
          <button type="button" className="gh-linkish" onClick={() => void load()}>Retry</button>
        </div>
      )}

      {loading && !data && <div className="gh-skeleton">{Array.from({ length: 8 }, (_, i) => <div key={i} className="gh-skeleton-row" />)}</div>}

      {data && data.items.length === 0 && !loading && (
        <div className="gh-empty">No commits on this branch.</div>
      )}

      {data && data.items.length > 0 && (
        <div className="gh-commit-list">
          {data.items.map((commit) => (
            <button
              key={commit.sha}
              type="button"
              className="gh-commit-row"
              onClick={() => void openCommitDetail(app, commit.sha, repo)}
            >
              {commit.author.avatarUrl
                ? <img className="gh-avatar" src={commit.author.avatarUrl} alt="" width={28} height={28} />
                : <span className="gh-avatar-fallback">{commit.author.login.slice(0, 1).toUpperCase()}</span>}
              <div className="gh-commit-main">
                <div className="gh-commit-headline">{commit.headline}</div>
                <div className="gh-muted">
                  <strong>{commit.author.login}</strong>
                  {" committed "}
                  {moment(commit.committedDate).fromNow()}
                </div>
              </div>
              <code className="gh-sha">{commit.shortSha}</code>
              <button
                type="button"
                className="clickable-icon"
                aria-label="Copy SHA"
                onClick={(e) => {
                  e.stopPropagation();
                  void navigator.clipboard.writeText(commit.sha).then(() => new Notice("SHA copied"));
                }}
              >
                <Icon name="lucide-copy" />
              </button>
            </button>
          ))}
        </div>
      )}

      {data && (data.hasNext || data.hasPrev) && (
        <div className="gh-pagination">
          <button type="button" disabled={!data.hasPrev || loading} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            Previous
          </button>
          <span className="gh-muted">Page {page}</span>
          <button type="button" disabled={!data.hasNext || loading} onClick={() => setPage((p) => p + 1)}>
            Next
          </button>
        </div>
      )}
    </div>
  );
}

// --- Commit detail -------------------------------------------------------

function CommitDetailPanel({
  app,
  sha,
  repo: repoProp,
}: {
  app: App;
  sha: string;
  repo: GitHubRepositoryRef | null;
}): ReactNode {
  const [detail, setDetail] = useState<CommitDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [diffText, setDiffText] = useState("");
  const [loading, setLoading] = useState(true);
  const [repo, setRepo] = useState(repoProp);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const active = repoProp ?? (await app.github.resolveRepository());
        if (!active) throw new Error("No repository selected");
        setRepo(active);
        const [commit, diff] = await Promise.all([
          app.github.getCommit(sha, active),
          app.github.getCommitDiff(sha, active).catch(() => ""),
        ]);
        setDetail(commit);
        setDiffText(diff);
        setSelectedPath(commit.files[0]?.path ?? null);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    })();
  }, [app, repoProp, sha]);

  const patchByPath = useMemo(() => {
    const map = new Map<string, FileDiffMetadata>();
    for (const file of fileDiffsFromUnifiedDiff(diffText)) map.set(file.name, file);
    return map;
  }, [diffText]);

  if (loading && !detail) return <div className="gh-empty">Loading commit…</div>;
  if (error && !detail) {
    return (
      <div className="gh-empty-center">
        <p>{error}</p>
        <button type="button" className="mod-cta" onClick={() => void openGitHubWorkspace(app, { section: "commits" })}>
          Back to commits
        </button>
      </div>
    );
  }
  if (!detail || !repo) return null;

  const selected = detail.files.find((f) => f.path === selectedPath) ?? detail.files[0] ?? null;
  const selectedMeta = selected
    ? (patchByPath.get(selected.path) ?? fileDiffFromGithubPatch(selected.path, selected.patch))
    : null;

  return (
    <div className="gh-commit-detail">
      <header className="gh-commit-detail-header">
        <div className="gh-breadcrumb">
          <button type="button" className="gh-linkish" onClick={() => void openGitHubWorkspace(app, { section: "commits", owner: repo.owner, repo: repo.repo })}>
            ← Commits
          </button>
          <span className="gh-chip">{repo.owner}/{repo.repo}</span>
        </div>
        <h1 className="gh-page-title">{detail.headline}</h1>
        <div className="gh-commit-meta">
          {detail.author.avatarUrl && <img className="gh-avatar" src={detail.author.avatarUrl} alt="" width={22} height={22} />}
          <strong>{detail.author.login}</strong>
          <span className="gh-muted">committed {moment(detail.committedDate).fromNow()}</span>
          <code className="gh-sha">{detail.shortSha}</code>
          <button
            type="button"
            className="gh-linkish"
            onClick={() => void navigator.clipboard.writeText(detail.sha).then(() => new Notice("SHA copied"))}
          >
            Copy
          </button>
          {detail.verification?.verified && <span className="gh-chip mod-ok">Verified</span>}
          {detail.ciState && <span className={`gh-chip mod-ci-${detail.ciState}`}>{detail.ciState}</span>}
          <span className="gh-diffstat">
            <ins>+{detail.stats.additions}</ins> <del>−{detail.stats.deletions}</del>
            {" · "}
            {detail.files.length} files
          </span>
          <button type="button" className="gh-linkish" onClick={() => window.open(detail.url, "_blank")}>
            Open on GitHub
          </button>
        </div>
        {detail.message.includes("\n") && (
          <pre className="gh-commit-body">{detail.message.split("\n").slice(1).join("\n").trim()}</pre>
        )}
        {detail.parents.length > 0 && (
          <div className="gh-muted">
            Parent{detail.parents.length > 1 ? "s" : ""}:{" "}
            {detail.parents.map((p) => (
              <button
                key={p.sha}
                type="button"
                className="gh-linkish"
                onClick={() => void openCommitDetail(app, p.sha, repo)}
              >
                {p.shortSha}
              </button>
            ))}
          </div>
        )}
      </header>

      <div className="gh-commit-files-split">
        <aside className="gh-file-tree">
          <div className="gh-file-tree-summary">
            {detail.files.length} files
            <span className="gh-diffstat">
              <ins>+{detail.stats.additions}</ins> <del>−{detail.stats.deletions}</del>
            </span>
          </div>
          {detail.files.map((file) => (
            <button
              key={file.path}
              type="button"
              className={`gh-file-row${selectedPath === file.path ? " is-active" : ""}`}
              onClick={() => setSelectedPath(file.path)}
            >
              <span className={`gh-file-status mod-${file.status}`}>{statusGlyph(file.status)}</span>
              <span className="gh-file-name" title={file.path}>{file.path}</span>
              <span className="gh-diffstat">
                {file.additions > 0 && <ins>+{file.additions}</ins>}
                {file.deletions > 0 && <del>−{file.deletions}</del>}
              </span>
            </button>
          ))}
        </aside>
        <div className="gh-file-preview">
          {selected ? (
            <PatchPreview
              path={selected.path}
              fileDiff={selectedMeta}
              patch={selected.patch}
              status={selected.status}
              additions={selected.additions}
              deletions={selected.deletions}
            />
          ) : (
            <div className="gh-empty">No files in this commit.</div>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Branches ------------------------------------------------------------

function BranchesPanel({ app, repo }: { app: App; repo: GitHubRepositoryRef }): ReactNode {
  const [branches, setBranches] = useState<GitHubBranch[] | null>(null);
  const [defaultBranch, setDefaultBranch] = useState("");
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [list, def] = await Promise.all([
          app.github.listBranches(repo),
          app.github.getDefaultBranch(repo),
        ]);
        setBranches(list);
        setDefaultBranch(def);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setBranches([]);
      }
    })();
  }, [app, repo]);

  const filtered = useMemo(() => {
    if (!branches) return null;
    const q = query.trim().toLowerCase();
    return q ? branches.filter((b) => b.name.toLowerCase().includes(q)) : branches;
  }, [branches, query]);

  return (
    <div className="gh-commits">
      <header className="gh-commits-header">
        <div>
          <h1 className="gh-page-title">Branches</h1>
          <p className="gh-muted">{repo.owner}/{repo.repo}</p>
        </div>
        <label className="gh-search">
          <Icon name="lucide-search" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter branches…" />
        </label>
      </header>
      {error && <div className="gh-error">{error}</div>}
      {filtered === null && <div className="gh-empty">Loading branches…</div>}
      {filtered && (
        <div className="gh-branch-table">
          {filtered.map((b) => (
            <div key={b.name} className="gh-branch-row">
              <Icon name="lucide-git-branch" />
              <div className="gh-branch-row-main">
                <div className="gh-branch-row-name">
                  {b.name}
                  {b.name === defaultBranch && <span className="gh-chip">default</span>}
                  {b.protected && <span className="gh-chip">protected</span>}
                </div>
                <div className="gh-muted"><code>{b.commitSha.slice(0, 7)}</code></div>
              </div>
              <button
                type="button"
                className="gh-linkish"
                onClick={() => {
                  writeGithubPrPrefs({ owner: repo.owner, repo: repo.repo, lastBranch: b.name });
                  void openGitHubWorkspace(app, { section: "commits", owner: repo.owner, repo: repo.repo });
                }}
              >
                View commits
              </button>
              {b.commitSha && (
                <button type="button" className="gh-linkish" onClick={() => void openCommitDetail(app, b.commitSha, repo)}>
                  Tip commit
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function LocalPanel({ app }: { app: App }): ReactNode {
  return (
    <div className="gh-local-panel">
      <h1 className="gh-page-title">Local vault</h1>
      <p className="gh-muted">Working-tree tools for the vault on disk (independent of GitHub auth).</p>
      <div className="gh-local-actions">
        <button
          type="button"
          className="mod-cta"
          onClick={() => void app.workspace.getLeaf("tab").setViewState({ type: "git-changes", active: true })}
        >
          Open local changes
        </button>
        <button type="button" onClick={() => void openGitReview(app)}>
          Review working tree
        </button>
      </div>
    </div>
  );
}

// --- Shared --------------------------------------------------------------

function PatchPreview({
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

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.replaceChildren();
    const meta = fileDiff ?? fileDiffFromGithubPatch(path, patch);
    if (!meta) {
      const pre = host.ownerDocument.createElement("pre");
      pre.className = "gh-patch-pre";
      pre.textContent = patch ?? "No patch available (binary or too large).";
      host.appendChild(pre);
      return;
    }
    try {
      if (typeof (globalThis as { ResizeObserver?: unknown }).ResizeObserver === "undefined") {
        throw new Error("no RO");
      }
      const wrapper = host.ownerDocument.createElement("div");
      host.appendChild(wrapper);
      const diff = new FileDiff({
        diffStyle: "unified",
        themeType: document.body.classList.contains("theme-dark") ? "dark" : "light",
        disableFileHeader: true,
      });
      diff.render({ fileDiff: meta, containerWrapper: wrapper });
    } catch {
      const pre = host.ownerDocument.createElement("pre");
      pre.className = "gh-patch-pre";
      pre.textContent = patch ?? "";
      host.replaceChildren(pre);
    }
  }, [fileDiff, path, patch]);

  return (
    <div className="gh-preview-inner">
      <div className="gh-preview-header">
        <span className={`gh-file-status mod-${status}`}>{statusGlyph(status)}</span>
        <code>{path}</code>
        <span className="gh-diffstat">
          {additions > 0 && <ins>+{additions}</ins>}
          {deletions > 0 && <del>−{deletions}</del>}
        </span>
      </div>
      <div ref={hostRef} />
    </div>
  );
}

function Icon({ name }: { name: string }): ReactNode {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (ref.current) setIcon(ref.current, name);
  }, [name]);
  return <span className="gh-icon" ref={ref} />;
}

function statusGlyph(status: string): string {
  if (status === "added") return "A";
  if (status === "removed") return "D";
  if (status === "renamed") return "R";
  return "M";
}
