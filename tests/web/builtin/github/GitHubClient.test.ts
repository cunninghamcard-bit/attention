import { describe, expect, it } from "vitest";
import {
  GitHubClient,
  type HttpResponse,
  type HttpTransport,
} from "@web/builtin/github/GitHubClient";

function mockTransport(
  routes: Record<string, HttpResponse | ((url: string) => HttpResponse)>,
): HttpTransport {
  return async ({ url, method }) => {
    const key = `${method ?? "GET"} ${url.replace(/^https:\/\/api\.github\.com/, "")}`;
    const handler = routes[key] ?? routes[url];
    if (!handler) return { status: 404, text: "missing", json: { message: `no mock for ${key}` } };
    return typeof handler === "function" ? handler(url) : handler;
  };
}

const REPO = { owner: "acme", repo: "widget", host: "github.com" };

describe("GitHubClient", () => {
  it("maps list pull requests", async () => {
    const client = new GitHubClient(
      mockTransport({
        "GET /repos/acme/widget/pulls?state=open&sort=updated&direction=desc&per_page=50": {
          status: 200,
          text: "[]",
          json: [
            {
              number: 7,
              title: "Add agent",
              state: "open",
              draft: false,
              user: {
                login: "card",
                avatar_url: "https://avatars/x",
                html_url: "https://github.com/card",
              },
              head: { ref: "feat" },
              base: { ref: "main" },
              updated_at: "2026-07-01T00:00:00Z",
              created_at: "2026-06-01T00:00:00Z",
              html_url: "https://github.com/acme/widget/pull/7",
              labels: [{ name: "feat", color: "0e8a16" }],
              additions: 3,
              deletions: 1,
              changed_files: 1,
            },
          ],
        },
      }),
      "token",
    );
    const prs = await client.listPullRequests(REPO, "open");
    expect(prs).toHaveLength(1);
    expect(prs[0]).toMatchObject({
      number: 7,
      title: "Add agent",
      author: { login: "card" },
      headRefName: "feat",
      baseRefName: "main",
      state: "open",
    });
  });

  it("loads PR detail with comments, reviews, files and checks", async () => {
    const client = new GitHubClient(
      mockTransport({
        "GET /repos/acme/widget/pulls/7": {
          status: 200,
          text: "",
          json: {
            number: 7,
            title: "Add agent",
            state: "open",
            body: "Hello",
            user: { login: "card", avatar_url: "", html_url: "" },
            head: { ref: "feat", sha: "abc123" },
            base: { ref: "main" },
            html_url: "https://github.com/acme/widget/pull/7",
            created_at: "2026-06-01T00:00:00Z",
            updated_at: "2026-07-01T00:00:00Z",
            additions: 3,
            deletions: 1,
            changed_files: 1,
            mergeable: true,
            requested_reviewers: [{ login: "rev", avatar_url: "", html_url: "" }],
            assignees: [],
            labels: [],
          },
        },
        "GET /repos/acme/widget/issues/7/comments?per_page=100": {
          status: 200,
          text: "",
          json: [
            {
              id: 1,
              user: { login: "rev" },
              body: "Looks good",
              created_at: "2026-07-02T00:00:00Z",
              updated_at: "2026-07-02T00:00:00Z",
              html_url: "",
            },
          ],
        },
        "GET /repos/acme/widget/pulls/7/reviews?per_page=100": {
          status: 200,
          text: "",
          json: [
            {
              id: 2,
              user: { login: "rev" },
              state: "APPROVED",
              body: "LGTM",
              submitted_at: "2026-07-02T00:00:00Z",
              html_url: "",
            },
          ],
        },
        "GET /repos/acme/widget/pulls/7/comments?per_page=100": {
          status: 200,
          text: "",
          json: [
            {
              id: 3,
              user: { login: "rev" },
              body: "nit",
              path: "a.ts",
              line: 4,
              side: "RIGHT",
              created_at: "2026-07-02T00:00:00Z",
              html_url: "",
              diff_hunk: "@@ -1 +1 @@",
            },
          ],
        },
        "GET /repos/acme/widget/pulls/7/commits?per_page=100": {
          status: 200,
          text: "",
          json: [
            {
              sha: "abc123def",
              commit: {
                message: "feat: add\n\nbody",
                author: { name: "Card", date: "2026-07-01T00:00:00Z" },
                committer: { date: "2026-07-01T00:00:00Z" },
              },
              author: { login: "card", avatar_url: "", html_url: "" },
              html_url: "",
            },
          ],
        },
        "GET /repos/acme/widget/pulls/7/files?per_page=100": {
          status: 200,
          text: "",
          json: [
            {
              filename: "a.ts",
              status: "modified",
              additions: 3,
              deletions: 1,
              patch: "@@ -1 +1 @@\n-old\n+new",
            },
          ],
        },
        "GET /repos/acme/widget/commits/abc123/check-runs?per_page=100": {
          status: 200,
          text: "",
          json: { check_runs: [{ name: "ci", status: "completed", conclusion: "success" }] },
        },
      }),
      "token",
    );

    const detail = await client.getPullRequest(REPO, 7);
    expect(detail.title).toBe("Add agent");
    expect(detail.comments[0].body).toBe("Looks good");
    expect(detail.reviews[0].state).toBe("APPROVED");
    expect(detail.reviewComments[0].path).toBe("a.ts");
    expect(detail.commits[0].shortSha).toBe("abc123d");
    expect(detail.files[0].path).toBe("a.ts");
    expect(detail.checks[0].name).toBe("ci");
    expect(detail.ciState).toBe("success");
    expect(detail.requestedReviewers[0].login).toBe("rev");
  });

  it("rejects unauthenticated requests", async () => {
    const client = new GitHubClient(mockTransport({}), null);
    await expect(client.listPullRequests(REPO)).rejects.toMatchObject({ status: 401 });
  });

  it("searches involvement across repositories with the right qualifier", async () => {
    // The only network behaviour this goal adds: exact qualifier + the
    // repository_url mapper that gives each row its own repo.
    const seen: string[] = [];
    const client = new GitHubClient(
      async ({ url }) => {
        seen.push(url.replace(/^https:\/\/api\.github\.com/, ""));
        return {
          status: 200,
          text: "",
          json: {
            items: [
              {
                number: 185,
                title: "Fix separators",
                state: "open",
                repository_url: "https://api.github.com/repos/coder/ghostty-web",
                pull_request: {},
                user: { login: "ada", avatar_url: "", html_url: "" },
                created_at: "2026-07-11T00:00:00Z",
                updated_at: "2026-07-15T00:00:00Z",
                html_url: "",
                labels: [],
              },
              // No repository_url: unmappable, must be dropped rather than faked.
              { number: 9, title: "orphan", state: "open" },
            ],
          },
        } satisfies HttpResponse;
      },
      "t",
      "github.com",
    );

    const items = await client.searchInvolvement("pr", "review-requested");
    expect(seen[0]).toBe(
      `/search/issues?q=${encodeURIComponent("is:pr review-requested:@me")}` +
        "&sort=updated&order=desc&per_page=40",
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      owner: "coder",
      repo: "ghostty-web",
      number: 185,
      isPullRequest: true,
    });
  });

  it("maps each involvement query to its search qualifier", async () => {
    const seen: string[] = [];
    const client = new GitHubClient(
      async ({ url }) => {
        seen.push(decodeURIComponent(url));
        return { status: 200, text: "", json: { items: [] } } satisfies HttpResponse;
      },
      "t",
      "github.com",
    );
    await client.searchInvolvement("pr", "created");
    await client.searchInvolvement("issue", "assigned");
    await client.searchInvolvement("issue", "mentioned");
    expect(seen[0]).toContain("is:pr author:@me");
    expect(seen[1]).toContain("is:issue assignee:@me");
    expect(seen[2]).toContain("is:issue mentions:@me");
  });
});
