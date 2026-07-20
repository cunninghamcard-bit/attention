import type { App } from "../../app/App";
import { GitReviewSession } from "./reviewSession";
import type { ElectronGitApi, GitExecResult } from "@app/shared/gitApi";

/**
 * `app.git` — read-side git access for the vault working tree, backed by the
 * preload git bridge (desktop). Browser mode reports unavailable, same pattern
 * as the terminal. The `ElectronGitApi` port contract is declared once in
 * `src/shared` and filled by the shell's `git-bridge.ts`.
 */

export type { ElectronGitApi, GitExecResult };

/** A draft inline review comment anchored to a diff line. */
export interface PrDraftComment {
  path: string;
  line: number;
  /** Which side of the diff the line lives on. */
  side: "additions" | "deletions";
  body: string;
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
  headRefOid: string;
  files: PrFileChange[];
  comments: PrComment[];
}

export interface GitNumstatEntry {
  path: string;
  additions: number;
  deletions: number;
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
  avatarUrl?: string;
  date: string;
  subject: string;
}

export interface GitBranch {
  name: string;
  current: boolean;
}

export interface GitDivergence {
  ahead: number;
  behind: number;
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
  /** Bridges center git-review and right git-nav (codiff Tree/History). */
  readonly reviewSession = new GitReviewSession();

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

  /** Remote URL for `name` (default origin); null when missing or git unavailable. */
  async getRemoteUrl(name = "origin"): Promise<string | null> {
    const result = await this.exec(["remote", "get-url", name]);
    if (!result || result.code !== 0) return null;
    const url = result.stdout.trim();
    return url || null;
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

  /** Working-tree changes, porcelain v1. -uall expands untracked directories
   * into their files, so review/staging always works on real paths. */
  async status(): Promise<GitFileStatus[]> {
    const result = await this.exec(["status", "--porcelain", "-uall"]);
    if (!result || result.code !== 0) return [];
    return result.stdout
      .split("\n")
      .filter((line) => line.length > 3)
      .map((line) => ({
        status: line.slice(0, 2),
        path: line.slice(3).trim().replace(/^"|"$/g, ""),
      }));
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

  /** Empties the index back to HEAD (worktree untouched). */
  async unstageAll(): Promise<boolean> {
    const result = await this.exec(["reset", "-q"]);
    return result?.code === 0;
  }

  /** Commits the index (optionally amending). Error text on failure, null on success. */
  async commit(message: string, options: { amend?: boolean } = {}): Promise<string | null> {
    const args = options.amend ? ["commit", "--amend", "-m", message] : ["commit", "-m", message];
    const result = await this.exec(args);
    if (!result) return "git is not available";
    if (result.code !== 0)
      return result.stderr.trim() || result.stdout.trim() || `git commit exited ${result.code}`;
    this.app.workspace.trigger("git-commit", message);
    return null;
  }

  // --- Branches & sync ---------------------------------------------------

  /** Current branch name; null when detached, unborn, or unavailable. */
  async currentBranch(): Promise<string | null> {
    const result = await this.exec(["rev-parse", "--abbrev-ref", "HEAD"]);
    if (!result || result.code !== 0) return null;
    const name = result.stdout.trim();
    return name && name !== "HEAD" ? name : null;
  }

  /** Local branches, HEAD flagged. */
  async branches(): Promise<GitBranch[]> {
    const result = await this.exec([
      "for-each-ref",
      "refs/heads",
      "--format=%(HEAD)%(refname:short)",
    ]);
    if (!result || result.code !== 0) return [];
    return result.stdout
      .split("\n")
      .filter(Boolean)
      .map((line) => ({ current: line.startsWith("*"), name: line.slice(1) }))
      .filter((branch) => branch.name);
  }

  /** Commits ahead/behind the upstream; null when no upstream is configured. */
  async aheadBehind(): Promise<GitDivergence | null> {
    const result = await this.exec(["rev-list", "--left-right", "--count", "@{upstream}...HEAD"]);
    if (!result || result.code !== 0) return null;
    const [behind, ahead] = result.stdout.trim().split(/\s+/).map(Number);
    if (!Number.isFinite(ahead) || !Number.isFinite(behind)) return null;
    return { ahead, behind };
  }

  async fetch(): Promise<string | null> {
    return this.errorText(await this.exec(["fetch", "--prune"]), "fetch");
  }

  /** Fast-forward only — divergence surfaces git's own advice instead of a merge. */
  async pull(): Promise<string | null> {
    return this.errorText(await this.exec(["pull", "--ff-only"]), "pull");
  }

  /** Pushes; when no upstream exists, retries once with -u origin <branch>. */
  async push(): Promise<string | null> {
    const result = await this.exec(["push"]);
    if (result?.code === 0) return null;
    if (/no upstream|set-upstream/i.test(result?.stderr ?? "")) {
      const branch = await this.currentBranch();
      if (branch) return this.errorText(await this.exec(["push", "-u", "origin", branch]), "push");
    }
    return this.errorText(result, "push");
  }

  async switchBranch(name: string): Promise<string | null> {
    const error = this.errorText(await this.exec(["switch", name]), "switch");
    if (!error) this.app.workspace.trigger("git-branch-change", name);
    return error;
  }

  async createBranch(name: string): Promise<string | null> {
    const error = this.errorText(await this.exec(["switch", "-c", name]), "switch");
    if (!error) this.app.workspace.trigger("git-branch-change", name);
    return error;
  }

  /** Tracked worktree edits go through restore; untracked files through clean. */
  async discard(entries: GitFileStatus[]): Promise<boolean> {
    const untracked = entries.filter((e) => e.status[0] === "?").map((e) => e.path);
    const tracked = entries
      .filter((e) => e.status[0] !== "?" && e.status[1] !== " ")
      .map((e) => e.path);
    let ok = true;
    if (tracked.length > 0)
      ok = (await this.exec(["restore", "--worktree", "--", ...tracked]))?.code === 0 && ok;
    if (untracked.length > 0)
      ok = (await this.exec(["clean", "-f", "--", ...untracked]))?.code === 0 && ok;
    return ok;
  }

  private errorText(result: GitExecResult | null, verb: string): string | null {
    if (!result) return "git is not available";
    if (result.code === 0) return null;
    return result.stderr.trim() || result.stdout.trim() || `git ${verb} exited ${result.code}`;
  }

  /** The staged (index) content of a file; null when nothing is staged. */
  async readIndexFile(path: string): Promise<string | null> {
    const result = await this.exec(["show", `:0:${path}`]);
    if (!result || result.code !== 0) return null;
    return result.stdout;
  }

  /** Recent commits touching `path` (or the whole repo when omitted). */
  async log(path?: string, limit = 50): Promise<GitLogEntry[]> {
    const args = ["log", `-n${limit}`, "--format=%H%x1f%h%x1f%an%x1f%aE%x1f%aI%x1f%s"];
    if (path) args.push("--follow", "--", path);
    const result = await this.exec(args);
    if (!result || result.code !== 0) return [];
    return result.stdout
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [hash, shortHash, author, email, date, subject] = line.split("\x1f");
        const avatarUrl = email ? this.bridge?.gravatarUrl?.(email) : undefined;
        return { hash, shortHash, author, avatarUrl, date, subject };
      })
      .filter((entry) => entry.hash && entry.subject !== undefined);
  }

  /** File content at an arbitrary ref; null when missing at that ref. */
  async readFileAt(ref: string, path: string): Promise<string | null> {
    const result = await this.exec(["show", `${ref}:${path}`]);
    if (!result || result.code !== 0) return null;
    return result.stdout;
  }

  /**
   * Per-file added/removed line counts. No ref: working tree vs HEAD
   * (untracked files not included — callers count those themselves). With a
   * ref: that commit vs its parent.
   */
  async numstat(ref?: string): Promise<GitNumstatEntry[]> {
    const args = ref ? ["show", "--format=", "--numstat", ref] : ["diff", "HEAD", "--numstat"];
    const result = await this.exec(args);
    if (!result || result.code !== 0) return [];
    return result.stdout
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [added, deleted, ...rest] = line.split("\t");
        return {
          path: rest.join("\t"),
          additions: Number(added) || 0,
          deletions: Number(deleted) || 0,
        };
      })
      .filter((entry) => entry.path);
  }

  /** Files changed by a commit, as porcelain-style status + path. */
  async changedFilesIn(ref: string): Promise<GitFileStatus[]> {
    const result = await this.exec(["show", "--format=", "--name-status", ref]);
    if (!result || result.code !== 0) return [];
    return result.stdout
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [status, ...rest] = line.split("\t");
        // Rename lines are "R100\told\tnew" — review the new path.
        return { status: status[0] ?? "M", path: rest[rest.length - 1] ?? "" };
      })
      .filter((entry) => entry.path);
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
    const result = await this.gh([
      "pr",
      "view",
      String(number),
      "--json",
      `${PR_SUMMARY_FIELDS},body,additions,deletions,headRefOid,files,comments`,
    ]);
    if (!result || result.code !== 0) return null;
    const raw = parseJson<RawPr | null>(result.stdout, null);
    if (!raw) return null;
    return {
      ...toPrSummary(raw),
      body: raw.body ?? "",
      additions: raw.additions ?? 0,
      deletions: raw.deletions ?? 0,
      headRefOid: raw.headRefOid ?? "",
      files: raw.files ?? [],
      comments: (raw.comments ?? []).map((c) => ({
        author: c.author?.login ?? "",
        body: c.body,
        createdAt: c.createdAt,
      })),
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

  async prReview(
    number: number,
    verdict: "approve" | "request-changes" | "comment",
    body?: string,
  ): Promise<string | null> {
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

  /**
   * Posts one inline comment immediately (GitHub's single-comment endpoint).
   * Same recipe as codiff: gh api with the JSON body on stdin, line anchored
   * via side LEFT/RIGHT + commit_id of the PR head.
   */
  async prAddInlineComment(
    number: number,
    headSha: string,
    comment: PrDraftComment,
  ): Promise<string | null> {
    const body = JSON.stringify({
      body: comment.body,
      commit_id: headSha,
      path: comment.path,
      line: comment.line,
      side: comment.side === "deletions" ? "LEFT" : "RIGHT",
    });
    return this.ghAction(
      ["api", "-X", "POST", `repos/{owner}/{repo}/pulls/${number}/comments`, "--input", "-"],
      body,
    );
  }

  /**
   * Submits a whole review atomically: every draft comment plus a verdict, in
   * one POST to the reviews endpoint. GitHub requires a body for
   * REQUEST_CHANGES, so one is defaulted.
   */
  async prSubmitReview(
    number: number,
    event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT",
    body: string,
    comments: PrDraftComment[],
  ): Promise<string | null> {
    const payload = JSON.stringify({
      body:
        body ||
        (event === "REQUEST_CHANGES" && comments.length === 0 ? "Requesting changes." : body),
      event,
      comments: comments.map((comment) => ({
        body: comment.body,
        path: comment.path,
        line: comment.line,
        side: comment.side === "deletions" ? "LEFT" : "RIGHT",
      })),
    });
    return this.ghAction(
      ["api", "-X", "POST", `repos/{owner}/{repo}/pulls/${number}/reviews`, "--input", "-"],
      payload,
    );
  }

  private async ghAction(args: string[], input?: string): Promise<string | null> {
    const result = await this.gh(args, input);
    if (!result) return "gh is not available";
    if (result.code !== 0)
      return result.stderr.trim() || result.stdout.trim() || `gh exited ${result.code}`;
    return null;
  }

  private ghAvailableCache: boolean | undefined;

  private async gh(args: string[], input?: string): Promise<GitExecResult | null> {
    const cwd = this.baseDir();
    if (!this.bridge?.available || !this.bridge.execGh || !cwd) return null;
    try {
      return await this.bridge.execGh(args, cwd, input);
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

const PR_SUMMARY_FIELDS =
  "number,title,author,headRefName,baseRefName,state,isDraft,reviewDecision,updatedAt,url";

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
  headRefOid?: string;
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
