import type { GitHubRepositoryRef } from "./types";

/**
 * Parse a git remote URL into owner/repo. Supports HTTPS, SSH, and
 * `git@host:owner/repo.git` forms used by github.com and GHES.
 */
export function parseGitRemoteUrl(remoteUrl: string): GitHubRepositoryRef | null {
  const raw = remoteUrl.trim().replace(/\.git$/i, "");
  if (!raw) return null;

  // git@github.com:owner/repo
  const scp = /^git@([^:]+):(.+)$/.exec(raw);
  if (scp) {
    const host = scp[1];
    const path = scp[2].replace(/^\/+/, "");
    const parts = path.split("/").filter(Boolean);
    if (parts.length >= 2)
      return { host, owner: parts[parts.length - 2], repo: parts[parts.length - 1] };
    return null;
  }

  // ssh://git@github.com/owner/repo
  const ssh = /^ssh:\/\/(?:git@)?([^/]+)\/(.+)$/.exec(raw);
  if (ssh) {
    const host = ssh[1];
    const parts = ssh[2].split("/").filter(Boolean);
    if (parts.length >= 2)
      return { host, owner: parts[parts.length - 2], repo: parts[parts.length - 1] };
    return null;
  }

  // https://github.com/owner/repo or https://github.com/owner/repo/pull/1
  try {
    const withScheme = /^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`;
    const url = new URL(withScheme);
    const host = url.hostname;
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length >= 2) return { host, owner: parts[0], repo: parts[1] };
  } catch {
    return null;
  }
  return null;
}

export function apiBaseUrlForHost(host: string): string {
  if (host === "github.com" || host === "www.github.com") return "https://api.github.com";
  return `https://${host}/api/v3`;
}

export function htmlBaseUrlForHost(host: string): string {
  if (host === "github.com" || host === "www.github.com") return "https://github.com";
  return `https://${host}`;
}
