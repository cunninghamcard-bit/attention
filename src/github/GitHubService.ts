import type { App } from "../app/App";
import { requestUrl } from "../api/ApiUtils";
import { GitHubClient, type HttpTransport } from "./GitHubClient";
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

/**
 * `app.github` — cloud GitHub access owned by the app (token in SecretStorage),
 * not the gh CLI. Resolves owner/repo from the vault's git remote.
 */
export class GitHubService {
  /** Injectable for tests. */
  transportFactory: (app: App) => HttpTransport = defaultTransport;
  /** Injectable client factory for tests. */
  clientFactory: ((token: string | null, host: string, transport: HttpTransport) => GitHubClient) | null = null;

  private authCache: GitHubAuthState | null = null;
  private repoCache: GitHubRepositoryRef | null | undefined;

  constructor(readonly app: App) {}

  /** Clear cached auth/repo after token or remote changes. */
  invalidate(): void {
    this.authCache = null;
    this.repoCache = undefined;
  }

  async getAuth(): Promise<GitHubAuthState> {
    if (this.authCache) return this.authCache;
    const token = this.readToken();
    if (!token) {
      this.authCache = { hasToken: false, login: null, avatarUrl: null, name: null };
      return this.authCache;
    }
    const repo = await this.resolveRepository().catch(() => null);
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
      this.app.secretStorage.setSecret(TOKEN_SECRET_ID, "");
      this.clearTokenStorage();
      this.invalidate();
      return { error: "Token was rejected by GitHub. Check the classic PAT scopes (repo) and try again." };
    }
    return auth;
  }

  clearToken(): void {
    this.clearTokenStorage();
    this.invalidate();
  }

  async resolveRepository(): Promise<GitHubRepositoryRef | null> {
    if (this.repoCache !== undefined) return this.repoCache;
    if (!this.app.git.isAvailable()) {
      this.repoCache = null;
      return null;
    }
    if (!(await this.app.git.isRepository())) {
      this.repoCache = null;
      return null;
    }
    const remote = await this.app.git.getRemoteUrl("origin");
    this.repoCache = remote ? parseGitRemoteUrl(remote) : null;
    return this.repoCache;
  }

  async listPullRequests(filter: PrListFilter = "open"): Promise<PrSummary[]> {
    const { client, repo } = await this.requireClient();
    return client.listPullRequests(repo, filter);
  }

  async getPullRequest(number: number): Promise<PrDetail> {
    const { client, repo } = await this.requireClient();
    return client.getPullRequest(repo, number);
  }

  async getPullRequestDiff(number: number): Promise<string> {
    const { client, repo } = await this.requireClient();
    return client.getPullRequestDiff(repo, number);
  }

  async createComment(number: number, body: string): Promise<string | null> {
    try {
      const { client, repo } = await this.requireClient();
      await client.createIssueComment(repo, number, body);
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
  ): Promise<string | null> {
    try {
      const { client, repo } = await this.requireClient();
      await client.submitReview(repo, number, event, body, comments);
      return null;
    } catch (error) {
      return errorMessage(error);
    }
  }

  private readToken(): string | null {
    const fromSecret = this.app.secretStorage.getSecret(TOKEN_SECRET_ID)?.trim();
    if (fromSecret) return fromSecret;
    // Dev convenience — never required for product path.
    const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
    const fromEnv = env?.GITHUB_TOKEN?.trim();
    return fromEnv || null;
  }

  private clearTokenStorage(): void {
    try {
      // SecretStorage has no delete; overwrite with empty and drop from list by re-set empty.
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

  private async requireClient(): Promise<{ client: GitHubClient; repo: GitHubRepositoryRef }> {
    const token = this.readToken();
    if (!token) throw Object.assign(new Error("Sign in with a GitHub personal access token to browse pull requests."), { status: 401 });
    const repo = await this.resolveRepository();
    if (!repo) throw Object.assign(new Error("Could not resolve a GitHub repository from this vault's origin remote."), { status: 400 });
    return { client: this.client(token, repo.host), repo };
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
