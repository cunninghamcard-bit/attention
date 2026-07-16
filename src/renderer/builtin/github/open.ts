import type { App } from "../../app/App";
import type { View } from "../../views/View";
import type { PaneType } from "../../views/workspace/Workspace";
import type { WorkspaceLeaf } from "../../views/workspace/WorkspaceLeaf";
import type { GitHubTarget, RepoSection } from "./session";
import type { InvolvementQuery, NotificationItem } from "./types";
import { openInSystemBrowser } from "./widgets";

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

/** The notifications inbox. `eState` focuses one row — the host's ephemeral
 * state, the same mechanism a link uses to land on a heading. */
export async function openInbox(
  app: App,
  openIn?: OpenIn,
  eState?: { notificationId: string },
): Promise<void> {
  const leaf = centerLeaf(app, GITHUB_VIEW.list, openIn);
  await leaf.setViewState(
    {
      type: GITHUB_VIEW.list,
      active: true,
      state: { kind: "notifications" },
    },
    eState,
  );
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

/** Map a notification's API subject URL to its github.com page.
 *
 * The notifications API hands back `api.github.com/repos/o/r/issues/42` and no
 * `html_url`, so the web address has to be derived. Only the three shapes whose
 * web paths we actually know are mapped — and the REST plural becomes the web
 * singular (`pulls` -> `pull`, `commits` -> `commit`). Anything else (a null
 * subject URL, a Discussion, a Release, a CheckSuite) returns null rather than
 * an invented address. */
export function notificationWebUrl(item: NotificationItem): string | null {
  const source = item.url ?? item.subjectUrl;
  if (!source) return null;
  const match = /\/repos\/([^/]+)\/([^/]+)\/(issues|pulls|commits)\/([^/?#]+)/.exec(source);
  if (!match) return null;
  const [, owner, repo, kind, id] = match;
  const path = kind === "pulls" ? "pull" : kind === "commits" ? "commit" : "issues";
  return `https://github.com/${owner}/${repo}/${path}/${id}`;
}

/** Activating a notification goes to its real GitHub page — the app has no
 * faithful view of a notification's world (Discussions, Releases, CI). What we
 * cannot map, we do not guess: those stay in the center inbox, focused on their
 * own row, rather than being translated into some other repository page. */
export async function openNotificationTarget(
  app: App,
  item: NotificationItem,
  openIn?: OpenIn,
  /** The leaf the row was activated from, when there is one. A center row must
   * drive its own tab; the dock has no source leaf and reuses whichever inbox
   * is open. Third time this bit: a global helper that picks
   * `getLeavesOfType(...)[0]` always drives someone else's tab. */
  source?: WorkspaceLeaf,
): Promise<void> {
  const url = notificationWebUrl(item);
  if (url) return void openInSystemBrowser(url);
  // A modifier still forks deliberately — the reuse path must not swallow it.
  if (!openIn) {
    const inbox = isInbox(source)
      ? source
      : app.workspace.getLeavesOfType(GITHUB_VIEW.list).find(isInbox);
    if (inbox) {
      // Focus in place: setViewState would rebuild and refetch the very list we
      // are looking at, and that reload's draw would wipe the focus.
      inbox.view.setEphemeralState({ notificationId: item.id });
      app.workspace.setActiveLeaf(inbox, { focus: true });
      return;
    }
  }
  await openInbox(app, openIn, { notificationId: item.id });
}

function isInbox(leaf?: WorkspaceLeaf): leaf is WorkspaceLeaf {
  return leaf?.view?.getState?.().kind === "notifications";
}

export type { GitHubTarget };
