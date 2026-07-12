import type { App } from "../app/App";
import { requestUrl } from "../api/ApiUtils";
import { GitHubClient, type HttpTransport } from "./GitHubClient";
import { readGithubPrPrefs, writeGithubPrPrefs } from "./prefs";
import { parseGitRemoteUrl } from "./resolveRepository";
import type {
  GitHubAuthState,
  GitHubRepositoryRef,
  PrDetail,
  PrDraftComment,
  PrListFilter,
  PrSummary,
} from "./types";

const TOKEN_SECRET_ID = "github-token";

export interface GithubRepoListItem {
  owner: string;
  repo: string;
  fullName: string;
  private: boolean;
  description: string | null;
  openIssues: number;
}

/**
 * `app.github` — cloud GitHub access owned by the app (token in SecretStorage).
 * Repository comes from explicit selection / prefs / vault origin — not gh CLI.
 */
export class GitHubService {
  transportFactory: (app: App) => HttpTransport = defaultTransport;
  clientFactory: ((token: string | null, host: string, transport: HttpTransport) => GitHubClient) | null = null;

  private authCache: GitHubAuthState | null = null;
  /** Explicit user selection wins over prefs and origin. */
  private overrideRepo: GitHubRepositoryRef | null | undefined;
  private originRepo: GitHubRepositoryRef | null | undefined;

  constructor(readonly app: App) {}

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
      return { error: "Token was rejected by GitHub. Need a classic PAT with `repo` (or fine-grained read on the target repos)." };
    }
    return auth;
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
      return;
    }
    const owner = ref.owner.trim();
    const repo = ref.repo.trim().replace(/\.git$/i, "");
    if (!owner || !repo) return;
    this.overrideRepo = { owner, repo, host: ref.host?.trim() || "github.com" };
    writeGithubPrPrefs({ owner, repo });
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
    if (prefs.owner && prefs.repo) return { owner: prefs.owner, repo: prefs.repo, host: "github.com" };
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

  async createComment(number: number, body: string, repo?: GitHubRepositoryRef): Promise<string | null> {
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

  private readToken(): string | null {
    const fromSecret = this.app.secretStorage.getSecret(TOKEN_SECRET_ID)?.trim();
    if (fromSecret) return fromSecret;
    const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
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

  private async requireClient(repo?: GitHubRepositoryRef): Promise<{ client: GitHubClient; repo: GitHubRepositoryRef }> {
    const token = this.readToken();
    if (!token) {
      throw Object.assign(new Error("Sign in with a GitHub personal access token to browse pull requests."), { status: 401 });
    }
    const active = repo ?? (await this.resolveRepository());
    if (!active) {
      throw Object.assign(new Error("Choose a GitHub repository to browse."), { status: 400 });
    }
    return { client: this.client(token, active.host), repo: active };
  }
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
  if (error && typeof error === "object" && "message" in error && typeof (error as Error).message === "string") {
    return (error as Error).message;
  }
  return String(error);
}
