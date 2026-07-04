import type { App } from "../app/App";

/**
 * `app.git` — read-side git access for the vault working tree, backed by the
 * preload git bridge (desktop). Browser mode reports unavailable, same
 * pattern as the terminal. Mirrors electron/git-bridge.ts structurally.
 */

export interface GitExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface ElectronGitApi {
  available: boolean;
  exec(args: string[], cwd: string): Promise<GitExecResult>;
  /** GitHub CLI; optional so older bridges and test fakes keep working. */
  execGh?(args: string[], cwd: string): Promise<GitExecResult>;
}

export interface PrSummary {
  number: number;
  title: string;
  author: string;
  headRefName: string;
  baseRefName: string;
  state: string;
  isDraft: boolean;
  reviewDecision: string;
  updatedAt: string;
  url: string;
}

export interface PrFileChange {
  path: string;
  additions: number;
  deletions: number;
}

export interface PrComment {
  author: string;
  body: string;
  createdAt: string;
}

export interface PrDetail extends PrSummary {
  body: string;
  additions: number;
  deletions: number;
  files: PrFileChange[];
  comments: PrComment[];
}

export interface GitFileStatus {
  path: string;
  /** Two-letter porcelain code (index column + worktree column), e.g. " M", "??", "A ". */
  status: string;
}

export interface GitLogEntry {
  hash: string;
  shortHash: string;
  author: string;
  date: string;
  subject: string;
}

/** Index column ≠ space/? means something is staged for this file. */
export function isStaged(status: GitFileStatus): boolean {
  return status.status[0] !== " " && status.status[0] !== "?";
}

/** Worktree column ≠ space, or untracked, means unstaged edits exist. */
export function hasUnstagedChanges(status: GitFileStatus): boolean {
  return status.status[1] !== " " || status.status[0] === "?";
}

export class GitService {
  /** Swappable for tests; resolved lazily so the bridge can install first. */
  bridgeFactory: () => ElectronGitApi | null = () =>
    (globalThis as { electronGit?: ElectronGitApi }).electronGit ?? null;
  private bridgeInstance: ElectronGitApi | null | undefined;

  constructor(readonly app: App) {}

  private get bridge(): ElectronGitApi | null {
    if (this.bridgeInstance === undefined) this.bridgeInstance = this.bridgeFactory();
    return this.bridgeInstance;
  }

  isAvailable(): boolean {
    return Boolean(this.bridge?.available && this.baseDir());
  }

  /** The vault folder git runs in; null for in-memory vaults. */
  baseDir(): string | null {
    const adapter = this.app.vault.adapter as { getBasePath?: () => string };
    return adapter.getBasePath?.() ?? null;
  }

  async isRepository(): Promise<boolean> {
    const result = await this.exec(["rev-parse", "--is-inside-work-tree"]);
    return result?.code === 0 && result.stdout.trim() === "true";
  }

  /**
   * The file's content at HEAD; null when git is unavailable, the vault is
   * not a repository, or the file is untracked/new at HEAD.
   */
  async readHeadFile(path: string): Promise<string | null> {
    const result = await this.exec(["show", `HEAD:${path}`]);
    if (!result || result.code !== 0) return null;
    return result.stdout;
  }

  /** Working-tree changes, porcelain v1. */
  async status(): Promise<GitFileStatus[]> {
    const result = await this.exec(["status", "--porcelain"]);
    if (!result || result.code !== 0) return [];
    return result.stdout
      .split("\n")
      .filter((line) => line.length > 3)
      .map((line) => ({ status: line.slice(0, 2), path: line.slice(3).trim().replace(/^"|"$/g, "") }));
  }

  async stage(paths: string[]): Promise<boolean> {
    if (paths.length === 0) return true;
    const result = await this.exec(["add", "--", ...paths]);
    return result?.code === 0;
  }

  async unstage(paths: string[]): Promise<boolean> {
    if (paths.length === 0) return true;
    const result = await this.exec(["restore", "--staged", "--", ...paths]);
    return result?.code === 0;
  }

  /** Commits the index. Returns the error output on failure, null on success. */
  async commit(message: string): Promise<string | null> {
    const result = await this.exec(["commit", "-m", message]);
    if (!result) return "git is not available";
    if (result.code !== 0) return result.stderr.trim() || result.stdout.trim() || `git commit exited ${result.code}`;
    this.app.workspace.trigger("git-commit", message);
    return null;
  }

  /** The staged (index) content of a file; null when nothing is staged. */
  async readIndexFile(path: string): Promise<string | null> {
    const result = await this.exec(["show", `:0:${path}`]);
    if (!result || result.code !== 0) return null;
    return result.stdout;
  }

  /** Recent commits touching `path` (or the whole repo when omitted). */
  async log(path?: string, limit = 50): Promise<GitLogEntry[]> {
    const args = ["log", `-n${limit}`, "--format=%H%x1f%h%x1f%an%x1f%aI%x1f%s"];
    if (path) args.push("--follow", "--", path);
    const result = await this.exec(args);
    if (!result || result.code !== 0) return [];
    return result.stdout
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [hash, shortHash, author, date, subject] = line.split("\x1f");
        return { hash, shortHash, author, date, subject };
      })
      .filter((entry) => entry.hash && entry.subject !== undefined);
  }

  /** File content at an arbitrary ref; null when missing at that ref. */
  async readFileAt(ref: string, path: string): Promise<string | null> {
    const result = await this.exec(["show", `${ref}:${path}`]);
    if (!result || result.code !== 0) return null;
    return result.stdout;
  }

  // --- GitHub PRs, via the gh CLI --------------------------------------

  /** True when gh is installed and authenticated for this repo's host. */
  async ghAvailable(): Promise<boolean> {
    if (this.ghAvailableCache === undefined) {
      const result = await this.gh(["auth", "status"]);
      this.ghAvailableCache = result?.code === 0;
    }
    return this.ghAvailableCache;
  }

  async prList(): Promise<PrSummary[]> {
    const result = await this.gh(["pr", "list", "--json", PR_SUMMARY_FIELDS]);
    if (!result || result.code !== 0) return [];
    return parseJson<RawPr[]>(result.stdout, []).map(toPrSummary);
  }

  async prView(number: number): Promise<PrDetail | null> {
    const result = await this.gh(["pr", "view", String(number), "--json", `${PR_SUMMARY_FIELDS},body,additions,deletions,files,comments`]);
    if (!result || result.code !== 0) return null;
    const raw = parseJson<RawPr | null>(result.stdout, null);
    if (!raw) return null;
    return {
      ...toPrSummary(raw),
      body: raw.body ?? "",
      additions: raw.additions ?? 0,
      deletions: raw.deletions ?? 0,
      files: raw.files ?? [],
      comments: (raw.comments ?? []).map((c) => ({ author: c.author?.login ?? "", body: c.body, createdAt: c.createdAt })),
    };
  }

  /** Unified patch text of the PR, ready for @pierre/diffs parsePatchFiles. */
  async prDiff(number: number): Promise<string | null> {
    const result = await this.gh(["pr", "diff", String(number)]);
    if (!result || result.code !== 0) return null;
    return result.stdout;
  }

  /** Returns the error output on failure, null on success. */
  async prCheckout(number: number): Promise<string | null> {
    return this.ghAction(["pr", "checkout", String(number)]);
  }

  async prComment(number: number, body: string): Promise<string | null> {
    return this.ghAction(["pr", "comment", String(number), "--body", body]);
  }

  async prReview(number: number, verdict: "approve" | "request-changes" | "comment", body?: string): Promise<string | null> {
    const args = ["pr", "review", String(number), `--${verdict}`];
    if (body) args.push("--body", body);
    return this.ghAction(args);
  }

  /** Creates a PR from the current branch. */
  async prCreate(title: string, body: string): Promise<{ url: string } | { error: string }> {
    const result = await this.gh(["pr", "create", "--title", title, "--body", body]);
    if (!result) return { error: "gh is not available" };
    if (result.code !== 0) return { error: result.stderr.trim() || result.stdout.trim() };
    return { url: result.stdout.trim() };
  }

  private async ghAction(args: string[]): Promise<string | null> {
    const result = await this.gh(args);
    if (!result) return "gh is not available";
    if (result.code !== 0) return result.stderr.trim() || result.stdout.trim() || `gh exited ${result.code}`;
    return null;
  }

  private ghAvailableCache: boolean | undefined;

  private async gh(args: string[]): Promise<GitExecResult | null> {
    const cwd = this.baseDir();
    if (!this.bridge?.available || !this.bridge.execGh || !cwd) return null;
    try {
      return await this.bridge.execGh(args, cwd);
    } catch (error) {
      console.error("gh exec failed", args, error);
      return null;
    }
  }

  private async exec(args: string[]): Promise<GitExecResult | null> {
    const cwd = this.baseDir();
    if (!this.bridge?.available || !cwd) return null;
    try {
      return await this.bridge.exec(args, cwd);
    } catch (error) {
      console.error("git exec failed", args, error);
      return null;
    }
  }
}

const PR_SUMMARY_FIELDS = "number,title,author,headRefName,baseRefName,state,isDraft,reviewDecision,updatedAt,url";

interface RawPr {
  number: number;
  title: string;
  author?: { login?: string };
  headRefName?: string;
  baseRefName?: string;
  state?: string;
  isDraft?: boolean;
  reviewDecision?: string;
  updatedAt?: string;
  url?: string;
  body?: string;
  additions?: number;
  deletions?: number;
  files?: PrFileChange[];
  comments?: { author?: { login?: string }; body: string; createdAt: string }[];
}

function toPrSummary(raw: RawPr): PrSummary {
  return {
    number: raw.number,
    title: raw.title,
    author: raw.author?.login ?? "",
    headRefName: raw.headRefName ?? "",
    baseRefName: raw.baseRefName ?? "",
    state: raw.state ?? "",
    isDraft: raw.isDraft ?? false,
    reviewDecision: raw.reviewDecision ?? "",
    updatedAt: raw.updatedAt ?? "",
    url: raw.url ?? "",
  };
}

function parseJson<T>(text: string, fallback: T): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}
