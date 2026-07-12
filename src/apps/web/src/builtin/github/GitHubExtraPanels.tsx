import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import moment from "moment";
import type { App } from "../../app/App";
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
import { MarkdownRenderer } from "../../markdown/MarkdownRenderer";
import { setIcon } from "../../ui/Icon";
import { Notice } from "../../ui/Notice";
import { openPrDetail } from "../git/GitPrViews";

// ---------------------------------------------------------------------------
// Issues
// ---------------------------------------------------------------------------

export function IssuesPanel({ app, repo }: { app: App; repo: GitHubRepositoryRef }): ReactNode {
  const [state, setState] = useState<"open" | "closed" | "all">("open");
  const [items, setItems] = useState<IssueSummary[] | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [detail, setDetail] = useState<IssueDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setItems(await app.github.listIssues(state, repo));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setItems([]);
    }
  }, [app, repo, state]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (selected == null) {
      setDetail(null);
      return;
    }
    void app.github
      .getIssue(selected, repo)
      .then(setDetail)
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
      });
  }, [app, repo, selected]);

  const filtered = useMemo(() => {
    if (!items) return null;
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (i) =>
        i.title.toLowerCase().includes(q) ||
        String(i.number).includes(q) ||
        i.author.login.toLowerCase().includes(q),
    );
  }, [items, query]);

  const postComment = async () => {
    if (!selected || !comment.trim()) return;
    setBusy(true);
    const err = await app.github.createIssueComment(selected, comment.trim(), repo);
    setBusy(false);
    if (err) {
      new Notice(err);
      return;
    }
    setComment("");
    new Notice("Comment posted");
    setDetail(await app.github.getIssue(selected, repo));
  };

  return (
    <div className="gh-split-panel">
      <div className="gh-split-list">
        <header className="gh-panel-header">
          <div>
            <h1 className="gh-page-title">Issues</h1>
            <p className="gh-muted">
              {repo.owner}/{repo.repo}
            </p>
          </div>
          <div className="gh-filter-pills">
            {(["open", "closed", "all"] as const).map((s) => (
              <button
                key={s}
                type="button"
                className={state === s ? "is-active" : ""}
                onClick={() => {
                  setState(s);
                  setSelected(null);
                }}
              >
                {s}
              </button>
            ))}
          </div>
        </header>
        <label className="gh-search gh-search-block">
          <Icon name="lucide-search" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter issues…"
          />
        </label>
        {error && <div className="gh-error">{error}</div>}
        {filtered === null && <div className="gh-empty">Loading…</div>}
        {filtered && filtered.length === 0 && <div className="gh-empty">No issues.</div>}
        <div className="gh-item-list">
          {filtered?.map((issue) => (
            <button
              key={issue.number}
              type="button"
              className={`gh-item-row${selected === issue.number ? " is-active" : ""}`}
              onClick={() => setSelected(issue.number)}
            >
              <span className={`gh-dot mod-${issue.state}`} />
              <div className="gh-item-main">
                <div className="gh-item-title">{issue.title}</div>
                <div className="gh-muted">
                  #{issue.number} · {issue.author.login} · {moment(issue.updatedAt).fromNow()}
                  {issue.comments > 0 ? ` · ${issue.comments} comments` : ""}
                </div>
              </div>
              {issue.labels.slice(0, 2).map((l) => (
                <span
                  key={l.name}
                  className="gh-label"
                  style={{ ["--label-color" as string]: `#${l.color}` }}
                >
                  {l.name}
                </span>
              ))}
            </button>
          ))}
        </div>
      </div>
      <div className="gh-split-detail">
        {!detail && <div className="gh-empty">Select an issue</div>}
        {detail && (
          <div className="gh-detail-scroll">
            <div className="gh-detail-head">
              <span className={`gh-chip mod-${detail.state}`}>{detail.state}</span>
              <h2 className="gh-page-title">
                {detail.title} <span className="gh-muted">#{detail.number}</span>
              </h2>
              <div className="gh-muted">
                {detail.author.login} opened {moment(detail.createdAt).fromNow()}
                {" · "}
                <button
                  type="button"
                  className="gh-linkish"
                  onClick={() => window.open(detail.url, "_blank")}
                >
                  Open on GitHub
                </button>
              </div>
            </div>
            <article className="gh-card">
              <Markdown text={detail.body || "*No description*"} />
            </article>
            {detail.commentsList.map((c) => (
              <article key={c.id} className="gh-card">
                <div className="gh-card-meta">
                  <strong>{c.author.login}</strong>
                  <span className="gh-muted">{moment(c.createdAt).fromNow()}</span>
                </div>
                <Markdown text={c.body} />
              </article>
            ))}
            <div className="gh-composer">
              <textarea
                rows={3}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Leave a comment"
              />
              <button
                type="button"
                className="mod-cta"
                disabled={busy || !comment.trim()}
                onClick={() => void postComment()}
              >
                Comment
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export function ActionsPanel({ app, repo }: { app: App; repo: GitHubRepositoryRef }): ReactNode {
  const [runs, setRuns] = useState<ActionRunSummary[] | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [detail, setDetail] = useState<ActionRunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setRuns(await app.github.listWorkflowRuns(1, repo));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setRuns([]);
    }
  }, [app, repo]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (selected == null) {
      setDetail(null);
      return;
    }
    void app.github
      .getWorkflowRun(selected, repo)
      .then(setDetail)
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
      });
  }, [app, repo, selected]);

  return (
    <div className="gh-split-panel">
      <div className="gh-split-list">
        <header className="gh-panel-header">
          <div>
            <h1 className="gh-page-title">Actions</h1>
            <p className="gh-muted">
              {repo.owner}/{repo.repo}
            </p>
          </div>
          <button
            type="button"
            className="clickable-icon"
            aria-label="Refresh"
            onClick={() => void load()}
          >
            <Icon name="lucide-rotate-ccw" />
          </button>
        </header>
        {error && <div className="gh-error">{error}</div>}
        {runs === null && <div className="gh-empty">Loading runs…</div>}
        {runs && runs.length === 0 && <div className="gh-empty">No workflow runs.</div>}
        <div className="gh-item-list">
          {runs?.map((run) => (
            <button
              key={run.id}
              type="button"
              className={`gh-item-row${selected === run.id ? " is-active" : ""}`}
              onClick={() => setSelected(run.id)}
            >
              <span className={`gh-ci-dot mod-${conclusionClass(run.conclusion, run.status)}`} />
              <div className="gh-item-main">
                <div className="gh-item-title">{run.displayTitle}</div>
                <div className="gh-muted">
                  {run.name} · #{run.runNumber} · {run.headBranch} ·{" "}
                  {moment(run.updatedAt).fromNow()}
                </div>
              </div>
              <span className="gh-chip">{run.conclusion ?? run.status}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="gh-split-detail">
        {!detail && <div className="gh-empty">Select a workflow run</div>}
        {detail && (
          <div className="gh-detail-scroll">
            <div className="gh-detail-head">
              <h2 className="gh-page-title">{detail.displayTitle}</h2>
              <div className="gh-muted">
                {detail.name} · {detail.headBranch} @ <code>{detail.headSha.slice(0, 7)}</code>
                {" · "}
                <button
                  type="button"
                  className="gh-linkish"
                  onClick={() => window.open(detail.htmlUrl, "_blank")}
                >
                  Open on GitHub
                </button>
              </div>
              <div className="gh-chip-row">
                <span
                  className={`gh-chip mod-ci-${conclusionClass(detail.conclusion, detail.status)}`}
                >
                  {detail.conclusion ?? detail.status}
                </span>
                <span className="gh-chip">{detail.event}</span>
                <span className="gh-chip">attempt {detail.attempt}</span>
              </div>
            </div>
            {detail.jobs.map((job) => (
              <div key={job.id} className="gh-card">
                <div className="gh-card-meta">
                  <span
                    className={`gh-ci-dot mod-${conclusionClass(job.conclusion, job.status)}`}
                  />
                  <strong>{job.name}</strong>
                  <span className="gh-muted">{job.conclusion ?? job.status}</span>
                </div>
                <div className="gh-steps">
                  {job.steps.map((step) => (
                    <div key={step.number} className="gh-step-row">
                      <span
                        className={`gh-ci-dot mod-${conclusionClass(step.conclusion, step.status)}`}
                      />
                      <span>{step.name}</span>
                      <span className="gh-muted">{step.conclusion ?? step.status}</span>
                    </div>
                  ))}
                  {job.steps.length === 0 && <div className="gh-muted">No steps</div>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

export function FilesPanel({ app, repo }: { app: App; repo: GitHubRepositoryRef }): ReactNode {
  const [ref, setRef] = useState("");
  const [path, setPath] = useState("");
  const [items, setItems] = useState<RepoContentItem[] | null>(null);
  const [file, setFile] = useState<RepoFileContent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [branches, setBranches] = useState<string[]>([]);

  useEffect(() => {
    void (async () => {
      try {
        const [list, def] = await Promise.all([
          app.github.listBranches(repo),
          app.github.getDefaultBranch(repo),
        ]);
        setBranches(list.map((b) => b.name));
        setRef(def);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
  }, [app, repo]);

  const loadDir = useCallback(
    async (dir: string, branch: string) => {
      if (!branch) return;
      setError(null);
      setFile(null);
      try {
        const list = await app.github.listContents(dir, branch, repo);
        setItems(
          list.slice().sort((a, b) => {
            if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
            return a.name.localeCompare(b.name);
          }),
        );
        setPath(dir);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setItems([]);
      }
    },
    [app, repo],
  );

  useEffect(() => {
    if (ref) void loadDir("", ref);
  }, [loadDir, ref]);

  const openItem = async (item: RepoContentItem) => {
    if (item.type === "dir") {
      await loadDir(item.path, ref);
      return;
    }
    try {
      setFile(await app.github.getFileContent(item.path, ref, repo));
    } catch (err) {
      new Notice(err instanceof Error ? err.message : String(err));
    }
  };

  const crumbs = path ? path.split("/") : [];

  return (
    <div className="gh-files-panel">
      <header className="gh-panel-header">
        <div>
          <h1 className="gh-page-title">Files</h1>
          <div className="gh-crumbs">
            <button type="button" className="gh-linkish" onClick={() => void loadDir("", ref)}>
              {repo.repo}
            </button>
            {crumbs.map((part, i) => {
              const sub = crumbs.slice(0, i + 1).join("/");
              return (
                <span key={sub}>
                  <span className="gh-muted"> / </span>
                  <button
                    type="button"
                    className="gh-linkish"
                    onClick={() => void loadDir(sub, ref)}
                  >
                    {part}
                  </button>
                </span>
              );
            })}
          </div>
        </div>
        <select className="gh-select" value={ref} onChange={(e) => setRef(e.target.value)}>
          {branches.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
      </header>
      {error && <div className="gh-error">{error}</div>}
      <div className="gh-files-split">
        <div className="gh-file-browser">
          {items === null && <div className="gh-empty">Loading…</div>}
          {items?.map((item) => (
            <button
              key={item.path}
              type="button"
              className="gh-file-browser-row"
              onClick={() => void openItem(item)}
            >
              <Icon name={item.type === "dir" ? "lucide-folder" : "lucide-file"} />
              <span>{item.name}</span>
              {item.type === "file" && <span className="gh-muted">{formatSize(item.size)}</span>}
            </button>
          ))}
        </div>
        <div className="gh-file-content">
          {!file && <div className="gh-empty">Select a file to preview</div>}
          {file && (
            <>
              <div className="gh-preview-header">
                <code>{file.path}</code>
                <span className="gh-muted">{formatSize(file.size)}</span>
                {file.htmlUrl && (
                  <button
                    type="button"
                    className="gh-linkish"
                    onClick={() => window.open(file.htmlUrl, "_blank")}
                  >
                    GitHub
                  </button>
                )}
              </div>
              {file.text == null ? (
                <div className="gh-empty">Binary or large file — open on GitHub to view.</div>
              ) : (
                <pre className="gh-code-pre">{file.text}</pre>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inbox
// ---------------------------------------------------------------------------

export function InboxPanel({ app }: { app: App }): ReactNode {
  const [items, setItems] = useState<NotificationItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setItems(await app.github.listNotifications({ all: showAll }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setItems([]);
    }
  }, [app, showAll]);

  useEffect(() => {
    void load();
  }, [load]);

  const openNotification = async (n: NotificationItem) => {
    if (n.unread) {
      await app.github.markNotificationRead(n.id);
      setItems((prev) => prev?.map((x) => (x.id === n.id ? { ...x, unread: false } : x)) ?? null);
    }
    // Best-effort navigation from API subject URL
    const match =
      n.url?.match(/\/repos\/([^/]+)\/([^/]+)\/(issues|pulls)\/(\d+)/) ??
      n.subjectUrl?.match(/\/repos\/([^/]+)\/([^/]+)\/(issues|pulls)\/(\d+)/);
    if (match) {
      const owner = match[1];
      const repo = match[2];
      const kind = match[3];
      const num = Number(match[4]);
      app.github.setRepository({ owner, repo });
      if (kind === "pulls") void openPrDetail(app, num, { owner, repo });
      else void openPrDetail(app, num, { owner, repo }); // issues open via PR view fallback — open workspace issues
      return;
    }
    const commitMatch = n.url?.match(/\/repos\/([^/]+)\/([^/]+)\/commits\/([a-f0-9]+)/i);
    if (commitMatch) {
      void app.workspace.getLeaf("tab").setViewState({
        type: "git-commit",
        active: true,
        state: { sha: commitMatch[3], owner: commitMatch[1], repo: commitMatch[2] },
      });
      return;
    }
    if (n.repository) {
      app.github.setRepository({ owner: n.owner, repo: n.repo });
    }
    new Notice(n.title);
  };

  return (
    <div className="gh-commits">
      <header className="gh-panel-header">
        <div>
          <h1 className="gh-page-title">Inbox</h1>
          <p className="gh-muted">GitHub notifications for your account</p>
        </div>
        <div className="gh-commits-controls">
          <label className="gh-check">
            <input
              type="checkbox"
              checked={showAll}
              onChange={(e) => setShowAll(e.target.checked)}
            />
            Include read
          </label>
          <button
            type="button"
            className="gh-linkish"
            onClick={() =>
              void app.github.markAllNotificationsRead().then((err) => {
                if (err) new Notice(err);
                else {
                  new Notice("Marked all as read");
                  void load();
                }
              })
            }
          >
            Mark all read
          </button>
          <button
            type="button"
            className="clickable-icon"
            aria-label="Refresh"
            onClick={() => void load()}
          >
            <Icon name="lucide-rotate-ccw" />
          </button>
        </div>
      </header>
      {error && <div className="gh-error">{error}</div>}
      {items === null && <div className="gh-empty">Loading notifications…</div>}
      {items && items.length === 0 && <div className="gh-empty">You&apos;re all caught up.</div>}
      <div className="gh-item-list">
        {items?.map((n) => (
          <button
            key={n.id}
            type="button"
            className={`gh-item-row${n.unread ? " is-unread" : ""}`}
            onClick={() => void openNotification(n)}
          >
            <span className={`gh-dot ${n.unread ? "mod-open" : ""}`} />
            <div className="gh-item-main">
              <div className="gh-item-title">{n.title}</div>
              <div className="gh-muted">
                {n.repository} · {n.type} · {n.reason} · {moment(n.updatedAt).fromNow()}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

function Markdown({ text }: { text: string }): ReactNode {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.replaceChildren();
    void MarkdownRenderer.renderMarkdown(text, el, "");
  }, [text]);
  return <div className="markdown-rendered gh-markdown" ref={ref} />;
}

function Icon({ name }: { name: string }): ReactNode {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (ref.current) setIcon(ref.current, name);
  }, [name]);
  return <span className="gh-icon" ref={ref} />;
}

function conclusionClass(conclusion: string | null, status: string): string {
  const v = (conclusion ?? status).toLowerCase();
  if (v === "success" || v === "completed") return "success";
  if (v === "failure" || v === "timed_out" || v === "action_required") return "failure";
  if (v === "cancelled" || v === "error") return "error";
  if (v === "pending" || v === "queued" || v === "in_progress" || v === "waiting") return "pending";
  return "unknown";
}

function formatSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
