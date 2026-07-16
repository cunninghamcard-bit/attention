import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "@web/app/App";
import { GitHubProfileView } from "@web/builtin/github/GitHubProfileView";
import { GitHubRepoView } from "@web/builtin/github/GitHubRepoView";
import type { GithubRepoListItem } from "@web/builtin/github/GitHubService";

// jsdom lacks ResizeObserver; the shared surfaces need it. Real desktop/web
// runtimes provide it natively.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
}

const USER_REPOS: GithubRepoListItem[] = [
  {
    owner: "ada",
    repo: "notes",
    fullName: "ada/notes",
    private: false,
    description: "Personal notes",
    openIssues: 2,
  },
];

const ORG_REPOS: GithubRepoListItem[] = [
  {
    owner: "acme-corp",
    repo: "platform",
    fullName: "acme-corp/platform",
    private: false,
    description: "Platform",
    openIssues: 3,
  },
  {
    owner: "acme-corp",
    repo: "secrets",
    fullName: "acme-corp/secrets",
    private: true,
    description: "Internal",
    openIssues: 0,
  },
];

async function createApp(): Promise<App> {
  const root = document.createElement("div");
  document.body.appendChild(root);
  const app = new App(root);
  await app.ready;
  // The profile view registers through GitHubPlugin once openOrg is re-pointed
  // (deferred to the #3 merge by contract); tests register it the same way.
  app.viewRegistry.registerView(GitHubProfileView.VIEW_TYPE, (leaf) => new GitHubProfileView(leaf));
  vi.spyOn(app.github, "getAuth").mockResolvedValue({
    hasToken: true,
    login: "ada",
    avatarUrl: "https://example.test/ada.png",
    name: "Ada",
  });
  vi.spyOn(app.github, "listUserRepositories").mockResolvedValue(USER_REPOS);
  vi.spyOn(app.github, "listUserOrganizations").mockResolvedValue([
    { login: "acme-corp", avatarUrl: "https://example.test/acme.png", description: "Acme" },
  ]);
  vi.spyOn(app.github, "listOrgRepositories").mockResolvedValue(ORG_REPOS);
  return app;
}

/** The door openOrg will use once re-pointed at the profile (the #3 merge
 * alignment); tests drive the same view state it will hand over. */
async function openProfile(
  app: App,
  login: string,
  section: "overview" | "repositories" = "overview",
): Promise<void> {
  const leaf =
    app.workspace.getLeavesOfType(GitHubProfileView.VIEW_TYPE)[0] ?? app.workspace.getLeaf("tab");
  await leaf.setViewState({
    type: GitHubProfileView.VIEW_TYPE,
    active: true,
    state: { login, section },
  });
  app.workspace.setActiveLeaf(leaf, { focus: true });
}

function profile(app: App): GitHubProfileView {
  return app.workspace.getLeavesOfType(GitHubProfileView.VIEW_TYPE)[0].view as GitHubProfileView;
}

async function until(condition: () => boolean, what: string): Promise<void> {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > 4000) throw new Error(`timeout: ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => [...values.keys()][index] ?? null,
    removeItem: (key: string) => void values.delete(key),
    setItem: (key: string, value: string) => void values.set(key, value),
  } satisfies Storage);
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

afterEach(() => vi.unstubAllGlobals());

describe("GitHubProfileView (org/user profile tab)", () => {
  it("opens an organization profile tab", async () => {
    const app = await createApp();
    await openProfile(app, "acme-corp");
    const view = profile(app);
    await until(
      () => view.contentEl.querySelector(".github-profile-login")?.textContent === "acme-corp",
      "identity head",
    );
    // Identity head carries the org's own description once the fetch lands.
    await until(
      () => view.contentEl.querySelector(".github-profile-subtitle")?.textContent === "Acme",
      "org subtitle",
    );
    // Sub-views live in the real view-header as flat icon segments — never an
    // in-page sidebar column, never raw browser button chrome.
    const segments = view.headerEl.querySelectorAll(".github-profile-nav button");
    expect([...segments].map((el) => el.getAttribute("aria-label"))).toEqual([
      "Overview",
      "Repositories",
    ]);
    for (const el of segments) expect(el.classList.contains("clickable-icon")).toBe(true);
    expect(view.headerEl.querySelector('[aria-label="Refresh"]')).toBeNull();
    // Overview: stat tiles then top repositories.
    expect(view.contentEl.querySelectorAll(".github-profile-tile")).toHaveLength(3);
    await until(
      () => view.contentEl.querySelectorAll(".github-row").length === ORG_REPOS.length,
      "top repositories",
    );
    expect(app.github.session.target).toMatchObject({ kind: "org", org: "acme-corp" });
  });

  it("opens a repo tab from the profile repositories", async () => {
    const app = await createApp();
    await openProfile(app, "acme-corp", "repositories");
    const view = profile(app);
    await until(() => view.contentEl.querySelector(".github-row") !== null, "repo rows");
    (view.contentEl.querySelector(".github-row") as HTMLElement).click();
    // The open goes through an async setViewState — wait for the applied
    // state, not merely the leaf's existence.
    await until(
      () =>
        app.workspace.getLeavesOfType(GitHubRepoView.VIEW_TYPE)[0]?.view?.getState().owner ===
        "acme-corp",
      "repo tab",
    );
    const repoLeaf = app.workspace.getLeavesOfType(GitHubRepoView.VIEW_TYPE)[0];
    expect(repoLeaf.view?.getState()).toMatchObject({ owner: "acme-corp", repo: "platform" });
    // The profile stays put — the row opens a separate center tab.
    expect(app.workspace.getLeavesOfType(GitHubProfileView.VIEW_TYPE)).toHaveLength(1);
  });

  it("renders the signed-in user's profile from the user endpoint", async () => {
    const app = await createApp();
    await openProfile(app, "ada");
    const view = profile(app);
    await until(
      () => view.contentEl.querySelector(".github-profile-subtitle")?.textContent === "Ada",
      "user subtitle",
    );
    expect(app.github.listUserRepositories).toHaveBeenCalled();
    expect(app.github.listOrgRepositories).not.toHaveBeenCalled();
  });

  it("walks profile sub-view switches with the native back control", async () => {
    const app = await createApp();
    await openProfile(app, "acme-corp");
    const view = profile(app);
    await until(() => view.headerEl.querySelector(".github-profile-nav") !== null, "header");
    (
      view.headerEl.querySelector(
        '.github-segmented-control-item[aria-label="Repositories"]',
      ) as HTMLElement
    ).click();
    await until(() => view.getState().section === "repositories", "repositories sub-view");
    const leaf = app.workspace.getLeavesOfType(GitHubProfileView.VIEW_TYPE)[0];
    // Sub-views are destinations: back returns to Overview, not out of the tab.
    leaf.history.back();
    await until(() => view.getState().section === "overview", "back to overview");
    leaf.history.forward();
    await until(() => view.getState().section === "repositories", "forward to repositories");
    expect(app.workspace.getLeavesOfType(GitHubProfileView.VIEW_TYPE)).toHaveLength(1);
  });

  it("re-targets one profile leaf across logins and records history", async () => {
    const app = await createApp();
    await openProfile(app, "acme-corp");
    await until(
      () =>
        profile(app).contentEl.querySelector(".github-profile-login")?.textContent === "acme-corp",
      "org profile",
    );
    await openProfile(app, "ada");
    await until(() => profile(app).getState().login === "ada", "user profile");
    expect(app.workspace.getLeavesOfType(GitHubProfileView.VIEW_TYPE)).toHaveLength(1);
    const leaf = app.workspace.getLeavesOfType(GitHubProfileView.VIEW_TYPE)[0];
    leaf.history.back();
    await until(() => profile(app).getState().login === "acme-corp", "back to the org");
  });

  it("filters the repositories list locally", async () => {
    const app = await createApp();
    await openProfile(app, "acme-corp", "repositories");
    const view = profile(app);
    await until(
      () => view.contentEl.querySelectorAll(".github-row").length === ORG_REPOS.length,
      "repo rows",
    );
    const input = view.contentEl.querySelector(".github-controls input") as HTMLInputElement;
    input.value = "secrets";
    input.dispatchEvent(new Event("input"));
    await until(() => view.contentEl.querySelectorAll(".github-row").length === 1, "filtered rows");
    expect(view.contentEl.querySelector(".github-row .tree-item-inner-text")?.textContent).toBe(
      "secrets",
    );
  });
});
