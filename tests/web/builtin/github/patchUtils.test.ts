import { describe, expect, it } from "vitest";
import { fileDiffFromGitHubPatch, fileDiffsFromUnifiedDiff } from "@web/builtin/github/patchUtils";

describe("patchUtils", () => {
  it("parses GitHub hunk-only patches into FileDiffMetadata", () => {
    const meta = fileDiffFromGitHubPatch(
      "lib/renderer.ts",
      "@@ -1,3 +1,4 @@\n line\n-old\n+new\n keep\n",
    );
    expect(meta).not.toBeNull();
    expect(meta!.name).toContain("renderer");
  });

  it("parses a full unified PR diff into multiple files", () => {
    const diff = `diff --git a/lib/renderer.test.ts b/lib/renderer.test.ts
--- a/lib/renderer.test.ts
+++ b/lib/renderer.test.ts
@@ -1,1 +1,1 @@
-old
+new
diff --git a/lib/renderer.ts b/lib/renderer.ts
--- a/lib/renderer.ts
+++ b/lib/renderer.ts
@@ -1,1 +1,1 @@
-a
+b
`;
    const files = fileDiffsFromUnifiedDiff(diff);
    expect(files.length).toBe(2);
    expect(files.map((f) => f.name).join(",")).toMatch(/renderer/);
  });
});
