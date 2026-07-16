import { describe, expect, it } from "vitest";
import { App } from "@web/app/App";
import type { HttpResponse, HttpTransport } from "@web/builtin/github/GitHubClient";

const REPO = { owner: "acme", repo: "attention", host: "github.com" };

/** Views reach GitHub only through `app.github`. A client method with no
 * service method behind it typechecks, unit-tests green, and is unreachable
 * from every consumer — so this asks the question through the door the tree
 * actually uses. */
function serviceApp(json: unknown, status = 200): { app: App; urls: string[] } {
  const app = new App(document.createElement("div"));
  const urls: string[] = [];
  app.github.setToken("tok");
  app.github.transportFactory =
    (): HttpTransport =>
    async ({ url }) => {
      urls.push(url);
      return { status, text: JSON.stringify(json), json } as HttpResponse;
    };
  return { app, urls };
}

describe("repository tree, through the service", () => {
  it("hands a view the whole tree at a ref", async () => {
    const { app, urls } = serviceApp({
      tree: [
        { path: "src", type: "tree" },
        { path: "src/main.ts", type: "blob" },
      ],
      truncated: false,
    });

    const tree = await app.github.listTree("main", REPO);

    expect(tree).toEqual({
      entries: [
        { path: "src", type: "tree" },
        { path: "src/main.ts", type: "blob" },
      ],
      truncated: false,
    });
    expect(urls[0]).toContain("/repos/acme/attention/git/trees/main?recursive=1");
  });

  it("carries truncation out to the caller that has to fall back", async () => {
    const { app } = serviceApp({ tree: [{ path: "a.ts", type: "blob" }], truncated: true });
    // The flag has to survive the service too: the view decides between the
    // tree and per-level browsing on it, and nothing else can tell it.
    expect((await app.github.listTree("main", REPO)).truncated).toBe(true);
  });

  it("refuses without a token rather than reporting an empty repository", async () => {
    const { app } = serviceApp({ tree: [], truncated: false });
    app.github.clearToken();
    await expect(app.github.listTree("main", REPO)).rejects.toThrow(/Sign in/);
  });
});
