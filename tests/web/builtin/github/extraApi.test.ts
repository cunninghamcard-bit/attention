import { describe, expect, it } from "vitest";
import {
  GitHubClient,
  type HttpResponse,
  type HttpTransport,
} from "@web/builtin/github/GitHubClient";

function mock(routes: Record<string, HttpResponse>): HttpTransport {
  return async ({ url, method }) => {
    const path = url.replace(/^https:\/\/api\.github\.com/, "");
    const key = `${method ?? "GET"} ${path}`;
    return routes[key] ?? { status: 404, text: key, json: { message: key } };
  };
}

const REPO = { owner: "coder", repo: "ghostty-web", host: "github.com" };

describe("GitHubClient issues/actions/files/inbox/merge", () => {
  it("lists issues excluding pull requests", async () => {
    const client = new GitHubClient(
      mock({
        "GET /repos/coder/ghostty-web/issues?state=open&sort=updated&direction=desc&per_page=50": {
          status: 200,
          text: "",
          json: [
            {
              number: 1,
              title: "Bug",
              state: "open",
              user: { login: "a" },
              created_at: "",
              updated_at: "",
              html_url: "",
              labels: [],
              comments: 0,
            },
            {
              number: 2,
              title: "PR-ish",
              state: "open",
              user: { login: "a" },
              created_at: "",
              updated_at: "",
              html_url: "",
              labels: [],
              comments: 0,
              pull_request: {},
            },
          ],
        },
      }),
      "tok",
    );
    const issues = await client.listIssues(REPO, "open");
    expect(issues).toHaveLength(1);
    expect(issues[0].title).toBe("Bug");
  });

  it("loads issue detail with comments", async () => {
    const client = new GitHubClient(
      mock({
        "GET /repos/coder/ghostty-web/issues/10": {
          status: 200,
          text: "",
          json: {
            number: 10,
            title: "Hello",
            state: "open",
            body: "Body",
            user: { login: "card" },
            created_at: "2026-01-01T00:00:00Z",
            updated_at: "2026-01-02T00:00:00Z",
            html_url: "https://x",
            labels: [],
            comments: 1,
            assignees: [],
          },
        },
        "GET /repos/coder/ghostty-web/issues/10/comments?per_page=100": {
          status: 200,
          text: "",
          json: [
            {
              id: 1,
              user: { login: "rev" },
              body: "hi",
              created_at: "2026-01-02T00:00:00Z",
              updated_at: "",
              html_url: "",
            },
          ],
        },
      }),
      "tok",
    );
    const detail = await client.getIssue(REPO, 10);
    expect(detail.body).toBe("Body");
    expect(detail.commentsList[0].body).toBe("hi");
  });

  it("lists workflow runs and run detail jobs", async () => {
    const client = new GitHubClient(
      mock({
        "GET /repos/coder/ghostty-web/actions/runs?per_page=30&page=1": {
          status: 200,
          text: "",
          json: {
            workflow_runs: [
              {
                id: 99,
                name: "ci",
                display_title: "ci on main",
                status: "completed",
                conclusion: "success",
                head_branch: "main",
                head_sha: "abc",
                event: "push",
                html_url: "https://x",
                created_at: "",
                updated_at: "",
                run_number: 1,
                run_attempt: 1,
              },
            ],
          },
        },
        "GET /repos/coder/ghostty-web/actions/runs/99": {
          status: 200,
          text: "",
          json: {
            id: 99,
            name: "ci",
            display_title: "ci on main",
            status: "completed",
            conclusion: "success",
            head_branch: "main",
            head_sha: "abc",
            event: "push",
            html_url: "https://x",
            created_at: "",
            updated_at: "",
            run_number: 1,
            run_attempt: 1,
          },
        },
        "GET /repos/coder/ghostty-web/actions/runs/99/jobs?per_page=50": {
          status: 200,
          text: "",
          json: {
            jobs: [
              {
                id: 1,
                name: "build",
                status: "completed",
                conclusion: "success",
                steps: [
                  { name: "checkout", status: "completed", conclusion: "success", number: 1 },
                ],
              },
            ],
          },
        },
      }),
      "tok",
    );
    const runs = await client.listWorkflowRuns(REPO);
    expect(runs[0].id).toBe(99);
    const detail = await client.getWorkflowRun(REPO, 99);
    expect(detail.jobs[0].steps[0].name).toBe("checkout");
  });

  it("lists contents and decodes file text", async () => {
    const content = btoa("hello world\n");
    const client = new GitHubClient(
      mock({
        "GET /repos/coder/ghostty-web/contents": {
          status: 200,
          text: "",
          json: [
            { name: "src", path: "src", type: "dir", size: 0, sha: "1", html_url: "" },
            {
              name: "README.md",
              path: "README.md",
              type: "file",
              size: 12,
              sha: "2",
              html_url: "",
            },
          ],
        },
        "GET /repos/coder/ghostty-web/contents/README.md": {
          status: 200,
          text: "",
          json: {
            name: "README.md",
            path: "README.md",
            type: "file",
            size: 12,
            sha: "2",
            encoding: "base64",
            content,
            html_url: "https://x",
            download_url: null,
          },
        },
      }),
      "tok",
    );
    const list = await client.listContents(REPO, "");
    expect(list.map((i) => i.name)).toEqual(["src", "README.md"]);
    const file = await client.getFileContent(REPO, "README.md");
    expect(file.text).toContain("hello world");
  });

  it("lists notifications and merges PRs", async () => {
    const client = new GitHubClient(
      mock({
        "GET /notifications?per_page=40": {
          status: 200,
          text: "",
          json: [
            {
              id: "n1",
              unread: true,
              reason: "review_requested",
              updated_at: "2026-07-01T00:00:00Z",
              subject: {
                title: "Please review",
                type: "PullRequest",
                url: "https://api.github.com/repos/coder/ghostty-web/pulls/185",
              },
              repository: { full_name: "coder/ghostty-web" },
            },
          ],
        },
        "POST /repos/coder/ghostty-web/pulls/185/merge": {
          status: 200,
          text: "",
          json: { merged: true, message: "Pull Request successfully merged", sha: "deadbeef" },
        },
      }),
      "tok",
    );
    const notes = await client.listNotifications();
    expect(notes[0].repository).toBe("coder/ghostty-web");
    const merge = await client.mergePullRequest(REPO, 185, { method: "squash" });
    expect(merge.merged).toBe(true);
    expect(merge.sha).toBe("deadbeef");
  });
});
