/** Cloud GitHub pull-request model — app-owned auth, no gh CLI. */

export type PrListFilter = "open" | "mine" | "review-requested" | "all";

export type PrState = "open" | "closed" | "merged";

export type CiState = "success" | "pending" | "failure" | "error" | "neutral" | "unknown";

export interface GitHubActor {
  login: string;
  avatarUrl: string;
  url: string;
}

export interface PrLabel {
  name: string;
  color: string;
  description: string | null;
}

export interface PrSummary {
  number: number;
  title: string;
  state: PrState;
  isDraft: boolean;
  author: GitHubActor;
  headRefName: string;
  baseRefName: string;
  updatedAt: string;
  createdAt: string;
  url: string;
  labels: PrLabel[];
  reviewDecision: string | null;
  additions: number;
  deletions: number;
  changedFiles: number;
  ciState: CiState | null;
}

export interface PrFileChange {
  path: string;
  previousPath: string | null;
  status: "added" | "removed" | "modified" | "renamed" | "copied" | "changed" | "unchanged";
  additions: number;
  deletions: number;
  /** Unified patch for this file; null when binary / too large. */
  patch: string | null;
}

export interface PrComment {
  id: string;
  author: GitHubActor;
  body: string;
  createdAt: string;
  updatedAt: string;
  url: string;
}

export interface PrReviewComment {
  id: string;
  author: GitHubActor;
  body: string;
  path: string;
  line: number | null;
  side: "LEFT" | "RIGHT" | null;
  createdAt: string;
  url: string;
  diffHunk: string;
  inReplyToId: string | null;
}

export interface PrReview {
  id: string;
  author: GitHubActor;
  state: "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "DISMISSED" | "PENDING" | string;
  body: string;
  submittedAt: string | null;
  url: string;
}

export interface PrCommit {
  sha: string;
  shortSha: string;
  messageHeadline: string;
  message: string;
  author: GitHubActor;
  committedDate: string;
  url: string;
  ciState: CiState | null;
}

export interface PrCheck {
  name: string;
  status: string;
  conclusion: string | null;
  detailsUrl: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

export interface PrDetail extends PrSummary {
  body: string;
  headRefOid: string;
  mergeable: boolean | null;
  mergeStateStatus: string | null;
  comments: PrComment[];
  reviews: PrReview[];
  reviewComments: PrReviewComment[];
  commits: PrCommit[];
  files: PrFileChange[];
  checks: PrCheck[];
  requestedReviewers: GitHubActor[];
  assignees: GitHubActor[];
  milestone: { title: string; url: string } | null;
}

export interface PrDraftComment {
  path: string;
  line: number;
  side: "additions" | "deletions";
  body: string;
}

export interface GitHubAuthState {
  hasToken: boolean;
  login: string | null;
  avatarUrl: string | null;
  name: string | null;
}

export interface GitHubRepositoryRef {
  owner: string;
  repo: string;
  host: string;
}

export interface GitHubApiError {
  status: number;
  message: string;
}

/** Branch list entry for the Commits / Branches sections. */
export interface GitHubBranch {
  name: string;
  commitSha: string;
  protected: boolean;
}

/** One row in the repository commits timeline. */
export interface CommitSummary {
  sha: string;
  shortSha: string;
  message: string;
  headline: string;
  author: GitHubActor;
  /** Git author name when not linked to a GitHub user. */
  authorName: string | null;
  committedDate: string;
  url: string;
}

export interface CommitPage {
  items: CommitSummary[];
  page: number;
  perPage: number;
  hasPreviousPage: boolean;
  hasNextPage: boolean;
  /** Branch / ref used for the query. */
  ref: string;
}

export interface CommitFileChange {
  path: string;
  previousPath: string | null;
  status: "added" | "removed" | "modified" | "renamed" | "copied" | "changed" | "unchanged";
  additions: number;
  deletions: number;
  patch: string | null;
}

/** Full commit detail (Oh My GitHub commit page). */
export interface CommitDetail {
  sha: string;
  shortSha: string;
  headline: string;
  message: string;
  author: GitHubActor;
  authorName: string | null;
  committer: GitHubActor | null;
  committedDate: string;
  authoredDate: string;
  url: string;
  parents: Array<{ sha: string; shortSha: string; url: string }>;
  stats: { additions: number; deletions: number; total: number };
  files: CommitFileChange[];
  verification: { verified: boolean; reason: string | null } | null;
  ciState: CiState | null;
  checks: PrCheck[];
}

export type GithubWorkspaceSection =
  | "pulls"
  | "issues"
  | "commits"
  | "files"
  | "actions"
  | "branches"
  | "inbox"
  | "local";

export type IssueState = "open" | "closed";

export interface IssueSummary {
  number: number;
  title: string;
  state: IssueState;
  author: GitHubActor;
  createdAt: string;
  updatedAt: string;
  url: string;
  labels: PrLabel[];
  comments: number;
  isPullRequest: boolean;
}

/** A comment in the issue timeline. The REST timeline returns these as
 * `commented` entries carrying the body, so they arrive with the events. */
export interface IssueTimelineComment extends PrComment {
  kind: "comment";
}

/** Anything that happened to the issue that is not a comment. `event` is
 * GitHub's own name (labeled / assigned / closed / renamed / referenced …);
 * the view renders the ones it knows and skips the rest. */
export interface IssueTimelineEvent {
  kind: "event";
  id: string;
  event: string;
  actor: GitHubActor;
  createdAt: string;
  /** labeled / unlabeled */
  label: PrLabel | null;
  /** assigned / unassigned */
  assignee: GitHubActor | null;
  /** milestoned / demilestoned */
  milestone: string | null;
  /** renamed */
  rename: { from: string; to: string } | null;
}

export type IssueTimelineItem = IssueTimelineComment | IssueTimelineEvent;

export interface IssueDetail extends IssueSummary {
  body: string;
  assignees: GitHubActor[];
  milestone: { title: string; url: string } | null;
  /** Comments and events interleaved, oldest first — the OMG/GitHub issue body. */
  timeline: IssueTimelineItem[];
  closedAt: string | null;
}

/** Cross-repo involvement query (author/review-requested/mentioned). The search
 * API returns PRs and issues uniformly, each carrying its own repository. */
export type InvolvementQuery = "created" | "review-requested" | "mentioned" | "assigned";

export interface GitHubSearchItem {
  owner: string;
  repo: string;
  number: number;
  title: string;
  state: IssueState;
  isDraft: boolean;
  isPullRequest: boolean;
  author: GitHubActor;
  createdAt: string;
  updatedAt: string;
  url: string;
  labels: PrLabel[];
  comments: number;
}

export interface ActionRunSummary {
  id: number;
  name: string;
  displayTitle: string;
  status: string;
  conclusion: string | null;
  headBranch: string;
  headSha: string;
  event: string;
  url: string;
  htmlUrl: string;
  createdAt: string;
  updatedAt: string;
  runNumber: number;
  attempt: number;
}

export interface ActionJob {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  startedAt: string | null;
  completedAt: string | null;
  steps: Array<{
    name: string;
    status: string;
    conclusion: string | null;
    number: number;
  }>;
}

export interface ActionRunDetail extends ActionRunSummary {
  jobs: ActionJob[];
}

export interface RepoContentItem {
  name: string;
  path: string;
  type: "file" | "dir" | "symlink" | "submodule";
  size: number;
  sha: string;
  url: string;
  htmlUrl: string;
  downloadUrl: string | null;
}

export interface RepoFileContent {
  path: string;
  name: string;
  sha: string;
  size: number;
  encoding: string;
  /** Decoded utf-8 text when possible; null for binary/large. */
  text: string | null;
  htmlUrl: string;
  downloadUrl: string | null;
}

export type NotificationReason =
  | "assign"
  | "author"
  | "comment"
  | "invitation"
  | "manual"
  | "mention"
  | "review_requested"
  | "security_alert"
  | "state_change"
  | "subscribed"
  | "team_mention"
  | "ci_activity"
  | string;

export interface NotificationItem {
  id: string;
  unread: boolean;
  reason: NotificationReason;
  updatedAt: string;
  title: string;
  type: string;
  url: string | null;
  repository: string;
  owner: string;
  repo: string;
  subjectUrl: string | null;
  /** The repository's github.com page. The web fallback for any subject we
   * cannot map — it ships in the notifications payload. */
  repositoryHtmlUrl: string;
}

export type MergeMethod = "merge" | "squash" | "rebase";

export interface MergeResult {
  merged: boolean;
  message: string;
  sha: string | null;
}

// --- Profile (account overview) -------------------------------------------

/** A user or organization page's identity head.
 *
 * `isOrganization` is not cosmetic — it decides which sections can exist at
 * all. The GraphQL `Organization` type has no `contributionsCollection`,
 * `starredRepositories` or `followers` (verified by schema introspection), so
 * an org has no heatmap, no stat tiles, no Stars and no Followers. Oh My
 * GitHub branches the same way (`accounts.ts:548`, returning
 * `contributionYears: []` for orgs). */
export interface GitHubProfile {
  login: string;
  name: string | null;
  avatarUrl: string;
  bio: string | null;
  isOrganization: boolean;
  followers: number;
  following: number;
  publicRepos: number;
  publicGists: number;
  /** ISO date; the head's "Joined <date>". */
  createdAt: string;
  htmlUrl: string;
}

/** A repository as it appears in a pinned grid (GraphQL `pinnedItems`). */
export interface PinnedRepository {
  owner: string;
  repo: string;
  nameWithOwner: string;
  description: string | null;
  language: string | null;
  /** GitHub's language dot colour — the one hex we do keep, because it is the
   * language's identity (Rust orange), not a theme decision. */
  languageColor: string | null;
  stars: number;
  forks: number;
  isPrivate: boolean;
  url: string;
}

/** Heat of one day, 0–4.
 *
 * Mapped from GraphQL's `contributionLevel` enum
 * (NONE | FIRST_QUARTILE | … | FOURTH_QUARTILE — verified by introspection),
 * deliberately *not* from the sibling `color` field. `color` is GitHub's own
 * light-mode green; Oh My GitHub passes it through, but this app is themed and
 * must render the scale in host variables, so the view needs a level, not a
 * hex. GitHub does the quartile maths server-side — we neither invent it nor
 * re-derive it. */
export type ContributionLevel = 0 | 1 | 2 | 3 | 4;

export interface ContributionDay {
  /** ISO date (YYYY-MM-DD). */
  date: string;
  count: number;
  level: ContributionLevel;
}

export interface ContributionWeek {
  firstDay: string;
  days: ContributionDay[];
}

/** The four tiles under the heatmap. */
export interface ContributionStats {
  commits: number;
  pullRequests: number;
  codeReviews: number;
  issues: number;
}

export interface ContributionCalendar {
  year: number;
  /** The head line: "<n> contributions in <year>". */
  totalContributions: number;
  /** Contributions the token cannot see through to; GitHub reports the count
   * so the page can say so instead of silently under-reporting. */
  restrictedContributions: number;
  weeks: ContributionWeek[];
  stats: ContributionStats;
}

/** Everything the Overview section needs in one round trip. */
export interface GitHubProfileOverview {
  profile: GitHubProfile;
  pinned: PinnedRepository[];
  /** Years the year-picker may offer, newest first. **Empty for an
   * organization** — see `GitHubProfile.isOrganization`. */
  contributionYears: number[];
}
