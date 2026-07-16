import type { App } from "../../app/App";
import { Keymap } from "../../app/hotkeys/Keymap";
import { setIcon } from "../../ui/Icon";
import { SuggestModal } from "../../ui/suggest/SuggestModal";
import type { GithubRepoListItem } from "./GitHubService";
import { openInbox, openOrg, openQueryList, openRepo } from "./open";
import type { InvolvementQuery } from "./types";

/** One row in the GitHub workspace search modal. */
export type GitHubSearchSuggestion =
  | { kind: "repo"; owner: string; repo: string; fullName: string; description: string | null }
  | { kind: "query"; entity: "pr" | "issue"; query: InvolvementQuery; label: string }
  | { kind: "inbox"; label: string }
  | { kind: "org"; login: string };

const QUERY_SUGGESTIONS: Extract<GitHubSearchSuggestion, { kind: "query" }>[] = [
  { kind: "query", entity: "pr", query: "created", label: "My pull requests" },
  { kind: "query", entity: "pr", query: "review-requested", label: "Needs review" },
  { kind: "query", entity: "pr", query: "mentioned", label: "Mentioned · pull requests" },
  { kind: "query", entity: "pr", query: "assigned", label: "Assigned · pull requests" },
  { kind: "query", entity: "issue", query: "created", label: "My issues" },
  { kind: "query", entity: "issue", query: "mentioned", label: "Mentioned · issues" },
  { kind: "query", entity: "issue", query: "assigned", label: "Assigned · issues" },
];

/** Pure filter used by the modal and unit tests — keeps network out of ranking. */
export function filterGitHubSearchSuggestions(
  query: string,
  repos: GithubRepoListItem[],
  orgs: string[] = [],
): GitHubSearchSuggestion[] {
  const needle = query.trim().toLowerCase();
  const matches = (text: string): boolean => !needle || text.toLowerCase().includes(needle);

  const fixedSeed: Array<Extract<GitHubSearchSuggestion, { kind: "inbox" | "query" }>> = [
    { kind: "inbox", label: "Inbox" },
    ...QUERY_SUGGESTIONS,
  ];
  const fixed: GitHubSearchSuggestion[] = fixedSeed.filter((item) => {
    if (item.kind === "inbox") return matches(item.label) || matches("notifications");
    return matches(item.label) || matches(item.entity) || matches(item.query);
  });

  const orgItems: GitHubSearchSuggestion[] = orgs
    .filter((login) => matches(login))
    .map((login) => ({ kind: "org" as const, login }));

  const repoItems: GitHubSearchSuggestion[] = repos
    .filter(
      (repo) =>
        matches(repo.fullName) ||
        matches(repo.repo) ||
        matches(repo.owner) ||
        (repo.description ? matches(repo.description) : false),
    )
    .map((repo) => ({
      kind: "repo" as const,
      owner: repo.owner,
      repo: repo.repo,
      fullName: repo.fullName,
      description: repo.description,
    }));

  // Fixed destinations first (OMG "Search workspace" shape), then orgs, then repos.
  return [...fixed, ...orgItems, ...repoItems];
}

/**
 * OMG "Search workspace" analog: one host `SuggestModal` over repos, fixed
 * PR/issue queries, inbox, and org logins. Picking a row goes through the same
 * open helpers the nav uses — no second navigation shell.
 */
export class GitHubSearchModal extends SuggestModal<GitHubSearchSuggestion> {
  private repos: GithubRepoListItem[] = [];
  private orgLogins: string[] = [];
  private selfLogin: string | null = null;
  /** Bumped on every open/close so late network replies cannot paint a closed
   * modal or a previous generation after reopen. */
  private loadGeneration = 0;

  constructor(app: App) {
    super(app);
    this.setPlaceholder("Search GitHub workspace…");
    this.emptyStateText = "No matches";
    this.setInstructions([
      { command: "↑↓", purpose: "Navigate" },
      { command: "↵", purpose: "Open" },
      { command: "esc", purpose: "Dismiss" },
    ]);
  }

  override onOpen(): void {
    super.onOpen();
    const generation = ++this.loadGeneration;
    // Fixed destinations render immediately; network sources fill in independently
    // so one failure never blanks the others (or the whole modal).
    this.repos = [];
    this.orgLogins = [];
    this.selfLogin = null;
    this.updateSuggestions();

    void this.app.github.listUserRepositories().then(
      (repos) =>
        this.applyLoad(generation, () => {
          this.repos = repos;
        }),
      () => {
        /* keep empty repos — fixed suggestions still work */
      },
    );
    void this.app.github.listUserOrganizations().then(
      (orgs) =>
        this.applyLoad(generation, () => {
          this.orgLogins = orgs.map((org) => org.login);
        }),
      () => {
        /* org list may still gain the signed-in user from getAuth */
      },
    );
    void this.app.github.getAuth().then(
      (auth) =>
        this.applyLoad(generation, () => {
          this.selfLogin = auth.login;
        }),
      () => {
        /* no auth — leave orgs as-is */
      },
    );
  }

  override onClose(): void {
    this.loadGeneration += 1;
    super.onClose();
  }

  private applyLoad(generation: number, mutate: () => void): void {
    if (generation !== this.loadGeneration || !this.isOpen) return;
    mutate();
    this.updateSuggestions();
  }

  /** Signed-in user first (OMG / nav shape), then organization logins. */
  private resolvedOrgs(): string[] {
    const logins = [...this.orgLogins];
    if (this.selfLogin && !logins.includes(this.selfLogin)) logins.unshift(this.selfLogin);
    return logins;
  }

  getSuggestions(query: string): GitHubSearchSuggestion[] {
    return filterGitHubSearchSuggestions(query, this.repos, this.resolvedOrgs());
  }

  renderSuggestion(item: GitHubSearchSuggestion, el: HTMLElement): void {
    el.classList.add("mod-complex", "github-search-suggestion");
    const doc = el.ownerDocument;
    const content = doc.createElement("div");
    content.className = "suggestion-content";
    const title = doc.createElement("div");
    title.className = "suggestion-title";
    const note = doc.createElement("div");
    note.className = "suggestion-note";
    const aux = doc.createElement("div");
    aux.className = "suggestion-aux";
    const icon = doc.createElement("div");
    icon.className = "suggestion-flair";

    if (item.kind === "repo") {
      setIcon(icon, "lucide-book-marked");
      title.textContent = item.fullName;
      note.textContent = item.description?.trim() || "Repository";
    } else if (item.kind === "query") {
      setIcon(icon, item.entity === "pr" ? "lucide-git-pull-request" : "lucide-circle-dot");
      title.textContent = item.label;
      note.textContent = item.entity === "pr" ? "Pull requests" : "Issues";
    } else if (item.kind === "inbox") {
      setIcon(icon, "lucide-inbox");
      title.textContent = item.label;
      note.textContent = "Notifications";
    } else {
      setIcon(icon, "lucide-github");
      title.textContent = item.login;
      note.textContent = "Profile / organization";
    }

    content.append(title, note);
    aux.append(icon);
    el.append(content, aux);
  }

  onChooseSuggestion(item: GitHubSearchSuggestion, event: MouseEvent | KeyboardEvent): void {
    const openIn = Keymap.isModEvent(event);
    if (item.kind === "repo") void openRepo(this.app, item.owner, item.repo, "overview", openIn);
    else if (item.kind === "query") void openQueryList(this.app, item.entity, item.query, openIn);
    else if (item.kind === "inbox") void openInbox(this.app, openIn);
    else void openOrg(this.app, item.login, openIn);
  }
}
