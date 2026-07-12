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

export type GithubWorkspaceSection = "pulls" | "commits" | "branches" | "local";
