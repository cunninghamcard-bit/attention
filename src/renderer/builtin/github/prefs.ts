import type { RepoSection } from "./session";
import type { PrListFilter } from "./types";

const STORAGE_KEY = "workbench-github-pr-prefs";

export interface GithubPrPrefs {
  owner: string;
  repo: string;
  filter: PrListFilter;
  /** Last opened PR number in this repo, if any. */
  lastPr?: number;
  /** Last selected branch for the Commits section. */
  lastBranch?: string;
  /** Last active sub-view in a repository tab. */
}

export function readGithubPrPrefs(): Partial<GithubPrPrefs> {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Partial<GithubPrPrefs>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function writeGithubPrPrefs(patch: Partial<GithubPrPrefs>): GithubPrPrefs {
  const next: GithubPrPrefs = {
    owner: "",
    repo: "",
    filter: "open",
    ...readGithubPrPrefs(),
    ...patch,
  };
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore quota / private mode
  }
  return next;
}
