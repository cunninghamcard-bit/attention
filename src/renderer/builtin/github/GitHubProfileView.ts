import { createDiv, createEl, createSpan } from "../../dom/dom";
import { setIcon } from "../../ui/Icon";
import { setTooltip } from "../../ui/Popover";
import { Menu } from "../../ui/Menu";
import { SearchComponent } from "../../ui/Setting";
import { ItemView } from "../../views/ItemView";
import type { ViewStateResult } from "../../views/View";
import { Keymap } from "../../app/hotkeys/Keymap";
import { GITHUB_VIEW, openOrg, openRepo } from "./open";
import type { GithubRepoListItem } from "./GitHubService";
import type {
  ContributionCalendar,
  GitHubActor,
  GitHubProfile,
  GitHubProfileOverview,
  RepositoryCard,
} from "./types";
import { avatar, errorText, treeRow } from "./widgets";

/** The profile tab's sub-views — the OMG profile sections, mapped to the
 * view-header segmented control (owner's call: never an in-page nav column).
 * Which of them exist depends on the account: the GraphQL `Organization` type
 * has no contributions, stars or followers (schema fact, not a choice), so an
 * org offers Overview | Repositories | Sponsors only. */
type ProfileSection = "overview" | "repositories" | "stars" | "followers" | "sponsors";

const SECTIONS: { id: ProfileSection; label: string; icon: string; userOnly?: boolean }[] = [
  { id: "overview", label: "Overview", icon: "lucide-book-open" },
  { id: "repositories", label: "Repositories", icon: "lucide-library" },
  { id: "stars", label: "Stars", icon: "lucide-star", userOnly: true },
  { id: "followers", label: "Followers", icon: "lucide-users", userOnly: true },
  { id: "sponsors", label: "Sponsors", icon: "lucide-heart" },
];

/** Overview shows the top of the list; the full list lives one segment over. */
const OVERVIEW_REPO_LIMIT = 6;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * The org / user profile center tab (spec 7d13216). Identity head with the
 * account's counts, a header-segmented sub-view switch, and an Overview of
 * Pinned → contribution heatmap (year switch) → stat tiles. Repository rows
 * are the only door into a `github-repo` tab; a follower row re-targets this
 * same leaf at that person.
 */
export class GitHubProfileView extends ItemView {
  static readonly VIEW_TYPE = GITHUB_VIEW.profile;

  /** A navigable center destination: `recordHistory` ignores views that do not
   * declare this, so it is required alongside `result.history` for back/forward. */
  navigation = true;

  private login = "";
  private section: ProfileSection = "overview";
  private request = 0;
  private query = "";
  /** The heatmap's selected year; null = the calendar's default (current). */
  private year: number | null = null;
  private profile: GitHubProfile | null = null;

  private headEl: HTMLElement | null = null;
  private bodyEl: HTMLElement | null = null;
  private segmentedEl: HTMLElement | null = null;
  private segButtons = new Map<ProfileSection, HTMLElement>();

  getViewType(): string {
    return GitHubProfileView.VIEW_TYPE;
  }

  getDisplayText(): string {
    return this.login || "Profile";
  }

  getIcon(): string {
    return "lucide-circle-user";
  }

  async onOpen(): Promise<void> {
    this.contentEl.classList.add("github-profile-view");
  }

  async setState(state: unknown, result?: ViewStateResult): Promise<void> {
    await super.setState(state, result);
    if (!state || typeof state !== "object") return;
    const previousLogin = this.login;
    const previousSection = this.section;
    const next = state as { login?: string; section?: ProfileSection };
    if (typeof next.login === "string") this.login = next.login.trim();
    if (SECTIONS.some((section) => section.id === next.section))
      this.section = next.section as ProfileSection;
    // Re-targeting the leaf at another profile — or another sub-view — is a
    // navigation step, not a display mode: both feed native back/forward
    // (the FileView pattern every GitHub center view follows).
    if (result && (this.login !== previousLogin || this.section !== previousSection))
      result.history = true;
    if (this.login !== previousLogin) {
      this.query = "";
      this.year = null;
      this.profile = null;
    }
    // The nav's Organizations section highlights by org login; a profile tab
    // is that entry surfaced into the center.
    if (this.login) this.app.github.session.setTarget({ kind: "org", org: this.login });
    this.build();
    this.leaf.updateHeader();
  }

  getState(): Record<string, unknown> {
    return { login: this.login, section: this.section };
  }

  async onClose(): Promise<void> {
    this.request += 1;
    await super.onClose();
  }

  /** Manual reload entry (`github:refresh`) — the header has no button. */
  refresh(): void {
    this.build();
  }

  private build(): void {
    this.contentEl.empty();
    this.buildHeader();
    this.headEl = createDiv("github-profile-head", this.contentEl);
    this.bodyEl = createDiv("github-profile-body", this.contentEl);
    void this.render();
  }

  /** Sub-views switch from the tab's real `view-header`; `addAction()` only
   * makes icon buttons, so the segmented control attaches to headerEl directly
   * (the GitHubRepoView pattern). */
  private buildHeader(): void {
    this.segmentedEl?.remove();
    const nav = createDiv("github-segmented-control github-profile-nav");
    this.segButtons.clear();
    for (const section of this.sections()) {
      // clickable-icon: the host's icon-button language, and the only way out
      // of the global `button:not(.clickable-icon)` form-control chrome.
      const button = createEl(
        "button",
        {
          cls: `clickable-icon github-segmented-control-item${
            this.section === section.id ? " is-active" : ""
          }`,
          attr: { type: "button", "aria-label": section.label },
        },
        nav,
      );
      setIcon(button, section.icon);
      setTooltip(button, section.label);
      button.addEventListener("click", () => this.setSection(section.id));
      this.segButtons.set(section.id, button);
    }
    this.headerEl.insertBefore(nav, this.actionsEl);
    this.segmentedEl = nav;
  }

  /** Which sub-views this account has. Until the profile arrives we can't know
   * the account kind, so offer the user set; an org's fetch rebuilds the
   * header without the user-only entries. */
  private sections(): { id: ProfileSection; label: string; icon: string }[] {
    if (this.profile?.isOrganization) return SECTIONS.filter((section) => !section.userOnly);
    return SECTIONS;
  }

  /** Through `setViewState` on *this* leaf so the switch records history and
   * re-enters via the one entry point open, back and forward share. */
  private setSection(section: ProfileSection): void {
    if (this.section === section) return;
    void this.leaf.setViewState({
      type: GitHubProfileView.VIEW_TYPE,
      active: true,
      state: { login: this.login, section },
    });
  }

  private async render(): Promise<void> {
    if (!this.headEl || !this.bodyEl || !this.login) return;
    const request = ++this.request;
    this.renderHead();
    createDiv({ cls: "github-empty", text: "Loading profile…" }, this.bodyEl);
    // The REST profile decides everything downstream (org accounts have no
    // heatmap/stars/followers), so it loads first; without it there is no
    // page to render, so its failure is the page's error state.
    try {
      const profile = await this.app.github.getProfile(this.login);
      if (request !== this.request) return;
      this.profile = profile;
      if (profile.isOrganization && this.sectionIsUserOnly(this.section)) {
        this.section = "overview";
      }
      this.buildHeader();
      this.leaf.updateHeader();
    } catch (error) {
      if (request !== this.request) return;
      this.bodyEl.empty();
      createDiv({ cls: "github-error", text: errorText(error) }, this.bodyEl);
      return;
    }
    this.renderHead();
    this.bodyEl.empty();
    switch (this.section) {
      case "overview":
        return void this.renderOverview(request);
      case "repositories":
        return void this.renderRepositories(request);
      case "stars":
        return void this.renderStars(request);
      case "followers":
        return void this.renderFollowers(request);
      case "sponsors":
        return void this.renderSponsors();
    }
  }

  private sectionIsUserOnly(section: ProfileSection): boolean {
    return Boolean(SECTIONS.find((entry) => entry.id === section)?.userOnly);
  }

  // --- Identity head ---------------------------------------------------------

  private renderHead(): void {
    if (!this.headEl) return;
    this.headEl.empty();
    const profile = this.profile;
    // github.com/{login}.png resolves for users and orgs alike — a stable
    // avatar before (or without) the profile fetch.
    avatar(
      this.headEl,
      this.login,
      profile?.avatarUrl || `https://github.com/${this.login}.png`,
      48,
    );
    const idEl = createDiv("github-profile-identity", this.headEl);
    createEl("h2", { cls: "github-profile-login", text: profile?.name || this.login }, idEl);
    if (profile?.name) createDiv({ cls: "github-profile-handle", text: `@${this.login}` }, idEl);
    if (profile?.bio) createDiv({ cls: "github-profile-subtitle", text: profile.bio }, idEl);
    if (profile) {
      const facts = createDiv("github-profile-facts", idEl);
      this.fact(facts, "lucide-users", `${profile.followers} followers`);
      if (!profile.isOrganization)
        this.fact(facts, "lucide-user-plus", `${profile.following} following`);
      this.fact(facts, "lucide-book-marked", `${profile.publicRepos} public repositories`);
      if (!profile.isOrganization)
        this.fact(facts, "lucide-file-code", `${profile.publicGists} public gists`);
      this.fact(
        facts,
        "lucide-clock",
        `Joined ${new Date(profile.createdAt).toLocaleDateString()}`,
      );
    }
  }

  private fact(parent: HTMLElement, icon: string, text: string): void {
    const el = createSpan("github-profile-fact", parent);
    const iconEl = createSpan("github-profile-fact-icon", el);
    setIcon(iconEl, icon);
    createSpan({ text }, el);
  }

  // --- Overview ------------------------------------------------------------

  private async renderOverview(request: number): Promise<void> {
    const root = createDiv("github-profile-overview", this.bodyEl!);
    const pinnedEl = createDiv("github-profile-block", root);
    const heatEl = this.profile?.isOrganization ? null : createDiv("github-profile-block", root);
    // One GraphQL round trip feeds both blocks (pinned + the year list), but
    // each block still fails alone: an overview rejection degrades Pinned to
    // its error state while the heatmap loads from its own call.
    let overview: GitHubProfileOverview | null = null;
    let overviewError: unknown = null;
    createEl("h3", { cls: "github-profile-heading", text: "Pinned repositories" }, pinnedEl);
    const body = createDiv("github-profile-pinned", pinnedEl);
    createDiv({ cls: "github-empty", text: "Loading…" }, body);
    try {
      overview = await this.app.github.getProfileOverview(this.login);
    } catch (error) {
      overviewError = error;
    }
    if (request !== this.request) return;
    body.empty();
    if (overviewError) {
      createDiv({ cls: "github-error", text: errorText(overviewError) }, body);
    } else if (!overview || !overview.pinned.length) {
      // The data layer answered and the answer is "none" — say so. Dressing
      // top repositories up as pins would contradict github.com itself.
      createDiv({ cls: "github-empty", text: "No pinned repositories yet." }, body);
    } else {
      for (const pinned of overview.pinned) this.repoCard(body, pinned);
    }
    if (heatEl) void this.renderContributions(heatEl, request, overview?.contributionYears ?? []);
  }

  /** One card for pinned and starred alike — one shape, one renderer
   * (RepositoryCard, types.ts). */
  private repoCard(parent: HTMLElement, repo: RepositoryCard): void {
    const card = createDiv("github-profile-pin", parent);
    card.setAttribute("role", "button");
    card.tabIndex = 0;
    const title = createDiv("github-profile-pin-title", card);
    setIcon(createSpan("github-profile-pin-icon", title), "lucide-book-marked");
    createSpan({ cls: "github-profile-pin-name", text: repo.repo }, title);
    if (repo.isPrivate) createSpan({ cls: "github-chip", text: "private" }, title);
    if (repo.description)
      createDiv({ cls: "github-profile-pin-desc", text: repo.description }, card);
    const meta = createDiv("github-profile-pin-meta", card);
    if (repo.language) {
      const lang = createSpan("github-profile-pin-lang", meta);
      // The dot keeps GitHub's hex — a language's identity (Rust orange), not
      // a theme decision. Starred cards have no colour (REST carries none), so
      // they carry no dot at all: name only, per the owner's v1 ruling.
      if (repo.languageColor) {
        const dot = createSpan("github-profile-lang-dot", lang);
        dot.style.setProperty("--lang-color", repo.languageColor);
      }
      createSpan({ text: repo.language }, lang);
    }
    if (repo.stars) this.fact(meta, "lucide-star", String(repo.stars));
    if (repo.forks) this.fact(meta, "lucide-git-fork", String(repo.forks));
    const open = (event: MouseEvent | KeyboardEvent): void =>
      void openRepo(this.app, repo.owner, repo.repo, "overview", Keymap.isModEvent(event));
    card.addEventListener("click", open);
    card.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      open(event);
    });
  }

  private async renderContributions(
    root: HTMLElement,
    request: number,
    years: number[],
  ): Promise<void> {
    const heading = createDiv("github-profile-heat-head", root);
    const title = createEl("h3", { cls: "github-profile-heading", text: "Contributions" }, heading);
    const body = createDiv("github-profile-heat", root);
    createDiv({ cls: "github-empty", text: "Loading contributions…" }, body);
    let calendar: ContributionCalendar;
    try {
      calendar = await this.app.github.getContributions(this.login, this.year ?? undefined);
    } catch (error) {
      if (request !== this.request) return;
      body.empty();
      // The degradation the spec pins: the graph fails, the page lives.
      createDiv({ cls: "github-error", text: errorText(error) }, body);
      return;
    }
    if (request !== this.request) return;
    title.textContent = `${calendar.totalContributions} contributions in ${calendar.year}`;
    if (calendar.restrictedContributions > 0)
      createDiv(
        {
          cls: "github-profile-heat-note",
          text: `${calendar.restrictedContributions} more in private repositories this token cannot see.`,
        },
        heading,
      );
    this.yearButton(heading, calendar, request, years);
    body.empty();
    this.renderHeatmap(body, calendar);
    this.renderStatTiles(root, calendar);
  }

  private yearButton(
    parent: HTMLElement,
    calendar: ContributionCalendar,
    request: number,
    // GraphQL's own contributionYears — the account's real range. Only when
    // the overview could not supply it does the current calendar stand in.
    overviewYears: number[],
  ): void {
    const years = overviewYears.length ? overviewYears : [calendar.year];
    const button = createEl(
      "button",
      {
        cls: "clickable-icon github-profile-year",
        text: String(calendar.year),
        attr: { type: "button", "aria-label": "Pick a year" },
      },
      parent,
    );
    setTooltip(button, "Pick a year");
    button.addEventListener("click", (event) => {
      const menu = new Menu(this.contentEl.ownerDocument);
      for (const year of years) {
        menu.addItem((item) =>
          item
            .setTitle(String(year))
            .setChecked(year === calendar.year)
            .onClick(() => {
              if (year === calendar.year) return;
              this.year = year;
              // Year is a display range, not a navigation target — redraw the
              // section without minting a history entry.
              if (request === this.request) this.build();
            }),
        );
      }
      menu.showAtMouseEvent(event);
    });
  }

  /** One cell per day, one column per week — a sequential single-hue scale
   * (magnitude is the only encoded job), stepped by the server's own
   * five-level quartiles and painted in host theme variables. */
  private renderHeatmap(root: HTMLElement, calendar: ContributionCalendar): void {
    const scroll = createDiv("github-profile-heat-scroll", root);
    const grid = createDiv("github-profile-heat-grid", scroll);
    const monthsRow = createDiv("github-profile-heat-months", grid);
    createSpan("github-profile-heat-gutter", monthsRow);
    let lastMonth = -1;
    const monthCells: { label: string; span: number }[] = [];
    for (const week of calendar.weeks) {
      const month = new Date(week.firstDay).getMonth();
      if (month !== lastMonth) {
        monthCells.push({ label: MONTHS[month] ?? "", span: 1 });
        lastMonth = month;
      } else {
        monthCells[monthCells.length - 1].span += 1;
      }
    }
    for (const cell of monthCells) {
      const el = createSpan({ cls: "github-profile-heat-month", text: cell.label }, monthsRow);
      el.style.setProperty("--week-span", String(cell.span));
    }
    const rows = createDiv("github-profile-heat-rows", grid);
    const labels = createDiv("github-profile-heat-days", rows);
    for (const day of DAY_LABELS)
      createSpan({ cls: "github-profile-heat-day-label", text: day }, labels);
    const weeksEl = createDiv("github-profile-heat-weeks", rows);
    for (const week of calendar.weeks) {
      const col = createDiv("github-profile-heat-week", weeksEl);
      for (const day of week.days) {
        const cell = createSpan(`github-profile-heat-cell mod-level-${day.level}`, col);
        // The hover layer: every mark answers with its datum.
        setTooltip(cell, `${day.count} contribution${day.count === 1 ? "" : "s"} on ${day.date}`);
      }
    }
    const legend = createDiv("github-profile-heat-legend", root);
    createSpan({ cls: "github-profile-heat-legend-text", text: "Less" }, legend);
    for (const level of [0, 1, 2, 3, 4])
      createSpan(`github-profile-heat-cell mod-level-${level}`, legend);
    createSpan({ cls: "github-profile-heat-legend-text", text: "More" }, legend);
  }

  private renderStatTiles(root: HTMLElement, calendar: ContributionCalendar): void {
    const tiles = createDiv("github-profile-tiles", root);
    this.tile(tiles, "lucide-git-commit", "Commits", calendar.stats.commits);
    this.tile(tiles, "lucide-git-pull-request", "Pull requests", calendar.stats.pullRequests);
    this.tile(tiles, "lucide-eye", "Code review", calendar.stats.codeReviews);
    this.tile(tiles, "lucide-circle-dot", "Issues", calendar.stats.issues);
  }

  private tile(parent: HTMLElement, icon: string, label: string, value: number): void {
    const tile = createDiv("github-profile-tile", parent);
    const head = createDiv("github-profile-tile-label", tile);
    setIcon(createSpan("github-profile-tile-icon", head), icon);
    createSpan({ text: label }, head);
    createDiv({ cls: "github-profile-tile-value", text: String(value) }, tile);
  }

  // --- Repositories ----------------------------------------------------------

  private async fetchRepositories(): Promise<GithubRepoListItem[]> {
    const auth = await this.app.github.getAuth();
    if (this.login === auth.login) return this.app.github.listUserRepositories();
    return this.app.github.listOrgRepositories(this.login);
  }

  private async renderRepositories(request: number): Promise<void> {
    createDiv({ cls: "github-empty", text: "Loading repositories…" }, this.bodyEl!);
    let repos: GithubRepoListItem[];
    try {
      repos = await this.fetchRepositories();
    } catch (error) {
      if (request !== this.request) return;
      this.bodyEl!.empty();
      createDiv({ cls: "github-error", text: errorText(error) }, this.bodyEl!);
      return;
    }
    if (request !== this.request) return;
    this.bodyEl!.empty();
    const controls = createDiv("github-controls", this.bodyEl!);
    const search = new SearchComponent(controls)
      .setPlaceholder("Filter repositories…")
      .setValue(this.query);
    search.inputEl.setAttribute("aria-label", "Filter repositories");
    const list = createDiv("github-list", this.bodyEl!);
    const draw = (): void => {
      list.empty();
      const q = this.query.trim().toLowerCase();
      const matched = repos.filter(
        (repo) =>
          !q ||
          repo.repo.toLowerCase().includes(q) ||
          repo.fullName.toLowerCase().includes(q) ||
          repo.description.toLowerCase().includes(q),
      );
      if (!matched.length) {
        createDiv({ cls: "github-empty", text: "No repositories match." }, list);
        return;
      }
      for (const repo of matched) this.repoRow(list, repo);
    };
    search.onChange((value) => {
      this.query = value;
      draw();
    });
    draw();
  }

  /** The only door into a `github-repo` tab, by contract. */
  private repoRow(parent: HTMLElement, repo: GithubRepoListItem): void {
    const row = treeRow(parent, { cls: "github-profile-repo", key: `repo:${repo.fullName}` });
    setIcon(row.iconEl, "lucide-book-marked");
    const title = createSpan("github-row-title-line", row.innerEl);
    createSpan({ cls: "tree-item-inner-text", text: repo.repo }, title);
    if (repo.private) createSpan({ cls: "github-chip", text: "private" }, title);
    if (repo.description)
      createDiv({ cls: "tree-item-inner-subtext", text: repo.description }, row.innerEl);
    if (repo.openIssues) {
      const flair = createSpan("tree-item-flair-outer", row.selfEl);
      const issues = createSpan("tree-item-flair github-profile-issues", flair);
      setIcon(issues, "lucide-circle-dot");
      createSpan({ text: String(repo.openIssues) }, issues);
    }
    row.activate(
      (event) =>
        void openRepo(this.app, repo.owner, repo.repo, "overview", Keymap.isModEvent(event)),
    );
  }

  // --- Stars -----------------------------------------------------------------

  private async renderStars(request: number): Promise<void> {
    createDiv({ cls: "github-empty", text: "Loading stars…" }, this.bodyEl!);
    let starred: RepositoryCard[];
    try {
      starred = await this.app.github.listStarredRepositories(this.login);
    } catch (error) {
      if (request !== this.request) return;
      this.bodyEl!.empty();
      createDiv({ cls: "github-error", text: errorText(error) }, this.bodyEl!);
      return;
    }
    if (request !== this.request) return;
    this.bodyEl!.empty();
    if (!starred.length)
      return void createDiv(
        { cls: "github-empty", text: "No starred repositories." },
        this.bodyEl!,
      );
    // One card shape, one renderer — the pinned grid and the stars grid are
    // the same surface (starred cards just carry no language colour).
    const grid = createDiv("github-profile-pinned github-profile-stars", this.bodyEl!);
    for (const repo of starred) this.repoCard(grid, repo);
  }

  // --- Followers ---------------------------------------------------------------

  private async renderFollowers(request: number): Promise<void> {
    createDiv({ cls: "github-empty", text: "Loading followers…" }, this.bodyEl!);
    let followers: GitHubActor[];
    try {
      followers = await this.app.github.listFollowers(this.login);
    } catch (error) {
      if (request !== this.request) return;
      this.bodyEl!.empty();
      createDiv({ cls: "github-error", text: errorText(error) }, this.bodyEl!);
      return;
    }
    if (request !== this.request) return;
    this.bodyEl!.empty();
    if (!followers.length)
      return void createDiv({ cls: "github-empty", text: "No followers yet." }, this.bodyEl!);
    const list = createDiv("github-list", this.bodyEl!);
    for (const follower of followers) {
      const row = treeRow(list, { cls: "github-profile-follower", key: `user:${follower.login}` });
      avatar(row.iconEl, follower.login, follower.avatarUrl, 20);
      createSpan({ cls: "tree-item-inner-text", text: follower.login }, row.innerEl);
      // A follower is a profile: re-target this same leaf (or ⌘-fork a second
      // one) — back/forward walk the trail home.
      row.activate((event) => void openOrg(this.app, follower.login, Keymap.isModEvent(event)));
    }
  }

  // --- Sponsors ---------------------------------------------------------------

  private renderSponsors(): void {
    // GitHub's sponsors listing is GraphQL-only and unbuilt — an honest empty
    // state keeps the OMG section present without inventing data.
    createDiv({ cls: "github-empty", text: "No sponsor data yet." }, this.bodyEl!);
  }
}
