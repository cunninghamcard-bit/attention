import { parsePatchFiles, type FileDiffMetadata } from "@pierre/diffs";
import {
  fingerprintContents,
  type ReviewFile,
  type ReviewFileStatus,
} from "../git/review/reviewModel";

/**
 * Turn a GitHub `files[].patch` (hunk-only) into FileDiffMetadata for @pierre/diffs.
 * Full `git` style patches pass through unchanged.
 */
export function fileDiffFromGithubPatch(
  path: string,
  patch: string | null | undefined,
): FileDiffMetadata | null {
  if (!patch?.trim()) return null;
  const full = patch.startsWith("diff --git")
    ? patch
    : [
        `diff --git a/${path} b/${path}`,
        `--- a/${path}`,
        `+++ b/${path}`,
        patch.endsWith("\n") ? patch : `${patch}\n`,
      ].join("\n");
  try {
    const files = parsePatchFiles(full).flatMap((entry) => entry.files);
    return files.find((file) => file.name === path || file.name.endsWith(path)) ?? files[0] ?? null;
  } catch {
    return null;
  }
}

export function fileDiffsFromUnifiedDiff(diffText: string): FileDiffMetadata[] {
  if (!diffText.trim()) return [];
  try {
    return parsePatchFiles(diffText).flatMap((entry) => entry.files);
  } catch {
    return [];
  }
}

export interface GithubFileChange {
  path: string;
  status: string;
  patch: string | null;
  additions: number;
  deletions: number;
}

function reviewStatus(status: string): ReviewFileStatus {
  if (status === "added") return "added";
  if (status === "removed" || status === "deleted") return "deleted";
  if (status === "renamed") return "renamed";
  return "modified";
}

/**
 * GitHub file changes (`files[].patch` hunks) plus the full unified diff →
 * `ReviewFile[]` for the shared `ReviewSurface`. The unified diff wins when a
 * path is present in both; the per-file patch is the fallback. Shared by the PR
 * and commit detail views so neither hand-rolls a diff pane.
 */
export function toReviewFiles(
  files: GithubFileChange[],
  unifiedDiff: string,
  fingerprintSeed: string,
): ReviewFile[] {
  const byPath = new Map(fileDiffsFromUnifiedDiff(unifiedDiff).map((file) => [file.name, file]));
  return files.map((file) => {
    const fileDiff = byPath.get(file.path) ?? fileDiffFromGithubPatch(file.path, file.patch);
    return {
      path: file.path,
      status: reviewStatus(file.status),
      fileDiff: fileDiff ?? ({ name: file.path, type: "change" } as FileDiffMetadata),
      additions: file.additions,
      deletions: file.deletions,
      fingerprint: fingerprintContents(file.path, fingerprintSeed),
      binary: !file.patch && !fileDiff,
    };
  });
}
