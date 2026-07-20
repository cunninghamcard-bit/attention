import { Events } from "../../core/Events";
import type { GitHubRepositoryRef, InvolvementQuery } from "./types";

/** The sub-views a single-repo tab switches between via its view-header (B). */
export type RepoSection =
  | "overview"
  | "pulls"
  | "commits"
  | "branches"
  | "issues"
  | "actions"
  | "files";

/**
 * What the sidebar has surfaced into the center — the Oh My GitHub model:
 * cross-repo query lists, the inbox, or a single-repo tab. Used to highlight
 * the active nav row.
 */
export type GitHubTarget =
  | { kind: "inbox" }
  | { kind: "query"; entity: "pr" | "issue"; query: InvolvementQuery }
  | { kind: "org"; org: string }
  | { kind: "repo"; owner: string; repo: string; section: RepoSection };

/** The active detail leaf, so a list can highlight its open row. Every
 * selection carries its repository: a deliberate second repo tab makes
 * `README.md` (or #1, or a run id) ambiguous without it. */
export type GitHubSelection =
  | { kind: "pr"; owner: string; repo: string; number: number }
  | { kind: "commit"; owner: string; repo: string; sha: string }
  | { kind: "issue"; owner: string; repo: string; number: number }
  | { kind: "run"; owner: string; repo: string; id: number }
  | { kind: "file"; owner: string; repo: string; path: string }
  | null;

function sameRepo(a: GitHubRepositoryRef | null, b: GitHubRepositoryRef | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.owner === b.owner && a.repo === b.repo && a.host === b.host;
}

export function targetKey(target: GitHubTarget | null): string | null {
  if (!target) return null;
  if (target.kind === "inbox") return "inbox";
  if (target.kind === "query") return `query:${target.entity}:${target.query}`;
  if (target.kind === "org") return `org:${target.org}`;
  return `repo:${target.owner}/${target.repo}`;
}

/**
 * Bridges the left-dock `GitHubNavView` and the center leaves — the cloud twin
 * of `GitReviewSession`. Pure event bus: it holds the active nav target,
 * selection, and pinned repo, and notifies subscribers; it owns no fetching.
 */
export class GitHubSession extends Events {
  target: GitHubTarget | null = null;
  selection: GitHubSelection = null;
  repo: GitHubRepositoryRef | null = null;

  setTarget(target: GitHubTarget): void {
    this.target = target;
    this.trigger("target-change", target);
  }

  select(selection: GitHubSelection): void {
    this.selection = selection;
    this.trigger("selection-change", selection);
  }

  /** Called by the service when a repository is pinned; idempotent. */
  setRepo(repo: GitHubRepositoryRef | null): void {
    if (sameRepo(this.repo, repo)) return;
    this.repo = repo;
    this.trigger("repo-change", repo);
  }
}
