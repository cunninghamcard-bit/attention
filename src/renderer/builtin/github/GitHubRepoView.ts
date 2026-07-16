import type { EventRef } from "../../core/Events";
import { createDiv, createEl, createSpan } from "../../dom/dom";
import { setIcon } from "../../ui/Icon";
import { setTooltip } from "../../ui/Popover";
import { Menu } from "../../ui/Menu";
import { Notice } from "../../ui/Notice";
import { SearchComponent } from "../../ui/Setting";
import { ItemView } from "../../views/ItemView";
import type { ViewStateResult } from "../../views/View";
import { formatRelativeDate } from "../git/relativeDate";
import { Keymap } from "../../app/hotkeys/Keymap";
import { GITHUB_VIEW, openCommitDetail, openGitHubDetail, openPrDetail } from "./open";
import { readGithubPrPrefs, writeGithubPrPrefs } from "./prefs";
import type { GitHubSelection, RepoSection } from "./session";
import type {
  ActionRunSummary,
  GitHubBranch,
  GitHubRepositoryRef,
  IssueSummary,
  PrListFilter,
  PrSummary,
  RepoContentItem,
} from "./types";
import { avatar, conclusionClass, errorText, formatSize, treeRow } from "./widgets";

const SECTIONS: { id: RepoSection; label: string; icon: string }[] = [
  { id: "overview", label: "Overview", icon: "lucide-book-open" },
  { id: "pulls", label: "Pull requests", icon: "lucide-git-pull-request" },
  { id: "commits", label: "Commits", icon: "lucide-git-commit" },
  { id: "branches", label: "Branches", icon: "lucide-git-branch" },
  { id: "issues", label: "Issues", icon: "lucide-circle-dot" },
  { id: "actions", label: "Actions", icon: "lucide-play" },
  { id: "files", label: "Files", icon: "lucide-folder" },
];

const PR_FILTERS: { id: PrListFilter; label: string }[] = [
  { id: "open", label: "Open" },
  { id: "mine", label: "Mine" },
  { id: "review-requested", label: "Review requested" },
  { id: "all", label: "All" },
];

/**
 * A single repository as a center tab (model B): the tab's real view-header
 * owns an icon sub-view switcher (Overview / Pull requests / Commits /
 * Branches / Issues / Actions / Files). Each sub-view is a navigation target,
 * not a display mode: switching goes through `setViewState`, so it records
 * history and the native back/forward walk it. Drilling into a PR / commit /
 * file opens a separate detail tab. Never a nested sidebar.
 */
export class GitHubRepoView extends ItemView {
  static readonly VIEW_TYPE = GITHUB_VIEW.repo;

  /** A navigable center destination: `recordHistory` ignores views that do not
   * declare this, so it is required alongside `result.history` for back/forward. */
  navigation = true;

  private owner = "";
  private repoName = "";
  private section: RepoSection = "overview";
  private request = 0;
  private selectionRef: EventRef | null = null;

  // Per-section state.
  private prFilter: PrListFilter = "open";
  private commitRef = "";
  private commitPage = 1;
  private issueState: "open" | "closed" | "all" = "open";
  private filesRef = "";
  private filesPath = "";
  private query = "";

  private bodyEl: HTMLElement | null = null;
  private segmentedEl: HTMLElement | null = null;
  private segButtons = new Map<RepoSection, HTMLElement>();

  getViewType(): string {
    return GitHubRepoView.VIEW_TYPE;
  }

  getDisplayText(): string {
    return this.owner && this.repoName ? `${this.owner}/${this.repoName}` : "Repository";
  }

  getIcon(): string {
    return "lucide-book-marked";
  }

  async onOpen(): Promise<void> {
    this.contentEl.classList.add("github-repo-view");
    this.selectionRef = this.app.github.session.on<[GitHubSelection]>("selection-change", (s) =>
      this.markSelected(s),
    );
  }

  async setState(state: unknown, result?: ViewStateResult): Promise<void> {
    await super.setState(state, result);
    if (!state || typeof state !== "object") return;
    const previousRepo = `${this.owner}/${this.repoName}`;
    const previousSection = this.section;
    const next = state as {
      owner?: string;
      repo?: string;
      section?: RepoSection;
    };
    if (typeof next.owner === "string") this.owner = next.owner;
    if (typeof next.repo === "string") this.repoName = next.repo;
    if (typeof next.section === "string") this.section = next.section;
    // Re-targeting this leaf at another repo records history (the FileView
    // pattern), so back returns to the repo you came from.
    const changedRepo = `${this.owner}/${this.repoName}` !== previousRepo;
    // Overview → Commits is a different destination, not a display mode, so a
    // sub-view switch feeds back/forward exactly like changing repository does.
    if (result && (changedRepo || this.section !== previousSection)) result.history = true;
    // Every per-section cursor below is scoped to one repository. This leaf is
    // reused across repos, so carrying them over would query the new repo with
    // the old repo's ref / path / page — wrong data, not just a stale view.
    if (changedRepo) this.resetRepoScopedState();
    this.query = "";
    if (this.owner && this.repoName)
      this.app.github.setRepository({ owner: this.owner, repo: this.repoName });
    this.app.github.session.setTarget({
      kind: "repo",
      owner: this.owner,
      repo: this.repoName,
      section: this.section,
    });
    this.build();
    this.leaf.updateHeader();
  }

  private resetRepoScopedState(): void {
    this.prFilter = "open";
    this.commitRef = "";
    this.commitPage = 1;
    this.issueState = "open";
    this.filesRef = "";
    this.filesPath = "";
  }

  getState(): Record<string, unknown> {
    return { owner: this.owner, repo: this.repoName, section: this.section };
  }

  async onClose(): Promise<void> {
    this.request += 1;
    if (this.selectionRef) this.app.github.session.offref(this.selectionRef);
    this.selectionRef = null;
    await super.onClose();
  }

  /** Manual reload entry (`github:refresh`) — the header has no button. */
  refresh(): void {
    this.renderSection();
  }

  private repo(): GitHubRepositoryRef {
    return { owner: this.owner, repo: this.repoName, host: "github.com" };
  }

  private build(): void {
    this.contentEl.empty();
    this.buildHeader();
    this.bodyEl = createDiv("github-repo-body", this.contentEl);
    this.renderSection();
  }

  /** Sub-views switch from the tab's real `view-header` — the title and
   * back/forward already come from ItemView. `addAction()` only makes icon
   * buttons, so the segmented control attaches to headerEl directly. */
  private buildHeader(): void {
    this.segmentedEl?.remove();
    const nav = createDiv("github-segmented-control github-repo-nav");
    this.segButtons.clear();
    for (const section of SECTIONS) {
      // clickable-icon: the host's icon-button language, and the only way out of
      // the global `button:not(.clickable-icon)` form-control chrome.
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

  /** Sub-views are navigation targets, not a mode toggle: the switch goes back
   * through `setViewState` so it records history and syncs the session from the
   * one entry point that open, back and forward all share.
   *
   * Straight to *this* leaf — the global opener reuses the first leaf of the
   * type, which would drive someone else's tab when a second one is open. */
  private setSection(section: RepoSection): void {
    if (this.section === section) return;
    void this.leaf.setViewState({
      type: GITHUB_VIEW.repo,
      active: true,
      state: { owner: this.owner, repo: this.repoName, section },
    });
  }

  private renderSection(): void {
    if (!this.bodyEl) return;
    this.bodyEl.empty();
    const repo = this.repo();
    switch (this.section) {
      case "overview":
        return void this.renderOverview(repo);
      case "pulls":
        return void this.renderPulls(repo);
      case "commits":
        return void this.renderCommits(repo);
      case "branches":
        return void this.renderBranches(repo);
      case "issues":
        return void this.renderIssues(repo);
      case "actions":
        return void this.renderActions(repo);
      case "files":
        return void this.renderFiles(repo);
    }
  }

  private list(): HTMLElement {
    return createDiv("github-list", this.bodyEl!);
  }

  private controls(): HTMLElement {
    return createDiv("github-controls", this.bodyEl!);
  }

  private empty(parent: HTMLElement, text: string): void {
    createDiv({ cls: "github-empty", text }, parent);
  }

  private fail(parent: HTMLElement, error: unknown): void {
    createDiv({ cls: "github-error", text: errorText(error) }, parent);
  }

  // --- Overview ------------------------------------------------------------

  private async renderOverview(repo: GitHubRepositoryRef): Promise<void> {
    const request = ++this.request;
    const root = createDiv("github-overview", this.bodyEl!);
    const chips = createDiv("github-overview-chips", root);
    for (const target of ["pulls", "commits", "issues", "actions"] as const) {
      const chip = createEl(
        "button",
        {
          cls: "github-overview-chip",
          text: labelOf(target),
          attr: { type: "button" },
        },
        chips,
      );
      chip.addEventListener("click", () => this.setSection(target));
    }
    const recent = createDiv("github-overview-recent", root);
    createEl("h3", { text: "Recent commits" }, recent);
    const list = createDiv("github-list", recent);
    this.empty(list, "Loading…");
    try {
      const branch = this.commitRef || (await this.app.github.getDefaultBranch(repo));
      const data = await this.app.github.listCommits({ ref: branch, page: 1, perPage: 8 }, repo);
      if (request !== this.request) return;
      list.empty();
      if (!data.items.length) return this.empty(list, "No commits.");
      for (const commit of data.items) this.commitRow(list, commit, repo);
    } catch (error) {
      if (request !== this.request) return;
      list.empty();
      this.fail(list, error);
    }
  }

  // --- Pull requests -------------------------------------------------------

  private async renderPulls(repo: GitHubRepositoryRef): Promise<void> {
    const request = ++this.request;
    const controls = this.controls();
    const filterButton = createEl(
      "button",
      { cls: "github-filter", attr: { type: "button" } },
      controls,
    );
    filterButton.textContent = PR_FILTERS.find((f) => f.id === this.prFilter)?.label ?? "Open";
    setIcon(createSpan("github-filter-caret", filterButton), "lucide-chevron-down");
    filterButton.addEventListener("click", (event) => this.showPrFilterMenu(event));
    const search = new SearchComponent(controls)
      .setPlaceholder("Filter pull requests…")
      .setValue(this.query);
    search.inputEl.setAttribute("aria-label", "Filter pull requests");
    const list = this.list();
    this.empty(list, "Loading pull requests…");
    let prs: PrSummary[];
    try {
      prs = await this.app.github.listPullRequests(this.prFilter, repo);
    } catch (error) {
      if (request !== this.request) return;
      list.empty();
      return this.fail(list, error);
    }
    if (request !== this.request) return;
    const draw = (): void => {
      list.empty();
      const q = this.query.trim().toLowerCase();
      const matched = prs.filter(
        (pr) =>
          !q ||
          pr.title.toLowerCase().includes(q) ||
          String(pr.number).includes(q) ||
          pr.author.login.toLowerCase().includes(q) ||
          pr.headRefName.toLowerCase().includes(q),
      );
      if (!matched.length) return this.empty(list, "No pull requests match.");
      for (const pr of matched) this.prRow(list, pr, repo);
    };
    search.onChange((value) => {
      this.query = value;
      draw();
    });
    draw();
  }

  private prRow(parent: HTMLElement, pr: PrSummary, repo: GitHubRepositoryRef): void {
    const row = treeRow(parent, {
      cls: "github-pr",
      key: `pr:${pr.number}`,
      active: this.isSelected(`pr:${pr.number}`),
    });
    avatar(row.iconEl, pr.author.login, pr.author.avatarUrl, 20);
    const title = createSpan("github-row-title-line", row.innerEl);
    createSpan({ cls: "tree-item-inner-text", text: pr.title }, title);
    createSpan({ cls: "github-row-number", text: `#${pr.number}` }, title);
    for (const label of pr.labels.slice(0, 3)) {
      const chip = createSpan({ cls: "github-label", text: label.name }, title);
      chip.style.setProperty("--label-color", `#${label.color}`);
    }
    createDiv(
      {
        cls: "tree-item-inner-subtext",
        text: `${pr.author.login} · ${pr.headRefName} → ${pr.baseRefName} · ${formatRelativeDate(pr.updatedAt)}`,
      },
      row.innerEl,
    );
    const flair = createSpan("tree-item-flair-outer", row.selfEl);
    const state = createSpan(
      `tree-item-flair github-pr-state mod-${pr.isDraft ? "draft" : pr.state}`,
      flair,
    );
    setIcon(state, "lucide-git-pull-request");
    if (pr.ciState) createSpan(`github-ci-dot mod-${pr.ciState}`, flair);
    if (pr.additions || pr.deletions) {
      const stat = createSpan("tree-item-flair github-diffstat", flair);
      createEl("ins", { text: `+${pr.additions}` }, stat);
      createEl("del", { text: `−${pr.deletions}` }, stat);
    }
    row.activate(
      (event) =>
        void openPrDetail(this.app, repo.owner, repo.repo, pr.number, Keymap.isModEvent(event)),
    );
  }

  private showPrFilterMenu(event: MouseEvent): void {
    const menu = new Menu(this.contentEl.ownerDocument);
    for (const filter of PR_FILTERS) {
      menu.addItem((item) =>
        item
          .setTitle(filter.label)
          .setChecked(filter.id === this.prFilter)
          .onClick(() => {
            if (filter.id === this.prFilter) return;
            this.prFilter = filter.id;
            writeGithubPrPrefs({ filter: filter.id });
            this.renderSection();
          }),
      );
    }
    menu.showAtMouseEvent(event);
  }

  // --- Commits -------------------------------------------------------------

  private async renderCommits(repo: GitHubRepositoryRef): Promise<void> {
    const request = ++this.request;
    const controls = this.controls();
    const select = createEl(
      "select",
      {
        cls: "dropdown github-branch-select",
        attr: { "aria-label": "Branch" },
      },
      controls,
    );
    const list = this.list();
    this.empty(list, "Loading commits…");
    try {
      const [branches, defaultBranch] = await Promise.all([
        this.app.github.listBranches(repo),
        this.app.github.getDefaultBranch(repo),
      ]);
      if (request !== this.request) return;
      const preferred = this.commitRef || readGithubPrPrefs().lastBranch;
      this.commitRef =
        preferred && branches.some((b) => b.name === preferred) ? preferred : defaultBranch;
      for (const branch of branches)
        createEl("option", { value: branch.name, text: branch.name }, select);
      select.value = this.commitRef;
      select.addEventListener("change", () => {
        this.commitRef = select.value;
        this.commitPage = 1;
        writeGithubPrPrefs({ lastBranch: this.commitRef });
        this.renderSection();
      });
      const data = await this.app.github.listCommits(
        { ref: this.commitRef, page: this.commitPage, perPage: 30 },
        repo,
      );
      if (request !== this.request) return;
      list.empty();
      if (!data.items.length) return this.empty(list, "No commits on this branch.");
      for (const commit of data.items) this.commitRow(list, commit, repo);
      if (data.hasNextPage || data.hasPreviousPage) this.renderPager(list, data);
    } catch (error) {
      if (request !== this.request) return;
      list.empty();
      this.fail(list, error);
    }
  }

  private commitRow(
    parent: HTMLElement,
    commit: {
      sha: string;
      shortSha: string;
      headline: string;
      author: { login: string; avatarUrl: string };
      committedDate: string;
    },
    repo: GitHubRepositoryRef,
  ): void {
    const row = treeRow(parent, {
      cls: "github-commit",
      key: `commit:${commit.sha}`,
      active: this.isSelected(`commit:${commit.sha}`),
    });
    avatar(row.iconEl, commit.author.login, commit.author.avatarUrl, 20);
    createDiv({ cls: "tree-item-inner-text", text: commit.headline }, row.innerEl);
    createDiv(
      {
        cls: "tree-item-inner-subtext",
        text: `${commit.author.login} · ${formatRelativeDate(commit.committedDate)}`,
      },
      row.innerEl,
    );
    const flair = createSpan("tree-item-flair-outer", row.selfEl);
    createSpan({ cls: "tree-item-flair github-sha", text: commit.shortSha }, flair);
    row.activate(
      (event) =>
        void openCommitDetail(
          this.app,
          repo.owner,
          repo.repo,
          commit.sha,
          Keymap.isModEvent(event),
        ),
    );
  }

  private renderPager(
    parent: HTMLElement,
    data: { hasNextPage: boolean; hasPreviousPage: boolean },
  ): void {
    const pager = createDiv("github-pager", parent);
    const prev = createEl(
      "button",
      { cls: "github-pager-button", text: "Previous", attr: { type: "button" } },
      pager,
    );
    prev.disabled = !data.hasPreviousPage;
    prev.addEventListener("click", () => {
      this.commitPage = Math.max(1, this.commitPage - 1);
      this.renderSection();
    });
    createSpan({ cls: "github-muted", text: `Page ${this.commitPage}` }, pager);
    const next = createEl(
      "button",
      { cls: "github-pager-button", text: "Next", attr: { type: "button" } },
      pager,
    );
    next.disabled = !data.hasNextPage;
    next.addEventListener("click", () => {
      this.commitPage += 1;
      this.renderSection();
    });
  }

  // --- Branches ------------------------------------------------------------

  private async renderBranches(repo: GitHubRepositoryRef): Promise<void> {
    const request = ++this.request;
    const controls = this.controls();
    const search = new SearchComponent(controls)
      .setPlaceholder("Filter branches…")
      .setValue(this.query);
    search.inputEl.setAttribute("aria-label", "Filter branches");
    const list = this.list();
    this.empty(list, "Loading branches…");
    try {
      const [branches, defaultBranch] = await Promise.all([
        this.app.github.listBranches(repo),
        this.app.github.getDefaultBranch(repo),
      ]);
      if (request !== this.request) return;
      const draw = (): void => {
        list.empty();
        const q = this.query.trim().toLowerCase();
        const matched = branches.filter((b) => !q || b.name.toLowerCase().includes(q));
        if (!matched.length) return this.empty(list, "No branches match.");
        for (const branch of matched) this.branchRow(list, branch, defaultBranch, repo);
      };
      search.onChange((value) => {
        this.query = value;
        draw();
      });
      draw();
    } catch (error) {
      if (request !== this.request) return;
      list.empty();
      this.fail(list, error);
    }
  }

  private branchRow(
    parent: HTMLElement,
    branch: GitHubBranch,
    defaultBranch: string,
    repo: GitHubRepositoryRef,
  ): void {
    const row = treeRow(parent, { cls: "github-branch" });
    setIcon(row.iconEl, "lucide-git-branch");
    const name = createSpan("github-branch-name tree-item-inner-text", row.innerEl);
    createSpan({ text: branch.name }, name);
    if (branch.name === defaultBranch) createSpan({ cls: "github-chip", text: "default" }, name);
    if (branch.protected) createSpan({ cls: "github-chip", text: "protected" }, name);
    createDiv(
      {
        cls: "tree-item-inner-subtext",
        text: branch.commitSha ? branch.commitSha.slice(0, 7) : "—",
      },
      row.innerEl,
    );
    if (branch.commitSha) {
      const flair = createSpan("tree-item-flair-outer", row.selfEl);
      const tip = createEl(
        "button",
        {
          cls: "clickable-icon",
          attr: { type: "button", "aria-label": "Open tip commit" },
        },
        flair,
      );
      setIcon(tip, "lucide-git-commit");
      tip.addEventListener("click", (event) => {
        event.stopPropagation();
        void openCommitDetail(
          this.app,
          repo.owner,
          repo.repo,
          branch.commitSha,
          Keymap.isModEvent(event),
        );
      });
    }
    row.activate(() => {
      this.commitRef = branch.name;
      this.commitPage = 1;
      writeGithubPrPrefs({ lastBranch: branch.name });
      this.setSection("commits");
    });
  }

  // --- Issues --------------------------------------------------------------

  private async renderIssues(repo: GitHubRepositoryRef): Promise<void> {
    const request = ++this.request;
    const controls = this.controls();
    const pills = createDiv("github-pills", controls);
    for (const state of ["open", "closed", "all"] as const) {
      const pill = createEl(
        "button",
        {
          cls: `github-pill${this.issueState === state ? " is-active" : ""}`,
          text: state,
          attr: { type: "button" },
        },
        pills,
      );
      pill.addEventListener("click", () => {
        if (this.issueState === state) return;
        this.issueState = state;
        this.renderSection();
      });
    }
    const search = new SearchComponent(controls)
      .setPlaceholder("Filter issues…")
      .setValue(this.query);
    search.inputEl.setAttribute("aria-label", "Filter issues");
    const list = this.list();
    this.empty(list, "Loading issues…");
    let issues: IssueSummary[];
    try {
      issues = await this.app.github.listIssues(this.issueState, repo);
    } catch (error) {
      if (request !== this.request) return;
      list.empty();
      return this.fail(list, error);
    }
    if (request !== this.request) return;
    const draw = (): void => {
      list.empty();
      const q = this.query.trim().toLowerCase();
      const matched = issues.filter(
        (issue) =>
          !q ||
          issue.title.toLowerCase().includes(q) ||
          String(issue.number).includes(q) ||
          issue.author.login.toLowerCase().includes(q),
      );
      if (!matched.length) return this.empty(list, "No issues match.");
      for (const issue of matched) {
        const row = treeRow(list, {
          cls: "github-issue",
          key: `issue:${issue.number}`,
          active: this.isSelected(`issue:${issue.number}`),
        });
        createSpan(`github-dot mod-${issue.state}`, row.iconEl);
        const title = createSpan("github-row-title-line", row.innerEl);
        createSpan({ cls: "tree-item-inner-text", text: issue.title }, title);
        createSpan({ cls: "github-row-number", text: `#${issue.number}` }, title);
        createDiv(
          {
            cls: "tree-item-inner-subtext",
            text: `${issue.author.login} · ${formatRelativeDate(issue.updatedAt)}${issue.comments ? ` · ${issue.comments} comments` : ""}`,
          },
          row.innerEl,
        );
        row.activate(
          (event) =>
            void openGitHubDetail(
              this.app,
              {
                kind: "issue",
                number: issue.number,
                owner: repo.owner,
                repo: repo.repo,
              },
              Keymap.isModEvent(event),
            ),
        );
      }
    };
    search.onChange((value) => {
      this.query = value;
      draw();
    });
    draw();
  }

  // --- Actions -------------------------------------------------------------

  private async renderActions(repo: GitHubRepositoryRef): Promise<void> {
    const request = ++this.request;
    const list = this.list();
    this.empty(list, "Loading workflow runs…");
    let runs: ActionRunSummary[];
    try {
      runs = await this.app.github.listWorkflowRuns(1, repo);
    } catch (error) {
      if (request !== this.request) return;
      list.empty();
      return this.fail(list, error);
    }
    if (request !== this.request) return;
    list.empty();
    if (!runs.length) return this.empty(list, "No workflow runs.");
    for (const run of runs) {
      const row = treeRow(list, {
        cls: "github-run",
        key: `run:${run.id}`,
        active: this.isSelected(`run:${run.id}`),
      });
      createSpan(`github-ci-dot mod-${conclusionClass(run.conclusion, run.status)}`, row.iconEl);
      createDiv({ cls: "tree-item-inner-text", text: run.displayTitle }, row.innerEl);
      createDiv(
        {
          cls: "tree-item-inner-subtext",
          text: `${run.name} · #${run.runNumber} · ${run.headBranch} · ${formatRelativeDate(run.updatedAt)}`,
        },
        row.innerEl,
      );
      row.activate(
        (event) =>
          void openGitHubDetail(
            this.app,
            { kind: "run", id: run.id, owner: repo.owner, repo: repo.repo },
            Keymap.isModEvent(event),
          ),
      );
    }
  }

  // --- Files ---------------------------------------------------------------

  private async renderFiles(repo: GitHubRepositoryRef): Promise<void> {
    const request = ++this.request;
    if (!this.filesRef) {
      try {
        this.filesRef = await this.app.github.getDefaultBranch(repo);
      } catch (error) {
        if (request !== this.request) return;
        return this.fail(this.list(), error);
      }
      if (request !== this.request) return;
    }
    const crumbs = createDiv("github-crumbs", this.bodyEl!);
    const rootCrumb = createEl(
      "button",
      { cls: "github-crumb", text: repo.repo, attr: { type: "button" } },
      crumbs,
    );
    rootCrumb.addEventListener("click", () => {
      this.filesPath = "";
      this.renderSection();
    });
    const parts = this.filesPath ? this.filesPath.split("/") : [];
    parts.forEach((part, index) => {
      createSpan({ cls: "github-muted", text: "/" }, crumbs);
      const crumb = createEl(
        "button",
        { cls: "github-crumb", text: part, attr: { type: "button" } },
        crumbs,
      );
      crumb.addEventListener("click", () => {
        this.filesPath = parts.slice(0, index + 1).join("/");
        this.renderSection();
      });
    });
    const list = this.list();
    this.empty(list, "Loading…");
    let items: RepoContentItem[];
    try {
      items = (await this.app.github.listContents(this.filesPath, this.filesRef, repo))
        .slice()
        .sort((a, b) =>
          a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1,
        );
    } catch (error) {
      if (request !== this.request) return;
      list.empty();
      return this.fail(list, error);
    }
    if (request !== this.request) return;
    list.empty();
    if (!items.length) return this.empty(list, "Empty directory.");
    for (const item of items) {
      const row = treeRow(list, {
        cls: "github-file",
        key: `file:${item.path}`,
      });
      setIcon(row.iconEl, item.type === "dir" ? "lucide-folder" : "lucide-file");
      createDiv({ cls: "tree-item-inner-text", text: item.name }, row.innerEl);
      if (item.type === "file") {
        const flair = createSpan("tree-item-flair-outer", row.selfEl);
        createSpan({ cls: "tree-item-flair github-muted", text: formatSize(item.size) }, flair);
      }
      row.activate((event) => {
        if (item.type === "dir") {
          this.filesPath = item.path;
          this.renderSection();
          return;
        }
        void openGitHubDetail(
          this.app,
          {
            kind: "file",
            path: item.path,
            ref: this.filesRef,
            owner: repo.owner,
            repo: repo.repo,
          },
          Keymap.isModEvent(event),
        );
      });
    }
  }

  // --- Selection sync ------------------------------------------------------

  private isSelected(key: string): boolean {
    return this.repoSelectionKey(this.app.github.session.selection) === key;
  }

  /** Rows here are keyed within one repository, but a deliberate second repo
   * tab may be open — another repo's #1 (or its README.md) must not light up
   * this one's. Every selection kind carries its repo, so check them all. */
  private repoSelectionKey(selection: GitHubSelection): string | null {
    if (!selection) return null;
    if (selection.owner !== this.owner || selection.repo !== this.repoName) return null;
    return selectionKey(selection);
  }

  private markSelected(selection: GitHubSelection): void {
    if (!this.bodyEl) return;
    for (const el of this.bodyEl.querySelectorAll(".github-row.is-active"))
      el.classList.remove("is-active");
    const key = this.repoSelectionKey(selection);
    if (!key) return;
    const escaped = key.replace(/["\\]/g, "\\$&");
    this.bodyEl.querySelector(`[data-key="${escaped}"]`)?.classList.add("is-active");
  }
}

function labelOf(section: RepoSection): string {
  return SECTIONS.find((s) => s.id === section)?.label ?? section;
}

function selectionKey(selection: GitHubSelection): string | null {
  if (!selection) return null;
  switch (selection.kind) {
    case "pr":
      return `pr:${selection.number}`;
    case "commit":
      return `commit:${selection.sha}`;
    case "issue":
      return `issue:${selection.number}`;
    case "run":
      return `run:${selection.id}`;
    case "file":
      return `file:${selection.path}`;
  }
}
