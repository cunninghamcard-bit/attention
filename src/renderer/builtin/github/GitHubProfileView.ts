import { createDiv, createEl, createSpan } from "../../dom/dom";
import { setIcon } from "../../ui/Icon";
import { setTooltip } from "../../ui/Popover";
import { SearchComponent } from "../../ui/Setting";
import { ItemView } from "../../views/ItemView";
import type { ViewStateResult } from "../../views/View";
import { Keymap } from "../../app/hotkeys/Keymap";
import { GITHUB_VIEW, openRepo } from "./open";
import type { GithubRepoListItem } from "./GitHubService";
import { avatar, errorText, treeRow } from "./widgets";

/** The profile tab's two sub-views — the OMG profile sections, mapped to the
 * view-header segmented control (owner's call: never an in-page nav column). */
type ProfileSection = "overview" | "repositories";

const SECTIONS: { id: ProfileSection; label: string; icon: string }[] = [
  { id: "overview", label: "Overview", icon: "lucide-book-open" },
  { id: "repositories", label: "Repositories", icon: "lucide-library" },
];

/** Overview shows the top of the list; the full list lives one segment over. */
const OVERVIEW_REPO_LIMIT = 6;

/**
 * The org / user profile center tab (spec: "A — org/user profile tab").
 * Identity head + header-segmented Overview | Repositories. Its repository
 * rows are the only door into a `github-repo` tab. Richer profile content
 * (contribution heatmap, stars / followers) is a follow-up goal by contract.
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
    if (next.section === "overview" || next.section === "repositories") this.section = next.section;
    // Re-targeting the leaf at another profile — or another sub-view — is a
    // navigation step, not a display mode: both feed native back/forward
    // (the FileView pattern every GitHub center view follows).
    if (result && (this.login !== previousLogin || this.section !== previousSection))
      result.history = true;
    if (this.login !== previousLogin) this.query = "";
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
    for (const section of SECTIONS) {
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
    this.renderHead(null, null);
    createDiv({ cls: "github-empty", text: "Loading profile…" }, this.bodyEl);
    let auth: { login: string | null; avatarUrl: string | null; name: string | null };
    let repos: GithubRepoListItem[];
    let subtitle: string | null = null;
    let avatarUrl: string | null = null;
    try {
      auth = await this.app.github.getAuth();
      if (this.login === auth.login) {
        repos = await this.app.github.listUserRepositories();
        subtitle = auth.name;
        avatarUrl = auth.avatarUrl;
      } else {
        const [orgRepos, orgs] = await Promise.all([
          this.app.github.listOrgRepositories(this.login),
          this.app.github.listUserOrganizations(),
        ]);
        repos = orgRepos;
        const org = orgs.find((o) => o.login === this.login);
        subtitle = org?.description ?? null;
        avatarUrl = org?.avatarUrl ?? null;
      }
    } catch (error) {
      if (request !== this.request) return;
      this.bodyEl.empty();
      createDiv({ cls: "github-error", text: errorText(error) }, this.bodyEl);
      return;
    }
    if (request !== this.request) return;
    this.renderHead(subtitle, avatarUrl);
    this.bodyEl.empty();
    if (this.section === "overview") this.renderOverview(repos);
    else this.renderRepositories(repos);
  }

  /** Identity head: avatar, login, subtitle. Drawn immediately with what the
   * state carries, then again when the fetch fills in subtitle / avatar. */
  private renderHead(subtitle: string | null, avatarUrl: string | null): void {
    if (!this.headEl) return;
    this.headEl.empty();
    // github.com/{login}.png resolves for users and orgs alike — a stable
    // avatar without a profile API round-trip.
    avatar(this.headEl, this.login, avatarUrl || `https://github.com/${this.login}.png`, 48);
    const idEl = createDiv("github-profile-identity", this.headEl);
    createEl("h2", { cls: "github-profile-login", text: this.login }, idEl);
    if (subtitle) createDiv({ cls: "github-profile-subtitle", text: subtitle }, idEl);
  }

  // --- Overview ------------------------------------------------------------

  private renderOverview(repos: GithubRepoListItem[]): void {
    const root = createDiv("github-profile-overview", this.bodyEl!);
    // Stat tiles from the data already in hand; richer counts (followers,
    // stars) belong to the follow-up profile goal, per contract.
    const tiles = createDiv("github-profile-tiles", root);
    this.tile(tiles, "Repositories", String(repos.length));
    this.tile(tiles, "Open issues", String(repos.reduce((sum, r) => sum + r.openIssues, 0)));
    this.tile(tiles, "Private", String(repos.filter((r) => r.private).length));
    createEl("h3", { cls: "github-profile-heading", text: "Top repositories" }, root);
    const list = createDiv("github-list", root);
    if (!repos.length) {
      createDiv({ cls: "github-empty", text: "No repositories." }, list);
      return;
    }
    // ponytail: "top" = the API's own ordering; the list payload carries no
    // star counts to rank by — rank by stars when the client exposes them.
    for (const repo of repos.slice(0, OVERVIEW_REPO_LIMIT)) this.repoRow(list, repo);
    if (repos.length > OVERVIEW_REPO_LIMIT) {
      const all = treeRow(list, { cls: "github-profile-all" });
      setIcon(all.iconEl, "lucide-library");
      createDiv(
        { cls: "tree-item-inner-text", text: `All repositories (${repos.length})` },
        all.innerEl,
      );
      all.activate(() => this.setSection("repositories"));
    }
  }

  private tile(parent: HTMLElement, label: string, value: string): void {
    const tile = createDiv("github-profile-tile", parent);
    createDiv({ cls: "github-profile-tile-value", text: value }, tile);
    createDiv({ cls: "github-profile-tile-label", text: label }, tile);
  }

  // --- Repositories ----------------------------------------------------------

  private renderRepositories(repos: GithubRepoListItem[]): void {
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
}
