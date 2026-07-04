import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parsePatchFiles, type FileDiffMetadata } from "@pierre/diffs";
import moment from "moment";
import { ItemView } from "../views/ItemView";
import type { ViewStateResult } from "../views/View";
import type { App } from "../app/App";
import type { PrComment, PrDetail, PrSummary } from "../git/GitService";
import { ReviewSurface } from "./review/ReviewSurface";
import { fingerprintContents, type ReviewFile, type ReviewFileStatus } from "./review/reviewModel";
import { MarkdownRenderer } from "../markdown/MarkdownRenderer";
import { setIcon } from "../ui/Icon";
import { Notice } from "../ui/Notice";

/**
 * GitHub pull requests, via the gh CLI. Two React-rendered views: the list
 * ("git-prs") and a per-PR review surface ("git-pr") with GitHub-style
 * Conversation / Files changed tabs. Diffs render through @pierre/diffs'
 * first-party React bindings, fed by `gh pr diff` output. React mounts only
 * inside these views; the rest of the app stays vanilla.
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

// --- React components ----------------------------------------------------

function PrListPanel({ app }: { app: App }): ReactNode {
  const [prs, setPrs] = useState<PrSummary[] | null>(null);
  const [blocked, setBlocked] = useState<"gh" | "repo" | null>(null);

  const load = useCallback(async () => {
    setPrs(null);
    if (!(await app.git.isRepository())) {
      setBlocked("repo");
      return;
    }
    if (!(await app.git.ghAvailable())) {
      setBlocked("gh");
      return;
    }
    setPrs(await app.git.prList());
  }, [app]);
  useEffect(() => { void load(); }, [load]);

  if (blocked === "repo") {
    return <div className="git-pr-empty">This vault is not a git repository.</div>;
  }
  if (blocked === "gh") {
    return (
      <div className="git-pr-empty">
        GitHub CLI is not available. Install it (<code>brew install gh</code>) and sign in
        with <code>gh auth login</code>, then reopen this view.
      </div>
    );
  }
  return (
    <div className="git-pr-list">
      <div className="git-pr-list-header">
        <span className="git-pr-list-title">Pull requests{prs ? ` (${prs.length})` : ""}</span>
        <button className="clickable-icon" aria-label="Refresh" onClick={() => void load()}>
          <Icon name="lucide-rotate-ccw" />
        </button>
      </div>
      {prs === null && <div className="git-pr-empty">Loading…</div>}
      {prs?.length === 0 && <div className="git-pr-empty">No open pull requests.</div>}
      {prs?.map((pr) => (
        <div key={pr.number} className="git-pr-row tappable" onClick={() => void openPrDetail(app, pr.number)}>
          <span className={`git-pr-state-icon mod-${pr.isDraft ? "draft" : pr.state.toLowerCase()}`}>
            <Icon name="lucide-git-pull-request" />
          </span>
          <span className="git-pr-row-main">
            <span className="git-pr-row-title">{pr.title}</span>
            <span className="git-pr-row-meta">
              #{pr.number} · {pr.author} · {pr.headRefName} → {pr.baseRefName} · updated {moment(pr.updatedAt).fromNow()}
            </span>
          </span>
          <DecisionChip decision={pr.reviewDecision} isDraft={pr.isDraft} />
        </div>
      ))}
    </div>
  );
}

function PrDetailPanel({ app, number }: { app: App; number: number }): ReactNode {
  const [detail, setDetail] = useState<PrDetail | null>(null);
  const [patchFiles, setPatchFiles] = useState<FileDiffMetadata[] | null>(null);
  const [tab, setTab] = useState<"conversation" | "files">("conversation");
  const [missing, setMissing] = useState(false);

  const load = useCallback(async () => {
    const [view, diff] = await Promise.all([app.git.prView(number), app.git.prDiff(number)]);
    if (!view) {
      setMissing(true);
      return;
    }
    setDetail(view);
    setPatchFiles(diff ? parsePatchFiles(diff).flatMap((patch) => patch.files) : []);
  }, [app, number]);
  useEffect(() => { void load(); }, [load]);

  const reviewFiles = useMemo<ReviewFile[]>(() => {
    if (!patchFiles || !detail) return [];
    const statByPath = new Map(detail.files.map((file) => [file.path, file]));
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
  }, [detail, patchFiles]);

  const submitInlineReview = useCallback(
    async (event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT", body: string, comments: { path: string; line: number; side: "additions" | "deletions"; body: string }[]) => {
      const error = await app.git.prSubmitReview(number, event, body, comments);
      if (!error) void load();
      return error;
    },
    [app, load, number],
  );

  if (missing) return <div className="git-pr-empty">Could not load PR #{number}. Is gh signed in for this repository?</div>;
  if (!detail) return <div className="git-pr-empty">Loading PR #{number}…</div>;

  return (
    <div className="git-pr-detail">
      <div className="git-pr-header">
        <div className="git-pr-title-row">
          <h2 className="git-pr-title">{detail.title} <span className="git-pr-number">#{detail.number}</span></h2>
          <button className="git-pr-action" onClick={() => window.open(detail.url)}>Open on GitHub</button>
          <button
            className="git-pr-action"
            onClick={() => void app.git.prCheckout(number).then((error) =>
              new Notice(error ? `Checkout failed: ${error}` : `Checked out ${detail.headRefName}`))}
          >
            Checkout
          </button>
        </div>
        <div className="git-pr-meta-row">
          <StateChip state={detail.state} isDraft={detail.isDraft} />
          <DecisionChip decision={detail.reviewDecision} isDraft={detail.isDraft} />
          <span className="git-pr-row-meta">
            {detail.author} wants to merge {detail.headRefName} into {detail.baseRefName}
          </span>
        </div>
      </div>
      <div className="git-pr-tabs">
        <button className={`git-pr-tab${tab === "conversation" ? " is-active" : ""}`} onClick={() => setTab("conversation")}>
          Conversation{detail.comments.length > 0 ? ` (${detail.comments.length})` : ""}
        </button>
        <button className={`git-pr-tab${tab === "files" ? " is-active" : ""}`} onClick={() => setTab("files")}>
          Files changed ({detail.files.length})
          <span className="git-pr-diffstat"><ins>+{detail.additions}</ins> <del>−{detail.deletions}</del></span>
        </button>
      </div>
      {tab === "conversation" ? (
        <div className="git-pr-conversation">
          <CommentCard app={app} author={detail.author} date={detail.updatedAt} body={detail.body || "*No description provided.*"} />
          {detail.comments.map((comment, index) => (
            <CommentCard key={index} app={app} author={comment.author} date={comment.createdAt} body={comment.body} />
          ))}
          <ReviewBar app={app} number={number} onDone={() => void load()} />
        </div>
      ) : (
        <div className="git-pr-files">
          {reviewFiles.length === 0 ? (
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
          )}
        </div>
      )}
    </div>
  );
}

function CommentCard({ app, author, date, body }: { app: App; author: string; date: string } & Pick<PrComment, "body">): ReactNode {
  return (
    <div className="git-pr-comment">
      <div className="git-pr-comment-header">
        <span className="git-pr-comment-author">{author}</span>
        <span className="git-pr-comment-date">{moment(date).fromNow()}</span>
      </div>
      <Markdown app={app} text={body} />
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
          className="git-pr-action mod-cta"
          disabled={busy || !body.trim()}
          onClick={() => void submit(() => app.git.prComment(number, body.trim()), "Comment posted")}
        >
          Comment
        </button>
        <button
          className="git-pr-action mod-approve"
          disabled={busy}
          onClick={() => void submit(() => app.git.prReview(number, "approve", body.trim() || undefined), "Approved")}
        >
          Approve
        </button>
        <button
          className="git-pr-action mod-request-changes"
          disabled={busy || !body.trim()}
          onClick={() => void submit(() => app.git.prReview(number, "request-changes", body.trim()), "Changes requested")}
        >
          Request changes
        </button>
      </div>
    </div>
  );
}

function Markdown({ app, text }: { app: App; text: string }): ReactNode {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.replaceChildren();
    void MarkdownRenderer.renderMarkdown(text, el, "");
  }, [app, text]);
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
  const label = isDraft ? "Draft" : state.toLowerCase();
  return <span className={`git-pr-chip mod-${isDraft ? "draft" : state.toLowerCase()}`}>{label}</span>;
}

function DecisionChip({ decision, isDraft }: { decision: string; isDraft: boolean }): ReactNode {
  if (isDraft || !decision) return null;
  const labels: Record<string, string> = {
    APPROVED: "Approved",
    CHANGES_REQUESTED: "Changes requested",
    REVIEW_REQUIRED: "Review required",
  };
  return <span className={`git-pr-chip mod-${decision.toLowerCase()}`}>{labels[decision] ?? decision}</span>;
}

const PR_STATUS_BY_CHANGE_TYPE: Record<FileDiffMetadata["type"], ReviewFileStatus> = {
  change: "modified",
  "rename-pure": "renamed",
  "rename-changed": "renamed",
  new: "added",
  deleted: "deleted",
};
