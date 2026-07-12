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

export interface IssueDetail extends IssueSummary {
  body: string;
  assignees: GitHubActor[];
  milestone: { title: string; url: string } | null;
  commentsList: PrComment[];
  closedAt: string | null;
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
}

export type MergeMethod = "merge" | "squash" | "rebase";

export interface MergeResult {
  merged: boolean;
  message: string;
  sha: string | null;
}
