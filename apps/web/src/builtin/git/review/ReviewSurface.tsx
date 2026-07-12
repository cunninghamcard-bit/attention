import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CodeViewItem } from "@pierre/diffs";
import { CodeView, type CodeViewHandle } from "@pierre/diffs/react";
import { setIcon } from "../../../ui/Icon";
import { Notice } from "../../../ui/Notice";
import {
  buildReviewMarkdown,
  isViewed,
  readDiffStyle,
  readViewed,
  type ReviewDiffStyle,
  type ReviewDraftComment,
  type ReviewFile,
  writeDiffStyle,
  writeViewed,
} from "./reviewModel";

/**
 * The review surface: one virtualized CodeView over every changed file, a
 * sidebar file list with viewed-progress, per-file cards (collapse, status,
 * diffstat, viewed), split/unified toggle, keyboard navigation, and inline
 * draft comments on diff lines. Feature-parity target is nkzw-tech/codiff;
 * the editable-diff and native-editor hooks go beyond it.
 */

interface CommentAnnotationMetadata {
  draftId: string;
}

export interface ReviewSubmitOptions {
  /** PR verdict submit: batches every draft into one review. */
  onSubmit(
    event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT",
    body: string,
    comments: ReviewDraftComment[],
  ): Promise<string | null>;
}

export interface ReviewCommitOptions {
  /** Working-tree commit: stages exactly `paths`, commits with the message. */
  onCommit(paths: string[], subject: string, body: string): Promise<string | null>;
}

export interface ReviewSurfaceProps {
  files: ReviewFile[];
  /** Repo root for viewed persistence; null keeps viewed state session-only. */
  storageRoot: string | null;
  title: string;
  subtitle?: string;
  commit?: ReviewCommitOptions;
  review?: ReviewSubmitOptions;
  onOpenFile?(path: string): void;
  onEditDiff?(path: string): void;
  onRefresh?(): void;
}

const SUBJECT_LIMIT = 72;

export function ReviewSurface({
  files,
  storageRoot,
  title,
  subtitle,
  commit,
  review,
  onOpenFile,
  onEditDiff,
  onRefresh,
}: ReviewSurfaceProps): ReactNode {
  const [viewed, setViewed] = useState<Record<string, string>>(() =>
    storageRoot ? readViewed(storageRoot) : {},
  );
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const [filter, setFilter] = useState("");
  const [diffStyle, setDiffStyle] = useState<ReviewDiffStyle>(() => readDiffStyle());
  const [drafts, setDrafts] = useState<ReviewDraftComment[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [commitSelected, setCommitSelected] = useState<ReadonlySet<string> | null>(null);
  const [subject, setSubject] = useState("");
  const [commitBody, setCommitBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [reviewBody, setReviewBody] = useState("");
  const codeViewRef = useRef<CodeViewHandle<CommentAnnotationMetadata>>(null);
  const draftSeq = useRef(0);

  const visibleFiles = useMemo(() => {
    const query = filter.trim().toLowerCase();
    return query ? files.filter((file) => file.path.toLowerCase().includes(query)) : files;
  }, [files, filter]);

  const selected = commitSelected ?? new Set(files.map((file) => file.path));
  const viewedCount = files.filter((file) => isViewed(viewed, file)).length;

  const markViewed = useCallback(
    (file: ReviewFile, nextViewed: boolean) => {
      setViewed((current) => {
        const next = { ...current };
        if (nextViewed) next[file.path] = file.fingerprint;
        else delete next[file.path];
        if (storageRoot) writeViewed(storageRoot, next);
        return next;
      });
      // codiff behavior: marking a file viewed collapses it out of the way.
      setCollapsed((current) => {
        const next = new Set(current);
        if (nextViewed) next.add(file.path);
        else next.delete(file.path);
        return next;
      });
    },
    [storageRoot],
  );

  const toggleCollapsed = useCallback((path: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const scrollToFile = useCallback((path: string) => {
    setActivePath(path);
    codeViewRef.current?.scrollTo({ type: "item", id: path, align: "start", behavior: "smooth" });
  }, []);

  const switchDiffStyle = useCallback((style: ReviewDiffStyle) => {
    setDiffStyle(style);
    writeDiffStyle(style);
  }, []);

  const addDraft = useCallback((path: string, side: "additions" | "deletions", line: number) => {
    draftSeq.current += 1;
    setDrafts((current) => [
      ...current,
      { id: `draft-${draftSeq.current}`, path, side, line, body: "" },
    ]);
  }, []);

  const keyHandler = useCallback(
    (event: React.KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest("input, textarea, [contenteditable]")) return;
      const order = visibleFiles.map((file) => file.path);
      const index = activePath ? order.indexOf(activePath) : -1;
      const active = visibleFiles.find((file) => file.path === activePath);
      if (event.key === "j" && order.length > 0) {
        scrollToFile(order[Math.min(index + 1, order.length - 1)]);
      } else if (event.key === "k" && order.length > 0) {
        scrollToFile(order[Math.max(index - 1, 0)]);
      } else if (event.key === "v" && active) {
        markViewed(active, !isViewed(viewed, active));
      } else if (event.key === "x" && active) {
        toggleCollapsed(active.path);
      } else if (event.key === "s") {
        switchDiffStyle(diffStyle === "split" ? "unified" : "split");
      } else if (event.key === "?") {
        setHelpOpen((open) => !open);
      } else if (event.key === "Escape") {
        setHelpOpen(false);
      } else {
        return;
      }
      event.preventDefault();
    },
    [
      activePath,
      diffStyle,
      markViewed,
      scrollToFile,
      switchDiffStyle,
      toggleCollapsed,
      viewed,
      visibleFiles,
    ],
  );

  const items = useMemo<CodeViewItem<CommentAnnotationMetadata>[]>(
    () =>
      visibleFiles.map((file) => {
        const fileDrafts = drafts.filter((draft) => draft.path === file.path);
        const isCollapsed = collapsed.has(file.path);
        return {
          id: file.path,
          type: "diff" as const,
          fileDiff: file.fileDiff,
          collapsed: isCollapsed,
          // CodeView only re-renders an item when `version` changes; hash the
          // mutable bits in (same trick as codiff's getItemVersion).
          version: hashVersion(
            `${file.fingerprint}:${isCollapsed ? 1 : 0}:${fileDrafts.map((draft) => `${draft.id}@${draft.side}${draft.line}`).join(",")}`,
          ),
          annotations: fileDrafts.map((draft) => ({
            side: draft.side,
            lineNumber: draft.line,
            metadata: { draftId: draft.id },
          })),
        };
      }),
    [collapsed, drafts, visibleFiles],
  );

  const themeType = document.body.classList.contains("theme-dark") ? "dark" : "light";
  const options = useMemo(
    () => ({
      collapsedContextThreshold: 12,
      diffIndicators: "bars" as const,
      diffStyle,
      enableGutterUtility: true,
      expandUnchanged: false,
      expansionLineCount: 100,
      hunkSeparators: "line-info-basic" as const,
      itemMetrics: { diffHeaderHeight: 44 },
      layout: { gap: 12, paddingTop: 10, paddingBottom: 10 },
      lineHoverHighlight: "both" as const,
      stickyHeaders: true,
      themeType: themeType as "dark" | "light",
      unsafeCSS: REVIEW_UNSAFE_CSS,
    }),
    [diffStyle, themeType],
  );

  const renderHeader = useCallback(
    (item: CodeViewItem<CommentAnnotationMetadata>) => {
      const file = files.find((candidate) => candidate.path === item.id);
      if (!file) return null;
      return (
        <FileCardHeader
          file={file}
          collapsed={collapsed.has(file.path)}
          viewed={isViewed(viewed, file)}
          active={activePath === file.path}
          includeInCommit={commit ? selected.has(file.path) : null}
          onToggleCollapsed={() => toggleCollapsed(file.path)}
          onToggleViewed={(next) => markViewed(file, next)}
          onToggleInclude={
            commit
              ? (include) => {
                  setCommitSelected(() => {
                    const next = new Set(selected);
                    if (include) next.add(file.path);
                    else next.delete(file.path);
                    return next;
                  });
                }
              : undefined
          }
          onOpenFile={
            onOpenFile && file.status !== "deleted" ? () => onOpenFile(file.path) : undefined
          }
          onEditDiff={
            onEditDiff && !file.binary && file.status !== "deleted"
              ? () => onEditDiff(file.path)
              : undefined
          }
        />
      );
    },
    [
      activePath,
      collapsed,
      commit,
      files,
      markViewed,
      onEditDiff,
      onOpenFile,
      selected,
      toggleCollapsed,
      viewed,
    ],
  );

  const renderGutterUtility = useCallback(
    (
      getHoveredLine:
        | (() => { lineNumber: number; side?: "additions" | "deletions" } | undefined)
        | (() => { lineNumber: number } | undefined),
      item: CodeViewItem<CommentAnnotationMetadata>,
    ) => (
      <button
        className="review-add-comment"
        aria-label="Add review comment"
        onMouseDown={(event) => {
          event.preventDefault();
          const line = getHoveredLine();
          if (line)
            addDraft(
              item.id,
              (line as { side?: "additions" | "deletions" }).side ?? "additions",
              line.lineNumber,
            );
        }}
      >
        +
      </button>
    ),
    [addDraft],
  );

  const renderAnnotation = useCallback(
    (annotation: { metadata?: CommentAnnotationMetadata }) => {
      const draft = drafts.find((candidate) => candidate.id === annotation.metadata?.draftId);
      if (!draft) return null;
      return (
        <DraftCommentCard
          draft={draft}
          onSave={(body) =>
            setDrafts((current) => current.map((c) => (c.id === draft.id ? { ...c, body } : c)))
          }
          onDelete={() => setDrafts((current) => current.filter((c) => c.id !== draft.id))}
        />
      );
    },
    [drafts],
  );

  const copyNotes = useCallback(async () => {
    const markdown = buildReviewMarkdown(drafts, `Review notes — ${title}`);
    if (!markdown) {
      new Notice("No review comments to copy");
      return;
    }
    await navigator.clipboard.writeText(markdown);
    new Notice("Review notes copied as Markdown");
  }, [drafts, title]);

  const submitReview = useCallback(
    async (event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT") => {
      if (!review) return;
      setBusy(true);
      try {
        const pending = drafts.filter((draft) => draft.body.trim().length > 0);
        const error = await review.onSubmit(event, reviewBody.trim(), pending);
        if (error) {
          new Notice(`Review failed: ${error}`);
          return;
        }
        new Notice(
          event === "APPROVE"
            ? "Approved"
            : event === "REQUEST_CHANGES"
              ? "Changes requested"
              : "Review submitted",
        );
        setDrafts([]);
        setReviewBody("");
        onRefresh?.();
      } finally {
        setBusy(false);
      }
    },
    [drafts, onRefresh, review, reviewBody],
  );

  const doCommit = useCallback(async () => {
    if (!commit) return;
    setBusy(true);
    try {
      const error = await commit.onCommit([...selected], subject.trim(), commitBody.trim());
      if (error) {
        new Notice(`Commit failed: ${error}`);
        return;
      }
      new Notice("Committed");
      setSubject("");
      setCommitBody("");
      setCommitSelected(null);
      onRefresh?.();
    } finally {
      setBusy(false);
    }
  }, [commit, commitBody, onRefresh, selected, subject]);

  useEffect(() => {
    if (!activePath && visibleFiles.length > 0) setActivePath(visibleFiles[0].path);
  }, [activePath, visibleFiles]);

  const draftCount = drafts.filter((draft) => draft.body.trim().length > 0).length;

  return (
    <div className="review-surface" tabIndex={0} onKeyDown={keyHandler}>
      <div className="review-sidebar">
        <div className="review-sidebar-title">{title}</div>
        {subtitle && <div className="review-sidebar-subtitle">{subtitle}</div>}
        <input
          className="review-filter"
          placeholder="Filter files"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
        <div
          className="review-progress"
          aria-label={`${viewedCount} of ${files.length} files viewed`}
        >
          <div className="review-progress-track">
            <div
              className="review-progress-fill"
              style={{ width: files.length ? `${(viewedCount / files.length) * 100}%` : "0%" }}
            />
          </div>
          <span className="review-progress-text">
            {viewedCount} / {files.length} viewed
          </span>
        </div>
        <div className="review-file-list">
          {visibleFiles.map((file) => (
            <div
              key={file.path}
              className={`review-file-row tappable${activePath === file.path ? " is-active" : ""}${isViewed(viewed, file) ? " is-viewed" : ""}`}
              onClick={() => scrollToFile(file.path)}
            >
              <span className={`review-status-dot mod-${file.status}`} />
              <span className="review-file-row-name" title={file.path}>
                {file.path.includes("/") && (
                  <span className="review-file-row-dir">
                    {file.path.slice(0, file.path.lastIndexOf("/") + 1)}
                  </span>
                )}
                {file.path.split("/").pop()}
              </span>
              <span className="review-file-row-stat">
                {file.additions > 0 && <ins>+{file.additions}</ins>}
                {file.deletions > 0 && <del>−{file.deletions}</del>}
              </span>
            </div>
          ))}
          {visibleFiles.length === 0 && <div className="review-empty">No files match.</div>}
        </div>
        <div className="review-sidebar-footer">
          <span className="review-total">
            <ins>+{files.reduce((sum, file) => sum + file.additions, 0)}</ins>{" "}
            <del>−{files.reduce((sum, file) => sum + file.deletions, 0)}</del>
          </span>
          {onRefresh && (
            <button className="clickable-icon" aria-label="Refresh" onClick={onRefresh}>
              <Icon name="lucide-rotate-ccw" />
            </button>
          )}
        </div>
      </div>
      <div className="review-main">
        <div className="review-toolbar">
          <div className="review-toolbar-tabs">
            <button
              className={`review-toolbar-tab${diffStyle === "unified" ? " is-active" : ""}`}
              onClick={() => switchDiffStyle("unified")}
            >
              Unified
            </button>
            <button
              className={`review-toolbar-tab${diffStyle === "split" ? " is-active" : ""}`}
              onClick={() => switchDiffStyle("split")}
            >
              Split
            </button>
          </div>
          <div className="review-toolbar-actions">
            {draftCount > 0 && !review && (
              <button className="review-action" onClick={() => void copyNotes()}>
                Copy {draftCount} note{draftCount > 1 ? "s" : ""} as Markdown
              </button>
            )}
            <button
              className="clickable-icon"
              aria-label="Keyboard shortcuts (?)"
              onClick={() => setHelpOpen((open) => !open)}
            >
              <Icon name="lucide-keyboard" />
            </button>
          </div>
        </div>
        <div className="review-codeview-host">
          {files.length === 0 ? (
            <div className="review-empty review-empty-main">
              Nothing to review — the working tree is clean.
            </div>
          ) : (
            <CodeView<CommentAnnotationMetadata>
              className="review-codeview"
              ref={codeViewRef}
              items={items}
              options={options}
              renderCustomHeader={renderHeader}
              renderGutterUtility={renderGutterUtility}
              renderAnnotation={renderAnnotation}
            />
          )}
          {helpOpen && <KeyboardHelp onClose={() => setHelpOpen(false)} />}
        </div>
        {commit && files.length > 0 && (
          <div className="review-commit-bar">
            <div className="review-commit-meta">
              {selected.size} of {files.length} files selected
            </div>
            <div className="review-commit-fields">
              <div className="review-commit-subject-row">
                <input
                  className="review-commit-subject"
                  placeholder="Commit subject"
                  maxLength={SUBJECT_LIMIT * 2}
                  value={subject}
                  onChange={(event) => setSubject(event.target.value)}
                />
                <span
                  className={`review-commit-counter${subject.length > SUBJECT_LIMIT ? " is-over" : ""}`}
                >
                  {subject.length}/{SUBJECT_LIMIT}
                </span>
              </div>
              <textarea
                className="review-commit-body"
                placeholder="Description (optional)"
                rows={2}
                value={commitBody}
                onChange={(event) => setCommitBody(event.target.value)}
              />
            </div>
            <button
              className="review-action mod-cta review-commit-button"
              disabled={busy || selected.size === 0 || subject.trim().length === 0}
              onClick={() => void doCommit()}
            >
              Commit ({selected.size})
            </button>
          </div>
        )}
        {review && (
          <div className="review-submit-bar">
            <textarea
              className="review-submit-body"
              placeholder={
                draftCount > 0
                  ? `Review summary (submits ${draftCount} inline comment${draftCount > 1 ? "s" : ""})`
                  : "Review summary"
              }
              rows={2}
              value={reviewBody}
              onChange={(event) => setReviewBody(event.target.value)}
            />
            <div className="review-submit-actions">
              {draftCount > 0 && (
                <button className="review-action" onClick={() => void copyNotes()}>
                  Copy as Markdown
                </button>
              )}
              <button
                className="review-action"
                disabled={busy || (draftCount === 0 && !reviewBody.trim())}
                onClick={() => void submitReview("COMMENT")}
              >
                Comment
              </button>
              <button
                className="review-action mod-approve"
                disabled={busy}
                onClick={() => void submitReview("APPROVE")}
              >
                Approve
              </button>
              <button
                className="review-action mod-request-changes"
                disabled={busy}
                onClick={() => void submitReview("REQUEST_CHANGES")}
              >
                Request changes
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function FileCardHeader({
  file,
  collapsed,
  viewed,
  active,
  includeInCommit,
  onToggleCollapsed,
  onToggleViewed,
  onToggleInclude,
  onOpenFile,
  onEditDiff,
}: {
  file: ReviewFile;
  collapsed: boolean;
  viewed: boolean;
  active: boolean;
  includeInCommit: boolean | null;
  onToggleCollapsed(): void;
  onToggleViewed(next: boolean): void;
  onToggleInclude?(include: boolean): void;
  onOpenFile?(): void;
  onEditDiff?(): void;
}): ReactNode {
  return (
    <div className={`review-card-header${active ? " is-active" : ""}`} onClick={onToggleCollapsed}>
      <span className={`review-chevron${collapsed ? " is-collapsed" : ""}`}>
        <Icon name="lucide-chevron-down" />
      </span>
      {includeInCommit !== null && onToggleInclude && (
        <input
          type="checkbox"
          className="review-include-checkbox"
          aria-label="Include in commit"
          checked={includeInCommit}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => onToggleInclude(event.target.checked)}
        />
      )}
      <span className="review-card-path" title={file.path}>
        {file.path.includes("/") && (
          <span className="review-card-dir">
            {file.path.slice(0, file.path.lastIndexOf("/") + 1)}
          </span>
        )}
        <span className="review-card-name">{file.path.split("/").pop()}</span>
      </span>
      <span className="review-card-stat">
        {file.binary ? (
          <span className="review-chip">Binary</span>
        ) : (
          <>
            {file.additions > 0 && <ins>+{file.additions}</ins>}
            {file.deletions > 0 && <del>−{file.deletions}</del>}
          </>
        )}
      </span>
      <span className={`review-chip mod-${file.status}`}>{file.status}</span>
      {onEditDiff && (
        <button
          className="review-card-action"
          onClick={(event) => {
            event.stopPropagation();
            onEditDiff();
          }}
        >
          Edit
        </button>
      )}
      {onOpenFile && (
        <button
          className="review-card-action"
          onClick={(event) => {
            event.stopPropagation();
            onOpenFile();
          }}
        >
          Open
        </button>
      )}
      <label className="review-viewed" onClick={(event) => event.stopPropagation()}>
        <input
          type="checkbox"
          checked={viewed}
          onChange={(event) => onToggleViewed(event.target.checked)}
        />
        Viewed
      </label>
    </div>
  );
}

function DraftCommentCard({
  draft,
  onSave,
  onDelete,
}: {
  draft: ReviewDraftComment;
  onSave(body: string): void;
  onDelete(): void;
}): ReactNode {
  const [editing, setEditing] = useState(draft.body.trim().length === 0);
  const [text, setText] = useState(draft.body);

  if (!editing) {
    return (
      <div className="review-comment-thread">
        <div className="review-comment-body">{draft.body}</div>
        <div className="review-comment-actions">
          <button className="review-card-action" onClick={() => setEditing(true)}>
            Edit
          </button>
          <button className="review-card-action" onClick={onDelete}>
            Delete
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="review-comment-thread">
      <textarea
        className="review-comment-input"
        placeholder="Leave a review comment"
        rows={3}
        autoFocus
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <div className="review-comment-actions">
        <button
          className="review-card-action mod-cta"
          disabled={!text.trim()}
          onClick={() => {
            onSave(text.trim());
            setEditing(false);
          }}
        >
          Save
        </button>
        <button className="review-card-action" onClick={onDelete}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function KeyboardHelp({ onClose }: { onClose(): void }): ReactNode {
  const rows: [string, string][] = [
    ["j / k", "Next / previous file"],
    ["v", "Toggle viewed on the active file"],
    ["x", "Collapse / expand the active file"],
    ["s", "Switch split / unified"],
    ["?", "Toggle this help"],
  ];
  return (
    <div className="review-help" onClick={onClose}>
      <div className="review-help-panel" onClick={(event) => event.stopPropagation()}>
        <div className="review-help-title">Keyboard shortcuts</div>
        {rows.map(([keys, label]) => (
          <div key={keys} className="review-help-row">
            <kbd>{keys}</kbd>
            <span>{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Icon({ name }: { name: string }): ReactNode {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (ref.current) setIcon(ref.current, name);
  }, [name]);
  return <span className="review-icon" ref={ref} />;
}

function hashVersion(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return hash >>> 0;
}

/** Shadow-DOM styling for the embedded CodeView (fonts + theme alignment). */
const REVIEW_UNSAFE_CSS = `
  :host {
    --diffs-font-family: var(--font-monospace, ui-monospace, monospace);
    --diffs-font-size: 12.5px;
    --diffs-line-height: 20px;
  }
  [data-diffs-header="custom"][data-sticky] {
    background-color: transparent;
    border-radius: 0;
  }
`;
