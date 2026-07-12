import type {
  ActionJob,
  ActionRunDetail,
  ActionRunSummary,
  CiState,
  CommitDetail,
  CommitFileChange,
  CommitPage,
  CommitSummary,
  GitHubActor,
  GitHubAuthState,
  GitHubBranch,
  GitHubRepositoryRef,
  IssueDetail,
  IssueSummary,
  MergeMethod,
  MergeResult,
  NotificationItem,
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
  RepoContentItem,
  RepoFileContent,
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

  async listPullRequests(
    repo: GitHubRepositoryRef,
    filter: PrListFilter = "open",
  ): Promise<PrSummary[]> {
    if (filter === "mine" || filter === "review-requested") {
      return this.searchPullRequests(repo, filter);
    }
    const state = filter === "all" ? "all" : "open";
    const res = await this.request(
      "GET",
      `/repos/${repo.owner}/${repo.repo}/pulls?state=${state}&sort=updated&direction=desc&per_page=50`,
    );
    if (res.status >= 400) throw apiError(res);
    const items = (res.json as RawPull[]) ?? [];
    return items.map((item) => mapSummary(item));
  }

  /** Recent repositories the token can access (for the cloud repo picker). */
  async listRepositories(limit = 40): Promise<
    Array<{
      owner: string;
      repo: string;
      fullName: string;
      private: boolean;
      description: string | null;
      openIssues: number;
    }>
  > {
    const res = await this.request(
      "GET",
      `/user/repos?sort=updated&per_page=${Math.min(limit, 100)}&affiliation=owner,collaborator,organization_member`,
    );
    if (res.status >= 400) throw apiError(res);
    const items = (res.json as RawRepo[]) ?? [];
    return items
      .map((item) => ({
        owner: item.owner?.login ?? item.full_name?.split("/")[0] ?? "",
        repo: item.name ?? item.full_name?.split("/")[1] ?? "",
        fullName: item.full_name ?? `${item.owner?.login}/${item.name}`,
        private: Boolean(item.private),
        description: item.description ?? null,
        openIssues: item.open_issues_count ?? 0,
      }))
      .filter((item) => item.owner && item.repo);
  }

  async getPullRequest(repo: GitHubRepositoryRef, number: number): Promise<PrDetail> {
    const [prRes, commentsRes, reviewsRes, reviewCommentsRes, commitsRes, filesRes] =
      await Promise.all([
        this.request("GET", `/repos/${repo.owner}/${repo.repo}/pulls/${number}`),
        this.request(
          "GET",
          `/repos/${repo.owner}/${repo.repo}/issues/${number}/comments?per_page=100`,
        ),
        this.request(
          "GET",
          `/repos/${repo.owner}/${repo.repo}/pulls/${number}/reviews?per_page=100`,
        ),
        this.request(
          "GET",
          `/repos/${repo.owner}/${repo.repo}/pulls/${number}/comments?per_page=100`,
        ),
        this.request(
          "GET",
          `/repos/${repo.owner}/${repo.repo}/pulls/${number}/commits?per_page=100`,
        ),
        this.request("GET", `/repos/${repo.owner}/${repo.repo}/pulls/${number}/files?per_page=100`),
      ]);
    if (prRes.status >= 400) throw apiError(prRes);
    const pr = prRes.json as RawPullDetail;
    const headSha = pr.head?.sha ?? "";
    const [checks, combined] = headSha
      ? await Promise.all([this.listChecks(repo, headSha), this.combinedStatus(repo, headSha)])
      : [[], null as CiState | null];
    const ciState = rollupCi(checks) ?? combined;

    return {
      ...mapSummary(pr),
      body: pr.body ?? "",
      headRefOid: headSha,
      mergeable: typeof pr.mergeable === "boolean" ? pr.mergeable : null,
      mergeStateStatus: pr.mergeable_state ?? null,
      comments: okList(commentsRes).map(mapIssueComment),
      reviews: okList(reviewsRes)
        .map(mapReview)
        .filter((review) => review.state !== "PENDING"),
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
    const res = await this.request(
      "POST",
      `/repos/${repo.owner}/${repo.repo}/issues/${number}/comments`,
      {
        body: { body },
      },
    );
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
      body:
        body ||
        (event === "REQUEST_CHANGES" && comments.length === 0 ? "Requesting changes." : body),
      event,
      comments: comments.map((comment) => ({
        path: comment.path,
        body: comment.body,
        line: comment.line,
        side: comment.side === "deletions" ? "LEFT" : "RIGHT",
      })),
    };
    const res = await this.request(
      "POST",
      `/repos/${repo.owner}/${repo.repo}/pulls/${number}/reviews`,
      {
        body: payload,
      },
    );
    if (res.status >= 400) throw apiError(res);
  }

  async listBranches(repo: GitHubRepositoryRef): Promise<GitHubBranch[]> {
    const res = await this.request(
      "GET",
      `/repos/${repo.owner}/${repo.repo}/branches?per_page=100`,
    );
    if (res.status >= 400) throw apiError(res);
    const items = (res.json as RawBranch[]) ?? [];
    return items
      .map((item) => ({
        name: item.name ?? "",
        commitSha: item.commit?.sha ?? "",
        protected: Boolean(item.protected),
      }))
      .filter((b) => b.name);
  }

  async getDefaultBranch(repo: GitHubRepositoryRef): Promise<string> {
    const res = await this.request("GET", `/repos/${repo.owner}/${repo.repo}`);
    if (res.status >= 400) throw apiError(res);
    return String((res.json as { default_branch?: string })?.default_branch ?? "main");
  }

  async listCommits(
    repo: GitHubRepositoryRef,
    options: { ref?: string; page?: number; perPage?: number } = {},
  ): Promise<CommitPage> {
    const page = options.page ?? 1;
    const perPage = options.perPage ?? 30;
    const ref = options.ref?.trim() || undefined;
    const params = new URLSearchParams({ page: String(page), per_page: String(perPage) });
    if (ref) params.set("sha", ref);
    const res = await this.request("GET", `/repos/${repo.owner}/${repo.repo}/commits?${params}`);
    if (res.status >= 400) throw apiError(res);
    const items = ((res.json as RawCommitListItem[]) ?? []).map(mapCommitSummary);
    return {
      items,
      page,
      perPage,
      hasPreviousPage: page > 1,
      hasNextPage: items.length === perPage,
      ref: ref ?? "",
    };
  }

  async getCommit(repo: GitHubRepositoryRef, sha: string): Promise<CommitDetail> {
    const res = await this.request(
      "GET",
      `/repos/${repo.owner}/${repo.repo}/commits/${encodeURIComponent(sha)}`,
    );
    if (res.status >= 400) throw apiError(res);
    const raw = res.json as RawCommitDetail;
    const fullSha = raw.sha ?? sha;
    const [checks, combined] = await Promise.all([
      this.listChecks(repo, fullSha),
      this.combinedStatus(repo, fullSha),
    ]);
    const message = raw.commit?.message ?? "";
    const headline = message.split("\n")[0] ?? "";
    const login = raw.author?.login ?? raw.commit?.author?.name ?? "unknown";
    return {
      sha: fullSha,
      shortSha: fullSha.slice(0, 7),
      headline,
      message,
      author: {
        login,
        avatarUrl: raw.author?.avatar_url ?? "",
        url: raw.author?.html_url ?? "",
      },
      authorName: raw.commit?.author?.name ?? null,
      committer: raw.committer
        ? mapActor(raw.committer)
        : raw.commit?.committer?.name
          ? { login: raw.commit.committer.name, avatarUrl: "", url: "" }
          : null,
      committedDate: raw.commit?.committer?.date ?? raw.commit?.author?.date ?? "",
      authoredDate: raw.commit?.author?.date ?? "",
      url: raw.html_url ?? "",
      parents: (raw.parents ?? []).map((p) => ({
        sha: p.sha ?? "",
        shortSha: (p.sha ?? "").slice(0, 7),
        url: p.html_url ?? "",
      })),
      stats: {
        additions: raw.stats?.additions ?? 0,
        deletions: raw.stats?.deletions ?? 0,
        total: raw.stats?.total ?? 0,
      },
      files: (raw.files ?? []).map(mapCommitFile),
      verification: raw.commit?.verification
        ? {
            verified: Boolean(raw.commit.verification.verified),
            reason: raw.commit.verification.reason ?? null,
          }
        : null,
      checks,
      ciState: rollupCi(checks) ?? combined,
    };
  }

  async getCommitDiff(repo: GitHubRepositoryRef, sha: string): Promise<string> {
    const res = await this.request(
      "GET",
      `/repos/${repo.owner}/${repo.repo}/commits/${encodeURIComponent(sha)}`,
      {
        accept: "application/vnd.github.v3.diff",
      },
    );
    if (res.status >= 400) throw apiError(res);
    return res.text;
  }

  // --- Issues --------------------------------------------------------------

  async listIssues(
    repo: GitHubRepositoryRef,
    state: "open" | "closed" | "all" = "open",
  ): Promise<IssueSummary[]> {
    const res = await this.request(
      "GET",
      `/repos/${repo.owner}/${repo.repo}/issues?state=${state}&sort=updated&direction=desc&per_page=50`,
    );
    if (res.status >= 400) throw apiError(res);
    const items = (res.json as RawIssue[]) ?? [];
    // REST /issues includes PRs — keep only pure issues for the Issues section.
    return items.filter((item) => !item.pull_request).map(mapIssueSummary);
  }

  async getIssue(repo: GitHubRepositoryRef, number: number): Promise<IssueDetail> {
    const [issueRes, commentsRes] = await Promise.all([
      this.request("GET", `/repos/${repo.owner}/${repo.repo}/issues/${number}`),
      this.request(
        "GET",
        `/repos/${repo.owner}/${repo.repo}/issues/${number}/comments?per_page=100`,
      ),
    ]);
    if (issueRes.status >= 400) throw apiError(issueRes);
    const raw = issueRes.json as RawIssue;
    return {
      ...mapIssueSummary(raw),
      body: raw.body ?? "",
      assignees: (raw.assignees ?? []).map(mapActor),
      milestone: raw.milestone ? { title: raw.milestone.title, url: raw.milestone.html_url } : null,
      commentsList: okList(commentsRes).map(mapIssueComment),
      closedAt: raw.closed_at ?? null,
    };
  }

  // --- Actions -------------------------------------------------------------

  async listWorkflowRuns(repo: GitHubRepositoryRef, page = 1): Promise<ActionRunSummary[]> {
    const res = await this.request(
      "GET",
      `/repos/${repo.owner}/${repo.repo}/actions/runs?per_page=30&page=${page}`,
    );
    if (res.status >= 400) throw apiError(res);
    const runs = (res.json as { workflow_runs?: RawWorkflowRun[] })?.workflow_runs ?? [];
    return runs.map(mapActionRun);
  }

  async getWorkflowRun(repo: GitHubRepositoryRef, runId: number): Promise<ActionRunDetail> {
    const [runRes, jobsRes] = await Promise.all([
      this.request("GET", `/repos/${repo.owner}/${repo.repo}/actions/runs/${runId}`),
      this.request(
        "GET",
        `/repos/${repo.owner}/${repo.repo}/actions/runs/${runId}/jobs?per_page=50`,
      ),
    ]);
    if (runRes.status >= 400) throw apiError(runRes);
    const run = mapActionRun(runRes.json as RawWorkflowRun);
    const jobs = ((jobsRes.json as { jobs?: RawJob[] })?.jobs ?? []).map(mapJob);
    return { ...run, jobs };
  }

  // --- Files ---------------------------------------------------------------

  async listContents(
    repo: GitHubRepositoryRef,
    path = "",
    ref?: string,
  ): Promise<RepoContentItem[]> {
    const clean = path.replace(/^\/+|\/+$/g, "");
    const params = ref ? `?ref=${encodeURIComponent(ref)}` : "";
    const apiPath = clean
      ? `/repos/${repo.owner}/${repo.repo}/contents/${clean.split("/").map(encodeURIComponent).join("/")}${params}`
      : `/repos/${repo.owner}/${repo.repo}/contents${params}`;
    const res = await this.request("GET", apiPath);
    if (res.status >= 400) throw apiError(res);
    const data = res.json;
    const items = Array.isArray(data) ? data : [data];
    return (items as RawContent[]).map(mapContent).filter((item) => item.name);
  }

  async getFileContent(
    repo: GitHubRepositoryRef,
    path: string,
    ref?: string,
  ): Promise<RepoFileContent> {
    const clean = path.replace(/^\/+/, "");
    const params = ref ? `?ref=${encodeURIComponent(ref)}` : "";
    const res = await this.request(
      "GET",
      `/repos/${repo.owner}/${repo.repo}/contents/${clean.split("/").map(encodeURIComponent).join("/")}${params}`,
    );
    if (res.status >= 400) throw apiError(res);
    const raw = res.json as RawContent;
    let text: string | null = null;
    if (raw.encoding === "base64" && typeof raw.content === "string") {
      text = decodeBase64Text(raw.content, 512 * 1024);
    }
    return {
      path: raw.path ?? path,
      name: raw.name ?? path.split("/").pop() ?? path,
      sha: raw.sha ?? "",
      size: raw.size ?? 0,
      encoding: raw.encoding ?? "",
      text,
      htmlUrl: raw.html_url ?? "",
      downloadUrl: raw.download_url ?? null,
    };
  }

  // --- Notifications / Inbox ---------------------------------------------

  async listNotifications(
    options: { all?: boolean; participating?: boolean } = {},
  ): Promise<NotificationItem[]> {
    const params = new URLSearchParams({ per_page: "40" });
    if (options.all) params.set("all", "true");
    if (options.participating) params.set("participating", "true");
    const res = await this.request("GET", `/notifications?${params}`);
    if (res.status >= 400) throw apiError(res);
    return ((res.json as RawNotification[]) ?? []).map(mapNotification);
  }

  async markNotificationRead(id: string): Promise<void> {
    const res = await this.request("PATCH", `/notifications/threads/${id}`);
    if (res.status >= 400 && res.status !== 205) throw apiError(res);
  }

  async markAllNotificationsRead(): Promise<void> {
    const res = await this.request("PUT", "/notifications", {
      body: { last_read_at: new Date().toISOString() },
    });
    if (res.status >= 400 && res.status !== 205) throw apiError(res);
  }

  // --- Merge ---------------------------------------------------------------

  async mergePullRequest(
    repo: GitHubRepositoryRef,
    number: number,
    options: { method?: MergeMethod; commitTitle?: string; commitMessage?: string } = {},
  ): Promise<MergeResult> {
    const res = await this.request(
      "POST",
      `/repos/${repo.owner}/${repo.repo}/pulls/${number}/merge`,
      {
        body: {
          merge_method: options.method ?? "squash",
          ...(options.commitTitle ? { commit_title: options.commitTitle } : {}),
          ...(options.commitMessage ? { commit_message: options.commitMessage } : {}),
        },
      },
    );
    if (res.status >= 400) throw apiError(res);
    const raw = res.json as { merged?: boolean; message?: string; sha?: string };
    return {
      merged: Boolean(raw.merged),
      message: raw.message ?? (raw.merged ? "Pull request merged" : "Merge failed"),
      sha: raw.sha ?? null,
    };
  }

  private async listChecks(repo: GitHubRepositoryRef, sha: string): Promise<PrCheck[]> {
    const res = await this.request(
      "GET",
      `/repos/${repo.owner}/${repo.repo}/commits/${sha}/check-runs?per_page=100`,
    );
    if (res.status >= 400) return [];
    const runs = (res.json as { check_runs?: RawCheckRun[] })?.check_runs ?? [];
    return runs.map((run) => ({
      name: run.name ?? run.app?.name ?? "check",
      status: run.status ?? "queued",
      conclusion: run.conclusion ?? null,
      detailsUrl: run.details_url ?? run.html_url ?? null,
      startedAt: run.started_at ?? null,
      completedAt: run.completed_at ?? null,
    }));
  }

  /** Classic commit status (used when Actions check-runs are empty). */
  private async combinedStatus(repo: GitHubRepositoryRef, sha: string): Promise<CiState | null> {
    const res = await this.request(
      "GET",
      `/repos/${repo.owner}/${repo.repo}/commits/${sha}/status`,
    );
    if (res.status >= 400) return null;
    const state = String((res.json as { state?: string })?.state ?? "").toLowerCase();
    if (state === "success") return "success";
    if (state === "pending") return "pending";
    if (state === "failure") return "failure";
    if (state === "error") return "error";
    return state ? "unknown" : null;
  }

  private async searchPullRequests(
    repo: GitHubRepositoryRef,
    filter: "mine" | "review-requested",
  ): Promise<PrSummary[]> {
    const qualifier = filter === "mine" ? "author:@me" : "review-requested:@me";
    const q = encodeURIComponent(`is:pr is:open repo:${repo.owner}/${repo.repo} ${qualifier}`);
    const res = await this.request(
      "GET",
      `/search/issues?q=${q}&sort=updated&order=desc&per_page=40`,
    );
    if (res.status >= 400) throw apiError(res);
    const items = (res.json as { items?: RawSearchIssue[] })?.items ?? [];
    // Search results lack branch names — hydrate from PR endpoint in parallel (cap).
    const numbers = items
      .map((item) => item.number)
      .filter((n): n is number => typeof n === "number")
      .slice(0, 20);
    const details = await Promise.all(
      numbers.map(async (number) => {
        const prRes = await this.request(
          "GET",
          `/repos/${repo.owner}/${repo.repo}/pulls/${number}`,
        );
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
      "User-Agent": "Workbench-GitHub",
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
  const summary = mapCommitSummary(raw);
  return {
    sha: summary.sha,
    shortSha: summary.shortSha,
    messageHeadline: summary.headline,
    message: summary.message,
    author: summary.author,
    committedDate: summary.committedDate,
    url: summary.url,
    ciState: null,
  };
}

function mapCommitSummary(raw: RawCommitListItem | RawCommit): CommitSummary {
  const message = raw.commit?.message ?? "";
  const headline = message.split("\n")[0] ?? "";
  const login = raw.author?.login ?? raw.commit?.author?.name ?? "unknown";
  return {
    sha: raw.sha ?? "",
    shortSha: (raw.sha ?? "").slice(0, 7),
    message,
    headline,
    author: {
      login,
      avatarUrl: raw.author?.avatar_url ?? "",
      url: raw.author?.html_url ?? "",
    },
    authorName: raw.commit?.author?.name ?? null,
    committedDate: raw.commit?.committer?.date ?? raw.commit?.author?.date ?? "",
    url: raw.html_url ?? "",
  };
}

function mapCommitFile(raw: RawFile): CommitFileChange {
  return {
    path: raw.filename ?? "",
    previousPath: raw.previous_filename ?? null,
    status: (raw.status ?? "modified") as CommitFileChange["status"],
    additions: raw.additions ?? 0,
    deletions: raw.deletions ?? 0,
    patch: raw.patch ?? null,
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

function mapIssueSummary(raw: RawIssue): IssueSummary {
  return {
    number: raw.number,
    title: raw.title ?? "",
    state: raw.state === "closed" ? "closed" : "open",
    author: mapActor(raw.user),
    createdAt: raw.created_at ?? "",
    updatedAt: raw.updated_at ?? "",
    url: raw.html_url ?? "",
    labels: (raw.labels ?? []).map(mapLabel),
    comments: raw.comments ?? 0,
    isPullRequest: Boolean(raw.pull_request),
  };
}

function mapActionRun(raw: RawWorkflowRun): ActionRunSummary {
  return {
    id: raw.id ?? 0,
    name: raw.name ?? "workflow",
    displayTitle: raw.display_title ?? raw.name ?? "workflow",
    status: raw.status ?? "queued",
    conclusion: raw.conclusion ?? null,
    headBranch: raw.head_branch ?? "",
    headSha: raw.head_sha ?? "",
    event: raw.event ?? "",
    url: raw.url ?? "",
    htmlUrl: raw.html_url ?? "",
    createdAt: raw.created_at ?? "",
    updatedAt: raw.updated_at ?? "",
    runNumber: raw.run_number ?? 0,
    attempt: raw.run_attempt ?? 1,
  };
}

function mapJob(raw: RawJob): ActionJob {
  return {
    id: raw.id ?? 0,
    name: raw.name ?? "job",
    status: raw.status ?? "queued",
    conclusion: raw.conclusion ?? null,
    startedAt: raw.started_at ?? null,
    completedAt: raw.completed_at ?? null,
    steps: (raw.steps ?? []).map((step) => ({
      name: step.name ?? "step",
      status: step.status ?? "queued",
      conclusion: step.conclusion ?? null,
      number: step.number ?? 0,
    })),
  };
}

function mapContent(raw: RawContent): RepoContentItem {
  return {
    name: raw.name ?? "",
    path: raw.path ?? "",
    type: (raw.type as RepoContentItem["type"]) ?? "file",
    size: raw.size ?? 0,
    sha: raw.sha ?? "",
    url: raw.url ?? "",
    htmlUrl: raw.html_url ?? "",
    downloadUrl: raw.download_url ?? null,
  };
}

function mapNotification(raw: RawNotification): NotificationItem {
  const full = raw.repository?.full_name ?? "";
  const [owner = "", repo = ""] = full.split("/");
  return {
    id: raw.id ?? "",
    unread: Boolean(raw.unread),
    reason: raw.reason ?? "",
    updatedAt: raw.updated_at ?? "",
    title: raw.subject?.title ?? "",
    type: raw.subject?.type ?? "",
    url: raw.subject?.url ?? null,
    repository: full,
    owner,
    repo,
    subjectUrl: raw.subject?.latest_comment_url ?? raw.subject?.url ?? null,
  };
}

function rollupCi(checks: PrCheck[]): CiState | null {
  if (checks.length === 0) return null;
  const conclusions = checks.map((check) => (check.conclusion ?? check.status).toLowerCase());
  if (conclusions.some((c) => c === "failure" || c === "timed_out" || c === "action_required"))
    return "failure";
  if (conclusions.some((c) => c === "cancelled" || c === "error" || c === "startup_failure"))
    return "error";
  if (
    conclusions.some(
      (c) => c === "pending" || c === "queued" || c === "in_progress" || c === "waiting",
    )
  )
    return "pending";
  if (
    conclusions.every(
      (c) => c === "success" || c === "neutral" || c === "skipped" || c === "completed",
    )
  ) {
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

function decodeBase64Text(content: string, maxBytes: number): string | null {
  try {
    const cleaned = content.replace(/\n/g, "");
    let bytes: Uint8Array;
    if (typeof atob === "function") {
      const binary = atob(cleaned);
      if (binary.length > maxBytes || binary.includes("\0")) return null;
      bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    } else {
      const buf = (
        globalThis as unknown as { Buffer?: { from(s: string, enc: string): Uint8Array } }
      ).Buffer?.from(cleaned, "base64");
      if (!buf || buf.length > maxBytes) return null;
      bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf as ArrayBuffer);
      for (let i = 0; i < Math.min(bytes.length, 1024); i += 1) {
        if (bytes[i] === 0) return null;
      }
    }
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  } catch {
    return null;
  }
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
  committer?: RawUser | null;
  commit?: {
    message?: string;
    author?: { name?: string; date?: string };
    committer?: { name?: string; date?: string };
    verification?: { verified?: boolean; reason?: string | null };
  };
  parents?: Array<{ sha?: string; html_url?: string }>;
  stats?: { additions?: number; deletions?: number; total?: number };
  files?: RawFile[];
}

type RawCommitListItem = RawCommit;
type RawCommitDetail = RawCommit;

interface RawBranch {
  name?: string;
  protected?: boolean;
  commit?: { sha?: string };
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

interface RawRepo {
  name?: string;
  full_name?: string;
  private?: boolean;
  description?: string | null;
  open_issues_count?: number;
  owner?: { login?: string };
}

interface RawIssue {
  number: number;
  title?: string;
  state?: string;
  body?: string | null;
  user?: RawUser | null;
  created_at?: string;
  updated_at?: string;
  closed_at?: string | null;
  html_url?: string;
  labels?: RawLabel[];
  comments?: number;
  assignees?: RawUser[];
  milestone?: { title: string; html_url: string } | null;
  pull_request?: unknown;
}

interface RawWorkflowRun {
  id?: number;
  name?: string;
  display_title?: string;
  status?: string;
  conclusion?: string | null;
  head_branch?: string;
  head_sha?: string;
  event?: string;
  url?: string;
  html_url?: string;
  created_at?: string;
  updated_at?: string;
  run_number?: number;
  run_attempt?: number;
}

interface RawJob {
  id?: number;
  name?: string;
  status?: string;
  conclusion?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  steps?: Array<{ name?: string; status?: string; conclusion?: string | null; number?: number }>;
}

interface RawContent {
  name?: string;
  path?: string;
  type?: string;
  size?: number;
  sha?: string;
  url?: string;
  html_url?: string;
  download_url?: string | null;
  encoding?: string;
  content?: string;
}

interface RawNotification {
  id?: string;
  unread?: boolean;
  reason?: string;
  updated_at?: string;
  subject?: {
    title?: string;
    type?: string;
    url?: string | null;
    latest_comment_url?: string | null;
  };
  repository?: { full_name?: string };
}
