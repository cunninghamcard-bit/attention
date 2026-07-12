import { describe, expect, it } from "vitest";
import {
  GitHubClient,
  type HttpResponse,
  type HttpTransport,
} from "@web/builtin/github/GitHubClient";

function mock(routes: Record<string, HttpResponse>): HttpTransport {
  return async ({ url, method, headers }) => {
    const path = url.replace(/^https:\/\/api\.github\.com/, "");
    const key = `${method ?? "GET"} ${path}`;
    if (headers?.Accept?.includes("diff") && path.includes("/commits/")) {
      return routes[`DIFF ${path}`] ?? { status: 404, text: "no diff", json: null };
    }
    return (
      routes[key] ?? { status: 404, text: `missing ${key}`, json: { message: `missing ${key}` } }
    );
  };
}

const REPO = { owner: "coder", repo: "ghostty-web", host: "github.com" };

describe("GitHubClient commits/branches", () => {
  it("lists branches and commits with pagination flags", async () => {
    const client = new GitHubClient(
      mock({
        "GET /repos/coder/ghostty-web/branches?per_page=100": {
          status: 200,
          text: "",
          json: [
            { name: "main", protected: true, commit: { sha: "aaa" } },
            { name: "fix/powerline-vector-glyphs", protected: false, commit: { sha: "bbb" } },
          ],
        },
        "GET /repos/coder/ghostty-web": {
          status: 200,
          text: "",
          json: { default_branch: "main" },
        },
        "GET /repos/coder/ghostty-web/commits?page=1&per_page=30&sha=main": {
          status: 200,
          text: "",
          json: Array.from({ length: 30 }, (_, i) => ({
            sha: `sha${i.toString().padStart(4, "0")}deadbeef`,
            html_url: "",
            author: { login: "cunninghamcard-bit", avatar_url: "", html_url: "" },
            commit: {
              message: `commit ${i}\n\nbody`,
              author: { name: "Card", date: "2026-07-01T00:00:00Z" },
              committer: { date: "2026-07-01T00:00:00Z" },
            },
          })),
        },
      }),
      "token",
    );

    const branches = await client.listBranches(REPO);
    expect(branches).toHaveLength(2);
    expect(branches[0].name).toBe("main");
    expect(await client.getDefaultBranch(REPO)).toBe("main");

    const page = await client.listCommits(REPO, { ref: "main", page: 1, perPage: 30 });
    expect(page.items).toHaveLength(30);
    expect(page.hasNextPage).toBe(true);
    expect(page.hasPreviousPage).toBe(false);
    expect(page.items[0].headline).toBe("commit 0");
  });

  it("loads commit detail with files and stats", async () => {
    const client = new GitHubClient(
      mock({
        "GET /repos/coder/ghostty-web/commits/deadbeef": {
          status: 200,
          text: "",
          json: {
            sha: "deadbeef0123456789",
            html_url: "https://github.com/coder/ghostty-web/commit/deadbeef",
            author: { login: "cunninghamcard-bit", avatar_url: "", html_url: "" },
            commit: {
              message: "fix: powerline\n\nDetails here.",
              author: { name: "Card", date: "2026-07-11T00:00:00Z" },
              committer: { name: "Card", date: "2026-07-11T00:00:00Z" },
              verification: { verified: true, reason: "valid" },
            },
            parents: [{ sha: "parentsha000", html_url: "" }],
            stats: { additions: 103, deletions: 2, total: 105 },
            files: [
              {
                filename: "lib/renderer.ts",
                status: "modified",
                additions: 81,
                deletions: 1,
                patch: "@@ -1 +1 @@\n-a\n+b\n",
              },
              {
                filename: "lib/renderer.test.ts",
                status: "modified",
                additions: 22,
                deletions: 1,
                patch: "@@ -1 +1 @@\n-c\n+d\n",
              },
            ],
          },
        },
        "GET /repos/coder/ghostty-web/commits/deadbeef0123456789/check-runs?per_page=100": {
          status: 200,
          text: "",
          json: { check_runs: [] },
        },
        "GET /repos/coder/ghostty-web/commits/deadbeef0123456789/status": {
          status: 200,
          text: "",
          json: { state: "success" },
        },
        "DIFF /repos/coder/ghostty-web/commits/deadbeef": {
          status: 200,
          text: "diff --git a/lib/renderer.ts b/lib/renderer.ts\n",
          json: null,
        },
      }),
      "token",
    );

    const detail = await client.getCommit(REPO, "deadbeef");
    expect(detail.headline).toBe("fix: powerline");
    expect(detail.files).toHaveLength(2);
    expect(detail.stats.additions).toBe(103);
    expect(detail.verification?.verified).toBe(true);
    expect(detail.ciState).toBe("success");
    expect(detail.parents[0].shortSha).toBe("parents");

    const diff = await client.getCommitDiff(REPO, "deadbeef");
    expect(diff).toContain("diff --git");
  });
});
