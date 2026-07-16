import type { GitLogEntry } from "../GitService";
import type { GitReviewSource, ReviewFileSummary } from "../reviewSession";
import { statusFromPorcelain, type ReviewFile, type ReviewFileStatus } from "./reviewModel";

export type { ReviewFileSummary } from "../reviewSession";

export function toFileSummary(file: ReviewFile): ReviewFileSummary {
  return {
    path: file.path,
    status: file.status,
    additions: file.additions,
    deletions: file.deletions,
  };
}

/** The slice of GitService the summary loader needs. */
export interface SummaryGit {
  status(): Promise<{ path: string; status: string }[]>;
  numstat(ref?: string): Promise<{ path: string; additions: number; deletions: number }[]>;
  changedFilesIn(ref: string): Promise<{ path: string; status: string }[]>;
}

/** File summaries for a source — status + numstat only, no diff bodies. */
export async function loadFileSummaries(
  git: SummaryGit,
  source: GitReviewSource,
): Promise<ReviewFileSummary[]> {
  const [entries, numstat] =
    source.kind === "working-tree"
      ? await Promise.all([git.status(), git.numstat()])
      : await Promise.all([git.changedFilesIn(source.ref), git.numstat(source.ref)]);
  const statByPath = new Map(numstat.map((entry) => [entry.path, entry]));
  return entries.map((entry) => ({
    path: entry.path,
    status: statusFromPorcelain(entry.status),
    additions: statByPath.get(entry.path)?.additions ?? 0,
    deletions: statByPath.get(entry.path)?.deletions ?? 0,
  }));
}

// --- Hierarchical tree ----------------------------------------------------

/** Anything with a path can be hung in this tree.
 *
 * The shape is generic because the algorithm below only ever reads `path` — the
 * review's status/additions/deletions were never load-bearing, they just rode
 * along on the leaf. A second caller (GitHub's remote repository files) wants
 * the same folder structure with a different payload, and copying a 95%
 * identical tree model to get it is the thing we keep having to undo. */
export interface TreeFileSource {
  path: string;
}

/** A leaf *is* the caller's own record, plus where it sits.
 *
 * `Omit` rather than a plain intersection, because the intersection was a type
 * that described something the code does not do: for a payload carrying its own
 * `kind` (a remote tree entry naming its blob/tree, say) `T & { kind: "file" }`
 * makes TypeScript reduce **the whole node** to `never` — "property 'kind' has
 * conflicting types in some constituents" — while at runtime `{...file, kind,
 * name}` simply overwrites it and carries on. Omitting first says exactly what
 * the spread does: the leaf's own `kind`/`name` win, and the union keeps
 * discriminating. Payloads without them (ReviewFileSummary) are unaffected. */
export type TreeFileNode<T extends TreeFileSource = ReviewFileSummary> = Omit<
  T,
  "kind" | "name"
> & {
  kind: "file";
  name: string;
};

export interface TreeFolderNode<T extends TreeFileSource = ReviewFileSummary> {
  kind: "folder";
  name: string;
  path: string;
  children: TreeNode<T>[];
}

export type TreeNode<T extends TreeFileSource = ReviewFileSummary> =
  | TreeFileNode<T>
  | TreeFolderNode<T>;

function orderTree<T extends TreeFileSource>(nodes: TreeNode<T>[]): TreeNode<T>[] {
  return nodes.sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === "folder" ? -1 : 1;
    return left.name.localeCompare(right.name);
  });
}

function compressFolder<T extends TreeFileSource>(folder: TreeFolderNode<T>): TreeFolderNode<T> {
  let name = folder.name;
  let path = folder.path;
  let children = orderTree(
    folder.children.map((child) => (child.kind === "folder" ? compressFolder(child) : child)),
  );
  while (children.length === 1 && children[0].kind === "folder") {
    const child = children[0];
    name = `${name}/${child.name}`;
    path = child.path;
    children = child.children;
  }
  return { kind: "folder", name, path, children };
}

/** Builds a hierarchical folder tree from flat paths (codiff Tree). */
export function buildFileTree<T extends TreeFileSource>(files: readonly T[]): TreeNode<T>[] {
  const root: TreeFolderNode<T> = { kind: "folder", name: "", path: "", children: [] };
  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));
  for (const file of sorted) {
    const parts = file.path.split("/").filter(Boolean);
    let cursor = root;
    for (let i = 0; i < parts.length; i++) {
      const name = parts[i];
      const isFile = i === parts.length - 1;
      const path = parts.slice(0, i + 1).join("/");
      if (isFile) {
        cursor.children.push({ ...file, kind: "file", name });
      } else {
        let folder = cursor.children.find(
          (child): child is TreeFolderNode<T> => child.kind === "folder" && child.name === name,
        );
        if (!folder) {
          folder = { kind: "folder", name, path, children: [] };
          cursor.children.push(folder);
        }
        cursor = folder;
      }
    }
  }
  return orderTree(
    root.children.map((child) => (child.kind === "folder" ? compressFolder(child) : child)),
  );
}

// --- History rows ---------------------------------------------------------

export type HistoryRow =
  | { kind: "working-tree"; key: "working-tree"; subject: string }
  | {
      kind: "commit";
      key: string;
      ref: string;
      shortHash: string;
      subject: string;
      author: string;
      avatarUrl?: string;
      date: string;
    };

/** Codiff-style history: Uncommitted changes first, then local commits. */
export function buildHistoryRows(entries: readonly GitLogEntry[]): HistoryRow[] {
  return [
    { kind: "working-tree", key: "working-tree", subject: "Uncommitted changes" },
    ...entries.map((entry) => ({
      kind: "commit" as const,
      key: entry.hash,
      ref: entry.hash,
      shortHash: entry.shortHash,
      subject: entry.subject,
      author: entry.author,
      avatarUrl: entry.avatarUrl,
      date: entry.date,
    })),
  ];
}

export function sourceKey(source: GitReviewSource): string {
  return source.kind === "working-tree" ? "working-tree" : `commit:${source.ref}`;
}

export function historyRowSelected(row: HistoryRow, source: GitReviewSource): boolean {
  if (row.kind === "working-tree") return source.kind === "working-tree";
  return source.kind === "commit" && source.ref === row.ref;
}
