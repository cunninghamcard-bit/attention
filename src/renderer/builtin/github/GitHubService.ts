import type { App } from "../../app/App";
import { requestUrl } from "../../core/ApiUtils";
import { GitHubClient, type HttpTransport } from "./GitHubClient";
import { readGithubPrPrefs, writeGithubPrPrefs } from "./prefs";
import { parseGitRemoteUrl } from "./resolveRepository";
import { GitHubSession } from "./session";
import type {
  ActionRunDetail,
  ActionRunSummary,
  CommitDetail,
  CommitPage,
  GitHubAuthState,
  GitHubBranch,
  GitHubRepositoryRef,
  GitHubSearchItem,
  InvolvementQuery,
  IssueDetail,
  IssueSummary,
  MergeMethod,
  MergeResult,
  NotificationItem,
  PrDetail,
  PrDraftComment,
  PrListFilter,
  PrSummary,
  RepoContentItem,
  RepoFileContent,
} from "./types";

const TOKEN_SECRET_ID = "github-token";
const DEVICE_CODE_URL = "https://github.com/login/device/code";
const DEVICE_TOKEN_URL = "https://github.com/login/oauth/access_token";
const DEVICE_SCOPES = ["repo", "notifications", "read:user"] as const;

export interface GitHubDeviceSession {
  clientId: string;
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete?: string;
  expiresIn: number;
  interval: number;
}

export interface GithubRepoListItem {
  owner: string;
  repo: string;
  fullName: string;
  private: boolean;
  description: string | null;
  openIssues: number;
}

export interface GithubOrgListItem {
  login: string;
  avatarUrl: string;
  description: string | null;
}

/**
 * `app.github` — cloud GitHub access owned by the app (token in SecretStorage).
 * Repository comes from explicit selection / prefs / vault origin — not gh CLI.
 */
export class GitHubService {
  transportFactory: (app: App) => HttpTransport = defaultTransport;
  oauthClientId =
    (
      import.meta as ImportMeta & { env?: Record<string, string | undefined> }
    ).env?.VITE_GITHUB_OAUTH_CLIENT_ID?.trim() ?? "";
  sleep: (ms: number) => Promise<void> = (ms) =>
    new Promise((resolve) => globalThis.setTimeout(resolve, ms));
  clientFactory:
    | ((token: string | null, host: string, transport: HttpTransport) => GitHubClient)
    | null = null;

  /** Bridges the left-dock navigator and the center detail leaves. */
  readonly session = new GitHubSession();

  private authCache: GitHubAuthState | null = null;
  /** Explicit user selection wins over prefs and origin. */
  private overrideRepo: GitHubRepositoryRef | null | undefined;
  private originRepo: GitHubRepositoryRef | null | undefined;

  constructor(readonly app: App) {}

  get hasDeviceLogin(): boolean {
    return Boolean(this.oauthClientId);
  }

  invalidate(): void {
    this.authCache = null;
    this.originRepo = undefined;
  }

  async getAuth(): Promise<GitHubAuthState> {
    if (this.authCache) return this.authCache;
    const token = this.readToken();
    if (!token) {
      this.authCache = { hasToken: false, login: null, avatarUrl: null, name: null };
      return this.authCache;
    }
    const repo = this.peekRepository();
    const client = this.client(token, repo?.host ?? "github.com");
    try {
      this.authCache = await client.getAuth();
    } catch {
      this.authCache = { hasToken: true, login: null, avatarUrl: null, name: null };
    }
    return this.authCache;
  }

  async setToken(token: string): Promise<GitHubAuthState | { error: string }> {
    const trimmed = token.trim();
    if (!trimmed) return { error: "Token is empty" };
    this.app.secretStorage.setSecret(TOKEN_SECRET_ID, trimmed);
    this.invalidate();
    const auth = await this.getAuth();
    if (!auth.login) {
      this.clearTokenStorage();
      this.invalidate();
      return {
        error:
          "Token was rejected by GitHub. Need a classic PAT with `repo` (or fine-grained read on the target repos).",
      };
    }
    return auth;
  }

  async startDeviceLogin(): Promise<GitHubDeviceSession> {
    const clientId = this.oauthClientId.trim();
    if (!clientId) throw new Error("GitHub OAuth client ID is not configured.");
    const response = await this.postOAuth(DEVICE_CODE_URL, {
      client_id: clientId,
      scope: DEVICE_SCOPES.join(" "),
    });
    if (response.status >= 400) throw new Error(oauthError(response.json, response.status));
    const payload = oauthPayload(response.json);
    const deviceCode = requiredString(payload, "device_code");
    const userCode = requiredString(payload, "user_code");
    const verificationUri = requiredString(payload, "verification_uri");
    return {
      clientId,
      deviceCode,
      userCode,
      verificationUri,
      verificationUriComplete:
        typeof payload.verification_uri_complete === "string"
          ? payload.verification_uri_complete
          : undefined,
      expiresIn: positiveNumber(payload.expires_in, "expires_in"),
      interval: positiveNumber(payload.interval ?? 5, "interval"),
    };
  }

  async completeDeviceLogin(
    session: GitHubDeviceSession,
    signal?: AbortSignal,
  ): Promise<GitHubAuthState | { error: string }> {
    const expiresAt = Date.now() + session.expiresIn * 1000;
    let interval = Math.max(session.interval, 1);
    while (Date.now() < expiresAt) {
      if (signal?.aborted) return { error: "GitHub login was cancelled." };
      await this.sleep(interval * 1000);
      if (signal?.aborted) return { error: "GitHub login was cancelled." };
      const response = await this.postOAuth(DEVICE_TOKEN_URL, {
        client_id: session.clientId,
        device_code: session.deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      });
      const payload = oauthPayload(response.json);
      if (typeof payload.access_token === "string" && payload.access_token) {
        return this.setToken(payload.access_token);
      }
      const code = typeof payload.error === "string" ? payload.error : "unknown_error";
      if (code === "authorization_pending") continue;
      if (code === "slow_down") {
        interval += 5;
        continue;
      }
      return { error: oauthError(payload, response.status) };
    }
    return { error: "GitHub device authorization expired." };
  }

  clearToken(): void {
    this.clearTokenStorage();
    this.invalidate();
  }

  /**
   * Pin the active cloud repository. Pass null to clear override (falls back
   * to prefs / origin). Host defaults to github.com.
   */
  setRepository(ref: { owner: string; repo: string; host?: string } | null): void {
    if (!ref) {
      this.overrideRepo = null;
      writeGithubPrPrefs({ owner: "", repo: "" });
      this.session.setRepo(null);
      return;
    }
    const owner = ref.owner.trim();
    const repo = ref.repo.trim().replace(/\.git$/i, "");
    if (!owner || !repo) return;
    this.overrideRepo = { owner, repo, host: ref.host?.trim() || "github.com" };
    writeGithubPrPrefs({ owner, repo });
    // Idempotent inside the session, so repeated resolve-time pins are quiet.
    this.session.setRepo(this.overrideRepo);
  }

  /** Active repo: override → prefs → vault origin. */
  async resolveRepository(): Promise<GitHubRepositoryRef | null> {
    if (this.overrideRepo) return this.overrideRepo;
    const prefs = readGithubPrPrefs();
    if (prefs.owner && prefs.repo) {
      return { owner: prefs.owner, repo: prefs.repo, host: "github.com" };
    }
    return this.resolveOriginRepository();
  }

  peekRepository(): GitHubRepositoryRef | null {
    if (this.overrideRepo) return this.overrideRepo;
    const prefs = readGithubPrPrefs();
    if (prefs.owner && prefs.repo)
      return { owner: prefs.owner, repo: prefs.repo, host: "github.com" };
    return this.originRepo ?? null;
  }

  async resolveOriginRepository(): Promise<GitHubRepositoryRef | null> {
    if (this.originRepo !== undefined) return this.originRepo;
    if (!this.app.git.isAvailable() || !(await this.app.git.isRepository())) {
      this.originRepo = null;
      return null;
    }
    const remote = await this.app.git.getRemoteUrl("origin");
    this.originRepo = remote ? parseGitRemoteUrl(remote) : null;
    return this.originRepo;
  }

  async listUserRepositories(): Promise<GithubRepoListItem[]> {
    const token = this.readToken();
    if (!token) return [];
    const client = this.client(token, "github.com");
    return client.listRepositories(50);
  }

  async listUserOrganizations(): Promise<GithubOrgListItem[]> {
    const token = this.readToken();
    if (!token) return [];
    const client = this.client(token, "github.com");
    return client.listOrganizations();
  }

  async listOrgRepositories(org: string): Promise<GithubRepoListItem[]> {
    const token = this.readToken();
    if (!token) return [];
    const client = this.client(token, "github.com");
    return client.listOrgRepositories(org, 50);
  }

  async listPullRequests(filter?: PrListFilter, repo?: GitHubRepositoryRef): Promise<PrSummary[]> {
    const { client, repo: active } = await this.requireClient(repo);
    const prefs = readGithubPrPrefs();
    const resolvedFilter = filter ?? prefs.filter ?? "open";
    writeGithubPrPrefs({ owner: active.owner, repo: active.repo, filter: resolvedFilter });
    return client.listPullRequests(active, resolvedFilter);
  }

  async getPullRequest(number: number, repo?: GitHubRepositoryRef): Promise<PrDetail> {
    const { client, repo: active } = await this.requireClient(repo);
    writeGithubPrPrefs({ owner: active.owner, repo: active.repo, lastPr: number });
    return client.getPullRequest(active, number);
  }

  async getPullRequestDiff(number: number, repo?: GitHubRepositoryRef): Promise<string> {
    const { client, repo: active } = await this.requireClient(repo);
    return client.getPullRequestDiff(active, number);
  }

  async createComment(
    number: number,
    body: string,
    repo?: GitHubRepositoryRef,
  ): Promise<string | null> {
    try {
      const { client, repo: active } = await this.requireClient(repo);
      await client.createIssueComment(active, number, body);
      return null;
    } catch (error) {
      return errorMessage(error);
    }
  }

  async submitReview(
    number: number,
    event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT",
    body: string,
    comments: PrDraftComment[] = [],
    repo?: GitHubRepositoryRef,
  ): Promise<string | null> {
    try {
      const { client, repo: active } = await this.requireClient(repo);
      await client.submitReview(active, number, event, body, comments);
      return null;
    } catch (error) {
      return errorMessage(error);
    }
  }

  async listBranches(repo?: GitHubRepositoryRef): Promise<GitHubBranch[]> {
    const { client, repo: active } = await this.requireClient(repo);
    return client.listBranches(active);
  }

  async getDefaultBranch(repo?: GitHubRepositoryRef): Promise<string> {
    const { client, repo: active } = await this.requireClient(repo);
    return client.getDefaultBranch(active);
  }

  async listCommits(
    options: { ref?: string; page?: number; perPage?: number } = {},
    repo?: GitHubRepositoryRef,
  ): Promise<CommitPage> {
    const { client, repo: active } = await this.requireClient(repo);
    return client.listCommits(active, options);
  }

  async getCommit(sha: string, repo?: GitHubRepositoryRef): Promise<CommitDetail> {
    const { client, repo: active } = await this.requireClient(repo);
    return client.getCommit(active, sha);
  }

  async getCommitDiff(sha: string, repo?: GitHubRepositoryRef): Promise<string> {
    const { client, repo: active } = await this.requireClient(repo);
    return client.getCommitDiff(active, sha);
  }

  async listIssues(
    state: "open" | "closed" | "all" = "open",
    repo?: GitHubRepositoryRef,
  ): Promise<IssueSummary[]> {
    const { client, repo: active } = await this.requireClient(repo);
    return client.listIssues(active, state);
  }

  async getIssue(number: number, repo?: GitHubRepositoryRef): Promise<IssueDetail> {
    const { client, repo: active } = await this.requireClient(repo);
    return client.getIssue(active, number);
  }

  async createIssueComment(
    number: number,
    body: string,
    repo?: GitHubRepositoryRef,
  ): Promise<string | null> {
    try {
      const { client, repo: active } = await this.requireClient(repo);
      await client.createIssueComment(active, number, body);
      return null;
    } catch (error) {
      return errorMessage(error);
    }
  }

  async updateIssueState(
    number: number,
    state: "open" | "closed",
    repo?: GitHubRepositoryRef,
  ): Promise<string | null> {
    try {
      const { client, repo: active } = await this.requireClient(repo);
      await client.updateIssueState(active, number, state);
      return null;
    } catch (error) {
      return errorMessage(error);
    }
  }

  async createIssue(
    input: { title: string; body?: string },
    repo?: GitHubRepositoryRef,
  ): Promise<{ number: number; url: string } | string> {
    try {
      const { client, repo: active } = await this.requireClient(repo);
      return await client.createIssue(active, input);
    } catch (error) {
      return errorMessage(error);
    }
  }

  async listWorkflowRuns(page = 1, repo?: GitHubRepositoryRef): Promise<ActionRunSummary[]> {
    const { client, repo: active } = await this.requireClient(repo);
    return client.listWorkflowRuns(active, page);
  }

  async getWorkflowRun(runId: number, repo?: GitHubRepositoryRef): Promise<ActionRunDetail> {
    const { client, repo: active } = await this.requireClient(repo);
    return client.getWorkflowRun(active, runId);
  }

  async listContents(
    path = "",
    ref?: string,
    repo?: GitHubRepositoryRef,
  ): Promise<RepoContentItem[]> {
    const { client, repo: active } = await this.requireClient(repo);
    return client.listContents(active, path, ref);
  }

  async getFileContent(
    path: string,
    ref?: string,
    repo?: GitHubRepositoryRef,
  ): Promise<RepoFileContent> {
    const { client, repo: active } = await this.requireClient(repo);
    return client.getFileContent(active, path, ref);
  }

  async listNotifications(options?: {
    all?: boolean;
    participating?: boolean;
  }): Promise<NotificationItem[]> {
    const token = this.readToken();
    if (!token) throw Object.assign(new Error("Sign in required"), { status: 401 });
    return this.client(token, "github.com").listNotifications(options);
  }

  /** Cross-repo involvement query (my PRs / needs review / mentioned…). */
  async searchInvolvement(
    kind: "pr" | "issue",
    query: InvolvementQuery,
  ): Promise<GitHubSearchItem[]> {
    const token = this.readToken();
    if (!token) throw Object.assign(new Error("Sign in required"), { status: 401 });
    return this.client(token, "github.com").searchInvolvement(kind, query);
  }

  async markNotificationRead(id: string): Promise<string | null> {
    try {
      const token = this.readToken();
      if (!token) return "Not signed in";
      await this.client(token, "github.com").markNotificationRead(id);
      return null;
    } catch (error) {
      return errorMessage(error);
    }
  }

  async markAllNotificationsRead(): Promise<string | null> {
    try {
      const token = this.readToken();
      if (!token) return "Not signed in";
      await this.client(token, "github.com").markAllNotificationsRead();
      return null;
    } catch (error) {
      return errorMessage(error);
    }
  }

  async mergePullRequest(
    number: number,
    options: { method?: MergeMethod; commitTitle?: string; commitMessage?: string } = {},
    repo?: GitHubRepositoryRef,
  ): Promise<MergeResult | { error: string }> {
    try {
      const { client, repo: active } = await this.requireClient(repo);
      return await client.mergePullRequest(active, number, options);
    } catch (error) {
      return { error: errorMessage(error) };
    }
  }

  private readToken(): string | null {
    const fromSecret = this.app.secretStorage.getSecret(TOKEN_SECRET_ID)?.trim();
    if (fromSecret) return fromSecret;
    const env = (
      globalThis as unknown as { process?: { env?: Record<string, string | undefined> } }
    ).process?.env;
    return env?.GITHUB_TOKEN?.trim() || null;
  }

  private clearTokenStorage(): void {
    try {
      this.app.secretStorage.setSecret(TOKEN_SECRET_ID, "");
    } catch {
      // ignore
    }
  }

  private client(token: string | null, host: string): GitHubClient {
    const transport = this.transportFactory(this.app);
    if (this.clientFactory) return this.clientFactory(token, host, transport);
    return new GitHubClient(transport, token, host);
  }

  private postOAuth(
    url: string,
    body: Record<string, string>,
  ): Promise<{
    status: number;
    text: string;
    json: unknown;
  }> {
    return this.transportFactory(this.app)({
      url,
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(body).toString(),
    });
  }

  private async requireClient(
    repo?: GitHubRepositoryRef,
  ): Promise<{ client: GitHubClient; repo: GitHubRepositoryRef }> {
    const token = this.readToken();
    if (!token) {
      throw Object.assign(new Error("Sign in to GitHub to browse pull requests."), { status: 401 });
    }
    const active = repo ?? (await this.resolveRepository());
    if (!active) {
      throw Object.assign(new Error("Choose a GitHub repository to browse."), { status: 400 });
    }
    return { client: this.client(token, active.host), repo: active };
  }
}

function requiredString(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  if (typeof value !== "string" || !value) throw new Error(`GitHub OAuth response omitted ${key}.`);
  return value;
}

function oauthPayload(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object")
    throw new Error("GitHub OAuth returned an invalid response.");
  return value as Record<string, unknown>;
}

function positiveNumber(value: unknown, key: string): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0)
    throw new Error(`GitHub OAuth response has invalid ${key}.`);
  return number;
}

function oauthError(payload: unknown, status: number): string {
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    if (typeof record.error_description === "string") return record.error_description;
    if (typeof record.error === "string") return record.error;
  }
  return status >= 400
    ? `GitHub OAuth request failed with status ${status}.`
    : "GitHub device authorization failed.";
}

function defaultTransport(app: App): HttpTransport {
  return async ({ url, method, headers, body }) => {
    const response = await requestUrl(
      {
        url,
        method: method ?? "GET",
        headers,
        body,
        throw: false,
      },
      app,
    );
    let json: unknown = null;
    try {
      json = response.json;
    } catch {
      json = null;
    }
    return { status: response.status, text: response.text, json };
  };
}

function errorMessage(error: unknown): string {
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof (error as Error).message === "string"
  ) {
    return (error as Error).message;
  }
  return String(error);
}
