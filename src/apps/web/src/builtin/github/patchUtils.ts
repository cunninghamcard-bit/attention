import { parsePatchFiles, type FileDiffMetadata } from "@pierre/diffs";

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
