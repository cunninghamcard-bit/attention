import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "@web/app/App";
import { GitHubProfileView } from "@web/builtin/github/GitHubProfileView";
import { GitHubRepoView } from "@web/builtin/github/GitHubRepoView";
import { openOrg, refreshGitHub } from "@web/builtin/github/open";
import type { GithubRepoListItem } from "@web/builtin/github/GitHubService";
import type {
  ContributionCalendar,
  GitHubProfile,
  GitHubProfileOverview,
} from "@web/builtin/github/types";

// jsdom lacks ResizeObserver; the shared surfaces need it. Real desktop/web
// runtimes provide it natively.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
}

const USER_PROFILE: GitHubProfile = {
  login: "ada",
  name: "Ada Lovelace",
  avatarUrl: "https://example.test/ada.png",
  bio: "First programmer",
  isOrganization: false,
  followers: 12,
  following: 3,
  publicRepos: 18,
  publicGists: 2,
  createdAt: "2026-03-18T00:00:00Z",
  htmlUrl: "https://github.com/ada",
};

const ORG_PROFILE: GitHubProfile = {
  ...USER_PROFILE,
  login: "acme-corp",
  name: null,
  bio: "Acme",
  isOrganization: true,
  avatarUrl: "https://example.test/acme.png",
};

const OVERVIEW: GitHubProfileOverview = {
  profile: USER_PROFILE,
  pinned: [
    {
      owner: "ada",
      repo: "notes",
      nameWithOwner: "ada/notes",
      description: "Personal notes",
      language: "TypeScript",
      languageColor: "#3178c6",
      stars: 7,
      forks: 1,
      isPrivate: false,
      url: "https://github.com/ada/notes",
    },
    {
      owner: "ada",
      repo: "engine",
      nameWithOwner: "ada/engine",
      description: null,
      language: "Rust",
      languageColor: "#dea584",
      stars: 3,
      forks: 0,
      isPrivate: true,
      url: "https://github.com/ada/engine",
    },
  ],
  contributionYears: [2026, 2025],
};

const CALENDAR: ContributionCalendar = {
  year: 2026,
  totalContributions: 987,
  restrictedContributions: 5,
  weeks: [
    {
      firstDay: "2026-01-04",
      days: [
        { date: "2026-01-04", count: 0, level: 0 },
        { date: "2026-01-05", count: 2, level: 1 },
        { date: "2026-01-06", count: 5, level: 2 },
        { date: "2026-01-07", count: 9, level: 3 },
        { date: "2026-01-08", count: 20, level: 4 },
        { date: "2026-01-09", count: 0, level: 0 },
        { date: "2026-01-10", count: 1, level: 1 },
      ],
    },
    {
      firstDay: "2026-02-01",
      days: [{ date: "2026-02-01", count: 3, level: 2 }],
    },
  ],
  stats: { commits: 930, pullRequests: 18, codeReviews: 0, issues: 12 },
};

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

/** The data layer's methods do not exist on the service yet — the tests attach
 * them the way the merged GraphQL/REST branches will. */
function attachProfileSource(app: App): void {
  Object.assign(app.github, {
    getProfile: vi.fn(async (login: string) =>
      login === "acme-corp" ? ORG_PROFILE : { ...USER_PROFILE, login },
    ),
    getProfileOverview: vi.fn(async (login: string) =>
      login === "acme-corp"
        ? { ...OVERVIEW, profile: ORG_PROFILE, contributionYears: [] }
        : OVERVIEW,
    ),
    getContributions: vi.fn(async () => CALENDAR),
    listStarredRepositories: vi.fn(async () => [
      {
        owner: "octo",
        repo: "spoon-knife",
        nameWithOwner: "octo/spoon-knife",
        description: "Forkable",
        language: "HTML",
        // REST starred carries no language colour — the card renders no dot.
        languageColor: null,
        stars: 12000,
        forks: 100,
        isPrivate: false,
        url: "https://github.com/octo/spoon-knife",
      },
    ]),
    listFollowers: vi.fn(async () => [
      { login: "grace", avatarUrl: "https://example.test/grace.png", url: "" },
    ]),
  });
}

async function createApp(opts?: { dataLayer?: boolean }): Promise<App> {
  const root = document.createElement("div");
  document.body.appendChild(root);
  const app = new App(root);
  await app.ready;
  vi.spyOn(app.github, "getAuth").mockResolvedValue({
    hasToken: true,
    login: "ada",
    avatarUrl: "https://example.test/ada.png",
    name: "Ada",
  });
  vi.spyOn(app.github, "listUserRepositories").mockResolvedValue(ORG_REPOS);
  vi.spyOn(app.github, "listUserOrganizations").mockResolvedValue([
    { login: "acme-corp", avatarUrl: "", description: "Acme" },
  ]);
  vi.spyOn(app.github, "listOrgRepositories").mockResolvedValue(ORG_REPOS);
  if (opts?.dataLayer !== false) attachProfileSource(app);
  return app;
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

function segmentLabels(view: GitHubProfileView): (string | null)[] {
  return [...view.headerEl.querySelectorAll(".github-profile-nav button")].map((el) =>
    el.getAttribute("aria-label"),
  );
}

async function toSection(app: App, label: string): Promise<void> {
  const view = profile(app);
  await until(
    () =>
      view.headerEl.querySelector(`.github-segmented-control-item[aria-label="${label}"]`) !== null,
    `${label} segment`,
  );
  (
    view.headerEl.querySelector(
      `.github-segmented-control-item[aria-label="${label}"]`,
    ) as HTMLElement
  ).click();
  await until(() => view.getState().section === label.toLowerCase(), `${label} sub-view`);
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
  it("renders a user's identity head, five sub-views and the full overview", async () => {
    const app = await createApp();
    await openOrg(app, "ada");
    const view = profile(app);
    await until(
      () => view.contentEl.querySelector(".github-profile-login")?.textContent === "Ada Lovelace",
      "identity head",
    );
    expect(view.contentEl.querySelector(".github-profile-handle")?.textContent).toBe("@ada");
    const facts = view.contentEl.querySelector(".github-profile-facts")?.textContent ?? "";
    for (const fact of ["12 followers", "3 following", "18 public repositories", "2 public gists"])
      expect(facts).toContain(fact);
    expect(facts).toContain("Joined");
    // The user set: all five sections, flat icon segments in the real header.
    expect(segmentLabels(view)).toEqual([
      "Overview",
      "Repositories",
      "Stars",
      "Followers",
      "Sponsors",
    ]);
    for (const el of view.headerEl.querySelectorAll(".github-profile-nav button"))
      expect(el.classList.contains("clickable-icon")).toBe(true);
    // Overview: pinned cards → heatmap (with total headline) → four stat tiles.
    await until(
      () => view.contentEl.querySelectorAll(".github-profile-pin").length === 2,
      "pinned cards",
    );
    // Scoped to the week columns — the legend also renders every level, so an
    // unscoped selector would stay green with a flat-level bug.
    await until(
      () => view.contentEl.querySelectorAll(".github-profile-heat-week .mod-level-4").length > 0,
      "heatmap cells",
    );
    expect(view.contentEl.querySelectorAll(".github-profile-heat-week .mod-level-1")).toHaveLength(
      2,
    );
    expect(view.contentEl.textContent).toContain("987 contributions in 2026");
    expect(view.contentEl.textContent).toContain("5 more in private repositories");
    const tiles = [...view.contentEl.querySelectorAll(".github-profile-tile")];
    expect(tiles).toHaveLength(4);
    expect(tiles.map((tile) => tile.textContent)).toEqual([
      "Commits930",
      "Pull requests18",
      "Code review0",
      "Issues12",
    ]);
    expect(app.github.session.target).toMatchObject({ kind: "org", org: "ada" });
  });

  it("offers an organization only the sections its schema has", async () => {
    const app = await createApp();
    await openOrg(app, "acme-corp");
    const view = profile(app);
    // No Stars, no Followers, no heatmap — the GraphQL Organization type has
    // none of them (schema fact, not a choice).
    await until(() => segmentLabels(view).length === 3, "org sections");
    expect(segmentLabels(view)).toEqual(["Overview", "Repositories", "Sponsors"]);
    await until(
      () => view.contentEl.querySelectorAll(".github-profile-pin").length === 2,
      "org pinned",
    );
    expect(view.contentEl.querySelector(".github-profile-heat")).toBeNull();
    expect(view.contentEl.querySelectorAll(".github-profile-tile")).toHaveLength(0);
  });

  it("keeps the page alive when the contribution graph fails", async () => {
    const app = await createApp();
    (app.github as unknown as { getContributions: ReturnType<typeof vi.fn> }).getContributions =
      vi.fn(async () => {
        throw new Error("GraphQL unavailable");
      });
    await openOrg(app, "ada");
    const view = profile(app);
    // The graph degrades to its own error state…
    await until(
      () => view.contentEl.querySelector(".github-profile-heat .github-error") !== null,
      "heatmap error state",
    );
    // …while the rest of the page stands: head, segments and pinned intact.
    expect(view.contentEl.querySelector(".github-profile-login")?.textContent).toBe("Ada Lovelace");
    await until(
      () => view.contentEl.querySelectorAll(".github-profile-pin").length === 2,
      "pinned still renders",
    );
    expect(segmentLabels(view)).toHaveLength(5);
  });

  it("renders quiet placeholders while the data layer is not wired", async () => {
    const app = await createApp({ dataLayer: false });
    await openOrg(app, "ada");
    const view = profile(app);
    await until(
      () => view.contentEl.querySelectorAll(".github-profile-pending").length > 0,
      "placeholders",
    );
    // No profile fetch → the legacy head still identifies the account…
    expect(view.contentEl.querySelector(".github-profile-login")?.textContent).toBe("ada");
    // …and nothing crashed: the leaf is alive with its segments.
    expect(segmentLabels(view).length).toBeGreaterThanOrEqual(2);
  });

  it("lists starred repositories as cards and opens them as repo tabs", async () => {
    const app = await createApp();
    await openOrg(app, "ada");
    await toSection(app, "Stars");
    const view = profile(app);
    await until(
      () => view.contentEl.querySelector(".github-profile-stars .github-profile-pin") !== null,
      "star cards",
    );
    const card = view.contentEl.querySelector(
      ".github-profile-stars .github-profile-pin",
    ) as HTMLElement;
    expect(card.textContent).toContain("spoon-knife");
    expect(card.textContent).toContain("HTML");
    // No colour from REST → no dot at all (the owner's v1 ruling), while the
    // pinned grid's coloured cards keep theirs.
    expect(card.querySelector(".github-profile-lang-dot")).toBeNull();
    card.click();
    await until(
      () =>
        app.workspace.getLeavesOfType(GitHubRepoView.VIEW_TYPE)[0]?.view?.getState().owner ===
        "octo",
      "repo tab from a star",
    );
  });

  it("re-targets the same profile leaf from a follower row", async () => {
    const app = await createApp();
    await openOrg(app, "ada");
    await toSection(app, "Followers");
    const view = profile(app);
    await until(
      () => view.contentEl.querySelector(".github-profile-follower .github-row") !== null,
      "follower rows",
    );
    (view.contentEl.querySelector(".github-profile-follower .github-row") as HTMLElement).click();
    await until(() => profile(app).getState().login === "grace", "follower's profile");
    expect(app.workspace.getLeavesOfType(GitHubProfileView.VIEW_TYPE)).toHaveLength(1);
    // Back walks home — the follower hop was a navigation step.
    const leaf = app.workspace.getLeavesOfType(GitHubProfileView.VIEW_TYPE)[0];
    leaf.history.back();
    await until(() => profile(app).getState().login === "ada", "back to ada");
  });

  it("walks profile sub-view switches with the native back control", async () => {
    const app = await createApp();
    await openOrg(app, "ada");
    await toSection(app, "Repositories");
    const view = profile(app);
    const leaf = app.workspace.getLeavesOfType(GitHubProfileView.VIEW_TYPE)[0];
    leaf.history.back();
    await until(() => view.getState().section === "overview", "back to overview");
    leaf.history.forward();
    await until(() => view.getState().section === "repositories", "forward to repositories");
    expect(app.workspace.getLeavesOfType(GitHubProfileView.VIEW_TYPE)).toHaveLength(1);
  });

  it("opens a repo tab from the profile repositories", async () => {
    const app = await createApp();
    await openOrg(app, "acme-corp");
    await toSection(app, "Repositories");
    const view = profile(app);
    await until(() => view.contentEl.querySelector(".github-row") !== null, "repo rows");
    (view.contentEl.querySelector(".github-row") as HTMLElement).click();
    await until(
      () =>
        app.workspace.getLeavesOfType(GitHubRepoView.VIEW_TYPE)[0]?.view?.getState().owner ===
        "acme-corp",
      "repo tab",
    );
    expect(app.workspace.getLeavesOfType(GitHubProfileView.VIEW_TYPE)).toHaveLength(1);
  });

  it("filters the repositories list locally", async () => {
    const app = await createApp();
    await openOrg(app, "acme-corp");
    await toSection(app, "Repositories");
    const view = profile(app);
    await until(
      () => view.contentEl.querySelectorAll(".github-row").length === ORG_REPOS.length,
      "repo rows",
    );
    const input = view.contentEl.querySelector(".github-controls input") as HTMLInputElement;
    input.value = "secrets";
    input.dispatchEvent(new Event("input"));
    await until(() => view.contentEl.querySelectorAll(".github-row").length === 1, "filtered rows");
  });

  it("reloads the active profile through the manual refresh command", async () => {
    const app = await createApp();
    await openOrg(app, "ada");
    await until(
      () => profile(app).contentEl.querySelector(".github-profile-pin") !== null,
      "initial overview",
    );
    const fetches = (app.github as unknown as { getProfileOverview: ReturnType<typeof vi.fn> })
      .getProfileOverview;
    const before = fetches.mock.calls.length;
    refreshGitHub(app);
    await until(() => fetches.mock.calls.length > before, "refetch on refresh");
  });

  it("summons the search bar on the profile through the github:search command", async () => {
    const app = await createApp();
    await openOrg(app, "ada");
    const view = profile(app);
    await until(() => view.headerEl.querySelector(".github-profile-nav") !== null, "profile tab");
    app.commands.executeCommandById("github:search");
    await until(
      () => view.contentEl.querySelector(".document-search-input") !== null,
      "search bar on the profile leaf",
    );
  });

  it("keeps the profile nav inside the shared flat header selectors", () => {
    // jsdom does not compute styles, so lock the structure: the profile nav
    // must ride the same flat-header rules as the repo/list navs (never a
    // second copied rule set). The final visual word stays with the owner's
    // rebuilt-app check.
    const css = readFileSync(
      resolve(__dirname, "../../../../src/renderer/styles/product/github-nav.css"),
      "utf8",
    );
    expect(css).toContain(".view-header > .github-profile-nav");
    expect(css).toContain(".github-profile-nav .github-segmented-control-item");
    const profileCss = readFileSync(
      resolve(__dirname, "../../../../src/renderer/styles/product/github-profile.css"),
      "utf8",
    );
    expect(profileCss).not.toContain(".github-segmented-control");
    // The heatmap's five levels each have a themed step — none borrow
    // GitHub's raw light-mode hex.
    for (const level of [1, 2, 3, 4])
      expect(profileCss).toContain(`.github-profile-heat-cell.mod-level-${level}`);
  });
});
