import type { PrListFilter } from "./types";

const STORAGE_KEY = "attention-github-pr-prefs";

export interface GitHubPrPrefs {
  owner: string;
  repo: string;
  filter: PrListFilter;
  /** Last opened PR number in this repo, if any. */
  lastPr?: number;
  /** Last selected branch for the Commits section. */
  lastBranch?: string;
}

export function readGitHubPrPrefs(): Partial<GitHubPrPrefs> {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Partial<GitHubPrPrefs>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function writeGitHubPrPrefs(patch: Partial<GitHubPrPrefs>): GitHubPrPrefs {
  const next: GitHubPrPrefs = {
    owner: "",
    repo: "",
    filter: "open",
    ...readGitHubPrPrefs(),
    ...patch,
  };
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore quota / private mode
  }
  return next;
}
