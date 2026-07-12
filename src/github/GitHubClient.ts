import type {
  CiState,
  GitHubActor,
  GitHubAuthState,
  GitHubRepositoryRef,
  PrCheck,
  PrComment,
  PrCommit,
  PrDetail,
  PrDraftComment,
  PrFileChange,
  PrLabel,
  PrListFilter,
  PrReview,
  PrReviewComment,
  PrState,
  PrSummary,
} from "./types";
import { apiBaseUrlForHost } from "./resolveRepository";

export interface HttpResponse {
  status: number;
  text: string;
  json: unknown;
}

export type HttpTransport = (options: {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}) => Promise<HttpResponse>;

const ACCEPT = "application/vnd.github+json";
const API_VERSION = "2022-11-28";

/**
 * Thin GitHub REST client. Transport is injected so tests and the desktop
 * `request-url` bridge can share the same mapping logic — no gh CLI.
 */
export class GitHubClient {
  constructor(
    private readonly transport: HttpTransport,
    private token: string | null,
    private readonly host: string = "github.com",
  ) {}

  setToken(token: string | null): void {
    this.token = token?.trim() || null;
  }

  get hasToken(): boolean {
    return Boolean(this.token);
  }

  async getAuth(): Promise<GitHubAuthState> {
    if (!this.token) return { hasToken: false, login: null, avatarUrl: null, name: null };
    const res = await this.request("GET", "/user");
    if (res.status === 401 || res.status === 403) {
      return { hasToken: true, login: null, avatarUrl: null, name: null };
    }
    if (res.status >= 400) throw apiError(res);
    const user = res.json as { login?: string; avatar_url?: string; name?: string | null };
    return {
      hasToken: true,
      login: user.login ?? null,
      avatarUrl: user.avatar_url ?? null,
      name: user.name ?? null,
    };
  }

  async listPullRequests(repo: GitHubRepositoryRef, filter: PrListFilter = "open"): Promise<PrSummary[]> {
    if (filter === "mine" || filter === "review-requested") {
      return this.searchPullRequests(repo, filter);
    }
    const state = filter === "all" ? "all" : "open";
    const res = await this.request(
      "GET",
      `/repos/${repo.owner}/${repo.repo}/pulls?state=${state}&sort=updated&direction=desc&per_page=40`,
    );
    if (res.status >= 400) throw apiError(res);
    const items = (res.json as RawPull[]) ?? [];
    return items.map((item) => mapSummary(item));
  }

  async getPullRequest(repo: GitHubRepositoryRef, number: number): Promise<PrDetail> {
    const [prRes, commentsRes, reviewsRes, reviewCommentsRes, commitsRes, filesRes] = await Promise.all([
      this.request("GET", `/repos/${repo.owner}/${repo.repo}/pulls/${number}`),
      this.request("GET", `/repos/${repo.owner}/${repo.repo}/issues/${number}/comments?per_page=100`),
      this.request("GET", `/repos/${repo.owner}/${repo.repo}/pulls/${number}/reviews?per_page=100`),
      this.request("GET", `/repos/${repo.owner}/${repo.repo}/pulls/${number}/comments?per_page=100`),
      this.request("GET", `/repos/${repo.owner}/${repo.repo}/pulls/${number}/commits?per_page=100`),
      this.request("GET", `/repos/${repo.owner}/${repo.repo}/pulls/${number}/files?per_page=100`),
    ]);
    if (prRes.status >= 400) throw apiError(prRes);
    const pr = prRes.json as RawPullDetail;
    const headSha = pr.head?.sha ?? "";
    const checks = headSha ? await this.listChecks(repo, headSha) : [];
    const ciState = rollupCi(checks);

    return {
      ...mapSummary(pr),
      body: pr.body ?? "",
      headRefOid: headSha,
      mergeable: typeof pr.mergeable === "boolean" ? pr.mergeable : null,
      mergeStateStatus: pr.mergeable_state ?? null,
      comments: okList(commentsRes).map(mapIssueComment),
      reviews: okList(reviewsRes).map(mapReview).filter((review) => review.state !== "PENDING"),
      reviewComments: okList(reviewCommentsRes).map(mapReviewComment),
      commits: okList(commitsRes).map(mapCommit),
      files: okList(filesRes).map(mapFile),
      checks,
      ciState,
      requestedReviewers: (pr.requested_reviewers ?? []).map(mapActor),
      assignees: (pr.assignees ?? []).map(mapActor),
      milestone: pr.milestone ? { title: pr.milestone.title, url: pr.milestone.html_url } : null,
    };
  }

  /** Full unified diff for the PR (same as the Files tab "raw" patch). */
  async getPullRequestDiff(repo: GitHubRepositoryRef, number: number): Promise<string> {
    const res = await this.request("GET", `/repos/${repo.owner}/${repo.repo}/pulls/${number}`, {
      accept: "application/vnd.github.v3.diff",
    });
    if (res.status >= 400) throw apiError(res);
    return res.text;
  }

  async createIssueComment(repo: GitHubRepositoryRef, number: number, body: string): Promise<void> {
    const res = await this.request("POST", `/repos/${repo.owner}/${repo.repo}/issues/${number}/comments`, {
      body: { body },
    });
    if (res.status >= 400) throw apiError(res);
  }

  async submitReview(
    repo: GitHubRepositoryRef,
    number: number,
    event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT",
    body: string,
    comments: PrDraftComment[],
  ): Promise<void> {
    const payload = {
      body: body || (event === "REQUEST_CHANGES" && comments.length === 0 ? "Requesting changes." : body),
      event,
      comments: comments.map((comment) => ({
        path: comment.path,
        body: comment.body,
        line: comment.line,
        side: comment.side === "deletions" ? "LEFT" : "RIGHT",
      })),
    };
    const res = await this.request("POST", `/repos/${repo.owner}/${repo.repo}/pulls/${number}/reviews`, {
      body: payload,
    });
    if (res.status >= 400) throw apiError(res);
  }

  private async listChecks(repo: GitHubRepositoryRef, sha: string): Promise<PrCheck[]> {
    const res = await this.request("GET", `/repos/${repo.owner}/${repo.repo}/commits/${sha}/check-runs?per_page=100`);
    if (res.status >= 400) return [];
    const runs = ((res.json as { check_runs?: RawCheckRun[] })?.check_runs) ?? [];
    return runs.map((run) => ({
      name: run.name ?? run.app?.name ?? "check",
      status: run.status ?? "queued",
      conclusion: run.conclusion ?? null,
      detailsUrl: run.details_url ?? run.html_url ?? null,
      startedAt: run.started_at ?? null,
      completedAt: run.completed_at ?? null,
    }));
  }

  private async searchPullRequests(repo: GitHubRepositoryRef, filter: "mine" | "review-requested"): Promise<PrSummary[]> {
    const qualifier = filter === "mine" ? "author:@me" : "review-requested:@me";
    const q = encodeURIComponent(`is:pr is:open repo:${repo.owner}/${repo.repo} ${qualifier}`);
    const res = await this.request("GET", `/search/issues?q=${q}&sort=updated&order=desc&per_page=40`);
    if (res.status >= 400) throw apiError(res);
    const items = ((res.json as { items?: RawSearchIssue[] })?.items) ?? [];
    // Search results lack branch names — hydrate from PR endpoint in parallel (cap).
    const numbers = items.map((item) => item.number).filter((n): n is number => typeof n === "number").slice(0, 20);
    const details = await Promise.all(
      numbers.map(async (number) => {
        const prRes = await this.request("GET", `/repos/${repo.owner}/${repo.repo}/pulls/${number}`);
        if (prRes.status >= 400) return null;
        return mapSummary(prRes.json as RawPull);
      }),
    );
    return details.filter((item): item is PrSummary => item !== null);
  }

  private async request(
    method: string,
    path: string,
    options: { body?: unknown; accept?: string } = {},
  ): Promise<HttpResponse> {
    if (!this.token) {
      return { status: 401, text: "missing token", json: { message: "Not authenticated" } };
    }
    const base = apiBaseUrlForHost(this.host);
    const url = path.startsWith("http") ? path : `${base}${path}`;
    const headers: Record<string, string> = {
      Accept: options.accept ?? ACCEPT,
      Authorization: `Bearer ${this.token}`,
      "X-GitHub-Api-Version": API_VERSION,
      "User-Agent": "Arkloop-GitHub",
    };
    let body: string | undefined;
    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(options.body);
    }
    return this.transport({ url, method, headers, body });
  }
}

// --- mappers -------------------------------------------------------------

function mapActor(raw: RawUser | null | undefined): GitHubActor {
  return {
    login: raw?.login ?? "unknown",
    avatarUrl: raw?.avatar_url ?? "",
    url: raw?.html_url ?? "",
  };
}

function mapLabel(raw: RawLabel): PrLabel {
  return {
    name: raw.name,
    color: raw.color ?? "ededed",
    description: raw.description ?? null,
  };
}

function mapSummary(raw: RawPull): PrSummary {
  const state = mapState(raw);
  return {
    number: raw.number,
    title: raw.title ?? "",
    state,
    isDraft: Boolean(raw.draft),
    author: mapActor(raw.user),
    headRefName: raw.head?.ref ?? "",
    baseRefName: raw.base?.ref ?? "",
    updatedAt: raw.updated_at ?? raw.created_at ?? "",
    createdAt: raw.created_at ?? "",
    url: raw.html_url ?? "",
    labels: (raw.labels ?? []).map(mapLabel),
    reviewDecision: null,
    additions: raw.additions ?? 0,
    deletions: raw.deletions ?? 0,
    changedFiles: raw.changed_files ?? 0,
    ciState: null,
  };
}

function mapState(raw: RawPull): PrState {
  if (raw.merged_at || raw.merged) return "merged";
  if (raw.state === "closed") return "closed";
  return "open";
}

function mapIssueComment(raw: RawIssueComment): PrComment {
  return {
    id: String(raw.id),
    author: mapActor(raw.user),
    body: raw.body ?? "",
    createdAt: raw.created_at ?? "",
    updatedAt: raw.updated_at ?? "",
    url: raw.html_url ?? "",
  };
}

function mapReview(raw: RawReview): PrReview {
  return {
    id: String(raw.id),
    author: mapActor(raw.user),
    state: raw.state ?? "COMMENTED",
    body: raw.body ?? "",
    submittedAt: raw.submitted_at ?? null,
    url: raw.html_url ?? "",
  };
}

function mapReviewComment(raw: RawReviewComment): PrReviewComment {
  return {
    id: String(raw.id),
    author: mapActor(raw.user),
    body: raw.body ?? "",
    path: raw.path ?? "",
    line: raw.line ?? raw.original_line ?? null,
    side: (raw.side as "LEFT" | "RIGHT" | null) ?? null,
    createdAt: raw.created_at ?? "",
    url: raw.html_url ?? "",
    diffHunk: raw.diff_hunk ?? "",
    inReplyToId: raw.in_reply_to_id != null ? String(raw.in_reply_to_id) : null,
  };
}

function mapCommit(raw: RawCommit): PrCommit {
  const message = raw.commit?.message ?? "";
  const headline = message.split("\n")[0] ?? "";
  const login = raw.author?.login ?? raw.commit?.author?.name ?? "unknown";
  return {
    sha: raw.sha ?? "",
    shortSha: (raw.sha ?? "").slice(0, 7),
    messageHeadline: headline,
    message,
    author: {
      login,
      avatarUrl: raw.author?.avatar_url ?? "",
      url: raw.author?.html_url ?? "",
    },
    committedDate: raw.commit?.committer?.date ?? raw.commit?.author?.date ?? "",
    url: raw.html_url ?? "",
    ciState: null,
  };
}

function mapFile(raw: RawFile): PrFileChange {
  const status = (raw.status ?? "modified") as PrFileChange["status"];
  return {
    path: raw.filename ?? "",
    previousPath: raw.previous_filename ?? null,
    status,
    additions: raw.additions ?? 0,
    deletions: raw.deletions ?? 0,
    patch: raw.patch ?? null,
  };
}

function rollupCi(checks: PrCheck[]): CiState | null {
  if (checks.length === 0) return null;
  const conclusions = checks.map((check) => (check.conclusion ?? check.status).toLowerCase());
  if (conclusions.some((c) => c === "failure" || c === "timed_out" || c === "action_required")) return "failure";
  if (conclusions.some((c) => c === "cancelled" || c === "error" || c === "startup_failure")) return "error";
  if (conclusions.some((c) => c === "pending" || c === "queued" || c === "in_progress" || c === "waiting")) return "pending";
  if (conclusions.every((c) => c === "success" || c === "neutral" || c === "skipped" || c === "completed")) {
    if (conclusions.some((c) => c === "success" || c === "completed")) return "success";
    return "neutral";
  }
  return "unknown";
}

function okList(res: HttpResponse): any[] {
  if (res.status >= 400) return [];
  return Array.isArray(res.json) ? res.json : [];
}

function apiError(res: HttpResponse): Error {
  const message =
    (res.json as { message?: string } | null)?.message ||
    res.text?.slice(0, 200) ||
    `GitHub API error ${res.status}`;
  const error = new Error(message) as Error & { status: number };
  error.status = res.status;
  return error;
}

// --- raw shapes (minimal) ------------------------------------------------

interface RawUser {
  login?: string;
  avatar_url?: string;
  html_url?: string;
  name?: string;
}

interface RawLabel {
  name: string;
  color?: string;
  description?: string | null;
}

interface RawPull {
  number: number;
  title?: string;
  state?: string;
  draft?: boolean;
  merged?: boolean;
  merged_at?: string | null;
  user?: RawUser | null;
  head?: { ref?: string; sha?: string } | null;
  base?: { ref?: string } | null;
  updated_at?: string;
  created_at?: string;
  html_url?: string;
  labels?: RawLabel[];
  additions?: number;
  deletions?: number;
  changed_files?: number;
}

interface RawPullDetail extends RawPull {
  body?: string | null;
  mergeable?: boolean | null;
  mergeable_state?: string | null;
  requested_reviewers?: RawUser[];
  assignees?: RawUser[];
  milestone?: { title: string; html_url: string } | null;
}

interface RawIssueComment {
  id: number;
  user?: RawUser | null;
  body?: string;
  created_at?: string;
  updated_at?: string;
  html_url?: string;
}

interface RawReview {
  id: number;
  user?: RawUser | null;
  state?: string;
  body?: string;
  submitted_at?: string | null;
  html_url?: string;
}

interface RawReviewComment {
  id: number;
  user?: RawUser | null;
  body?: string;
  path?: string;
  line?: number | null;
  original_line?: number | null;
  side?: string | null;
  created_at?: string;
  html_url?: string;
  diff_hunk?: string;
  in_reply_to_id?: number | null;
}

interface RawCommit {
  sha?: string;
  html_url?: string;
  author?: RawUser | null;
  commit?: {
    message?: string;
    author?: { name?: string; date?: string };
    committer?: { date?: string };
  };
}

interface RawFile {
  filename?: string;
  previous_filename?: string;
  status?: string;
  additions?: number;
  deletions?: number;
  patch?: string;
}

interface RawCheckRun {
  name?: string;
  status?: string;
  conclusion?: string | null;
  details_url?: string | null;
  html_url?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  app?: { name?: string };
}

interface RawSearchIssue {
  number?: number;
}
