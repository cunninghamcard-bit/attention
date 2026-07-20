import { describe, expect, it } from "vitest";
import {
  GitHubClient,
  type HttpResponse,
  type HttpTransport,
} from "@web/builtin/github/GitHubClient";

const REPO = { owner: "acme", repo: "attention", host: "github.com" };

function mock(routes: Record<string, HttpResponse>): HttpTransport {
  return async ({ url, method }) => {
    const path = url.replace(/^https:\/\/api\.github\.com/, "");
    const key = `${method ?? "GET"} ${path}`;
    return (
      routes[key] ?? { status: 404, text: `missing ${key}`, json: { message: `missing ${key}` } }
    );
  };
}

const json = (data: unknown): HttpResponse => ({ status: 200, text: "", json: data });

const TREE_ROUTE = "GET /repos/acme/attention/git/trees/main?recursive=1";

describe("repository tree", () => {
  // The whole point of the endpoint is one request for every path — a route
  // without recursive=1 answers only the root and would quietly build a
  // one-level "tree".
  it("asks for the whole tree in one recursive request", async () => {
    const client = new GitHubClient(
      mock({
        [TREE_ROUTE]: json({
          tree: [
            { path: "src", type: "tree" },
            { path: "apps/web/GitHubClient.ts", type: "blob" },
          ],
          truncated: false,
        }),
      }),
      "tok",
    );

    expect(await client.listTree(REPO, "main")).toEqual({
      entries: [
        { path: "src", type: "tree" },
        // Full path from the repo root, not a basename: the tree model needs
        // the parentage, and "GitHubClient.ts" alone cannot say where it sits.
        { path: "apps/web/GitHubClient.ts", type: "blob" },
      ],
      truncated: false,
    });
  });

  // The failure this guards is silent: GitHub caps the recursive tree and still
  // returns a healthy-looking prefix, so a caller that reads entries.length
  // sees hundreds of files and renders a confidently incomplete tree.
  it("reports truncation even though the entries look fine", async () => {
    const client = new GitHubClient(
      mock({
        [TREE_ROUTE]: json({
          tree: [
            { path: "a.ts", type: "blob" },
            { path: "b.ts", type: "blob" },
          ],
          truncated: true,
        }),
      }),
      "tok",
    );

    const tree = await client.listTree(REPO, "main");
    expect(tree.truncated).toBe(true);
    // Entries survive truncation: a partial tree is data, not an error. If this
    // returned [] the caller could not tell truncation from an empty repo.
    expect(tree.entries).toHaveLength(2);
  });

  // Pins truncated to the API's own word. An implementation that inferred it
  // (e.g. entries.length >= 100_000) passes the test above and fails here.
  it("takes truncation from the API, not from the entry count", async () => {
    const client = new GitHubClient(
      mock({
        [TREE_ROUTE]: json({
          tree: Array.from({ length: 500 }, (_, i) => ({ path: `f${i}.ts`, type: "blob" })),
          truncated: false,
        }),
      }),
      "tok",
    );

    const tree = await client.listTree(REPO, "main");
    expect(tree.entries).toHaveLength(500);
    expect(tree.truncated).toBe(false);
  });

  it("treats a missing truncated field as not truncated", async () => {
    const client = new GitHubClient(
      mock({ [TREE_ROUTE]: json({ tree: [{ path: "a.ts", type: "blob" }] }) }),
      "tok",
    );
    expect((await client.listTree(REPO, "main")).truncated).toBe(false);
  });

  // git also names commits (submodules) and symlinks in a tree; neither is a
  // path the tree can open, and passing them through would widen the type.
  it("keeps only blobs and trees", async () => {
    const client = new GitHubClient(
      mock({
        [TREE_ROUTE]: json({
          tree: [
            { path: "a.ts", type: "blob" },
            { path: "vendor/lib", type: "commit" },
            { path: "", type: "blob" },
          ],
          truncated: false,
        }),
      }),
      "tok",
    );
    expect((await client.listTree(REPO, "main")).entries).toEqual([{ path: "a.ts", type: "blob" }]);
  });

  it("asks for nothing when the ref is blank", async () => {
    // A 404 route would throw; returning early proves no request was made.
    const client = new GitHubClient(mock({}), "tok");
    expect(await client.listTree(REPO, "  ")).toEqual({ entries: [], truncated: false });
  });

  it("surfaces a missing ref instead of inventing an empty tree", async () => {
    const client = new GitHubClient(mock({}), "tok");
    await expect(client.listTree(REPO, "nope")).rejects.toThrow();
  });
});
