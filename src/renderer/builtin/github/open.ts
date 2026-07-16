import type { App } from "../../app/App";
import type { View } from "../../views/View";
import type { PaneType } from "../../views/workspace/Workspace";
import type { WorkspaceLeaf } from "../../views/workspace/WorkspaceLeaf";
import type { GitHubTarget, RepoSection } from "./session";
import type { InvolvementQuery, NotificationItem } from "./types";

/** cmd/ctrl-activate opts into a second tab; `Keymap.isModEvent` hands us the
 * PaneType directly, so callers forward its result verbatim. */
export type OpenIn = PaneType | false | undefined;

/** View types owned by the GitHub core plugin. Legacy ids kept for git-pr /
 * git-commit so persisted layout state still resolves. */
export const GITHUB_VIEW = {
  nav: "github-nav",
  list: "github-list",
  repo: "github-repo",
  prDetail: "git-pr",
  commit: "git-commit",
  detail: "github-detail",
} as const;

/** Light-section center targets (issue / run / file) share one leaf type. */
export type GitHubDetailTarget =
  | { kind: "issue"; number: number; owner: string; repo: string }
  | { kind: "run"; id: number; owner: string; repo: string }
  | { kind: "file"; path: string; ref: string; owner: string; repo: string };

/** One leaf per view type — every new target re-targets the open leaf through
 * `setViewState`, which records history, so the native back/forward walk the
 * trail instead of the workspace minting a tab per query. A second tab exists
 * only when the user asks for one.
 *
 * These helpers pick a leaf and hand it a view state. They carry **no session
 * side effects**: `back()` / `forward()` call `setState` directly and never
 * come through here, so anything written on the way in would desynchronise the
 * moment the user steps through history. Each view syncs the session from its
 * own `setState` — the single entry point every path shares. */
function centerLeaf(app: App, type: string, openIn?: OpenIn): WorkspaceLeaf {
  if (openIn) return app.workspace.getLeaf(openIn);
  return app.workspace.getLeavesOfType(type)[0] ?? app.workspace.getLeaf("tab");
}

/** Open (or focus) the left-dock GitHub navigator. */
export async function openGitHubNav(app: App): Promise<void> {
  await app.workspace.ensureSideLeaf(GITHUB_VIEW.nav, "left", {
    active: true,
    reveal: true,
  });
}

/** A cross-repo involvement query (Created by Me / Needs Review / …). */
export async function openQueryList(
  app: App,
  entity: "pr" | "issue",
  query: InvolvementQuery,
  openIn?: OpenIn,
): Promise<void> {
  const leaf = centerLeaf(app, GITHUB_VIEW.list, openIn);
  await leaf.setViewState({
    type: GITHUB_VIEW.list,
    active: true,
    state: { kind: entity, query },
  });
  app.workspace.setActiveLeaf(leaf, { focus: true });
}

/** The notifications inbox. */
export async function openInbox(app: App, openIn?: OpenIn): Promise<void> {
  const leaf = centerLeaf(app, GITHUB_VIEW.list, openIn);
  await leaf.setViewState({
    type: GITHUB_VIEW.list,
    active: true,
    state: { kind: "notifications" },
  });
  app.workspace.setActiveLeaf(leaf, { focus: true });
}

/** An organization — center tab lists that org's repositories (repos stay out of the side).
 * The profile tab replaces this door in the github-profile goal. */
export async function openOrg(app: App, org: string, openIn?: OpenIn): Promise<void> {
  const login = org.trim();
  if (!login) return;
  const leaf = centerLeaf(app, GITHUB_VIEW.list, openIn);
  await leaf.setViewState({
    type: GITHUB_VIEW.list,
    active: true,
    state: { kind: "org", org: login },
  });
  app.workspace.setActiveLeaf(leaf, { focus: true });
}

/** A single repository tab (sub-views switch inside it via its header). */
export async function openRepo(
  app: App,
  owner: string,
  repo: string,
  section: RepoSection = "overview",
  openIn?: OpenIn,
): Promise<void> {
  const leaf = centerLeaf(app, GITHUB_VIEW.repo, openIn);
  await leaf.setViewState({
    type: GITHUB_VIEW.repo,
    active: true,
    state: { owner, repo, section },
  });
  app.workspace.setActiveLeaf(leaf, { focus: true });
}

export async function openPrDetail(
  app: App,
  owner: string,
  repo: string,
  number: number,
  openIn?: OpenIn,
): Promise<void> {
  const leaf = centerLeaf(app, GITHUB_VIEW.prDetail, openIn);
  await leaf.setViewState({
    type: GITHUB_VIEW.prDetail,
    active: true,
    state: { number, owner, repo },
  });
  app.workspace.setActiveLeaf(leaf, { focus: true });
}

export async function openCommitDetail(
  app: App,
  owner: string,
  repo: string,
  sha: string,
  openIn?: OpenIn,
): Promise<void> {
  const leaf = centerLeaf(app, GITHUB_VIEW.commit, openIn);
  await leaf.setViewState({
    type: GITHUB_VIEW.commit,
    active: true,
    state: { sha, owner, repo },
  });
  app.workspace.setActiveLeaf(leaf, { focus: true });
}

export async function openGitHubDetail(
  app: App,
  target: GitHubDetailTarget,
  openIn?: OpenIn,
): Promise<void> {
  const leaf = centerLeaf(app, GITHUB_VIEW.detail, openIn);
  await leaf.setViewState({
    type: GITHUB_VIEW.detail,
    active: true,
    state: target,
  });
  app.workspace.setActiveLeaf(leaf, { focus: true });
}

const GITHUB_VIEW_TYPES: ReadonlySet<string> = new Set(Object.values(GITHUB_VIEW));

/** Manual refresh. The headers carry no Refresh button (a section reloads when
 * activated), so this command is the deliberate reload: the active GitHub tab
 * plus the dock, which has no other way to be refreshed. */
export function refreshGitHub(app: App): void {
  const targets = new Set<View>();
  const active = app.workspace.activeLeaf?.view;
  if (active && GITHUB_VIEW_TYPES.has(active.getViewType())) targets.add(active);
  for (const leaf of app.workspace.getLeavesOfType(GITHUB_VIEW.nav))
    if (leaf.view) targets.add(leaf.view);

  for (const view of targets) if (isRefreshable(view)) view.refresh();
}

/** Views that can reload themselves on demand. */
interface RefreshableView {
  refresh(): void;
}

function isRefreshable(view: View): view is View & RefreshableView {
  return typeof (view as Partial<RefreshableView>).refresh === "function";
}

/** Resolve a notification's subject to a center destination. Subjects we have
 * no view for (Discussion / Release / CheckSuite carry a null or unparseable
 * subject URL) land on the owning repository rather than dead-ending. Shared so
 * the dock and the center list resolve a row the same way. */
export async function openNotificationTarget(
  app: App,
  item: NotificationItem,
  openIn?: OpenIn,
): Promise<void> {
  const subject = /\/repos\/([^/]+)\/([^/]+)\/(?:issues|pulls)\/(\d+)/;
  const match = item.url?.match(subject) ?? item.subjectUrl?.match(subject);
  if (match) {
    const isPull = /pulls/.test(item.url ?? item.subjectUrl ?? "");
    if (isPull) await openPrDetail(app, match[1], match[2], Number(match[3]), openIn);
    else
      await openGitHubDetail(
        app,
        { kind: "issue", number: Number(match[3]), owner: match[1], repo: match[2] },
        openIn,
      );
    return;
  }
  const commit = item.url?.match(/\/repos\/([^/]+)\/([^/]+)\/commits\/([a-f0-9]+)/i);
  if (commit) {
    await openCommitDetail(app, commit[1], commit[2], commit[3], openIn);
    return;
  }
  if (item.owner && item.repo) await openRepo(app, item.owner, item.repo, "overview", openIn);
}

export type { GitHubTarget };
