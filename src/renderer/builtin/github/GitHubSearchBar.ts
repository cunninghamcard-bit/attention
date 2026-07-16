import type { App } from "../../app/App";
import { Keymap } from "../../app/hotkeys/Keymap";
import { setIcon } from "../../ui/Icon";
import { AbstractInputSuggest } from "../../ui/suggest/AbstractInputSuggest";
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

/** Rows look the way the host's other suggestion lists look — no second idiom. */
function renderGitHubSuggestion(item: GitHubSearchSuggestion, el: HTMLElement): void {
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

/** The suggestions hanging off the bar's input. `AbstractInputSuggest` is what
 * the host uses for its own `path:` / `file:` / `tag:` inputs. */
class GitHubSearchSuggest extends AbstractInputSuggest<GitHubSearchSuggestion> {
  constructor(
    app: App,
    inputEl: HTMLInputElement,
    private readonly bar: GitHubSearchBar,
  ) {
    super(app, inputEl);
  }

  getSuggestions(query: string): GitHubSearchSuggestion[] {
    return this.bar.suggestionsFor(query);
  }

  renderSuggestion(item: GitHubSearchSuggestion, el: HTMLElement): void {
    renderGitHubSuggestion(item, el);
  }

  selectSuggestion(item: GitHubSearchSuggestion, event: MouseEvent | KeyboardEvent): void {
    this.bar.choose(item, event);
  }

  /** Escape leaves the search, not just the popover. The suggestion scope is
   * pushed above the view's while it is open and the keymap listens on the
   * window in capture, so this hook is the only place that key can be caught —
   * a listener on the input never sees it. */
  override onEscapeKey(): void {
    this.bar.close();
  }
}

/**
 * GitHub workspace search, in the host's document-search shell: absent until
 * summoned, mounted on the leaf it was summoned from, gone on Escape. No
 * centered prompt, no sidebar entry — ⌘F is how this app already searches.
 *
 * One bar per view: summoning twice toggles rather than stacking a second.
 */
export class GitHubSearchBar {
  private static readonly bars = new WeakMap<object, GitHubSearchBar>();

  private containerEl: HTMLElement | null = null;
  private suggest: GitHubSearchSuggest | null = null;
  private repos: GithubRepoListItem[] = [];
  private orgLogins: string[] = [];
  private selfLogin: string | null = null;
  /** Bumped on every open/close so a late network reply cannot fill a bar that
   * has since been dismissed, or a previous generation after reopen. */
  private loadGeneration = 0;

  private constructor(
    readonly app: App,
    private readonly view: { contentEl: HTMLElement },
  ) {}

  /** ⌘F on a GitHub leaf: summon, or dismiss the one already there. Returns the
   * bar that is now open, or null when the call dismissed it. */
  static toggle(app: App, view: { contentEl: HTMLElement }): GitHubSearchBar | null {
    const existing = GitHubSearchBar.bars.get(view);
    if (existing) {
      existing.close();
      return null;
    }
    const bar = new GitHubSearchBar(app, view);
    GitHubSearchBar.bars.set(view, bar);
    bar.open();
    return bar;
  }

  static isOpen(view: { contentEl: HTMLElement }): boolean {
    return GitHubSearchBar.bars.has(view);
  }

  /** Signed-in user first (OMG / nav shape), then organization logins. */
  private orgs(): string[] {
    const logins = [...this.orgLogins];
    if (this.selfLogin && !logins.includes(this.selfLogin)) logins.unshift(this.selfLogin);
    return logins;
  }

  suggestionsFor(query: string): GitHubSearchSuggestion[] {
    return filterGitHubSearchSuggestions(query, this.repos, this.orgs());
  }

  /** Picking a row goes through the same open helpers the nav uses — no second
   * navigation shell — and the bar leaves once it has done its job. */
  choose(item: GitHubSearchSuggestion, event: MouseEvent | KeyboardEvent): void {
    const openIn = Keymap.isModEvent(event);
    if (item.kind === "repo") void openRepo(this.app, item.owner, item.repo, "overview", openIn);
    else if (item.kind === "query") void openQueryList(this.app, item.entity, item.query, openIn);
    else if (item.kind === "inbox") void openInbox(this.app, openIn);
    else void openOrg(this.app, item.login, openIn);
    this.close();
  }

  private open(): void {
    const doc = this.view.contentEl.ownerDocument;
    // The host's own search chrome, class for class — a second look here would
    // be a second idiom to maintain.
    const container = doc.createElement("div");
    container.className = "document-search-container github-search-bar";
    const search = doc.createElement("div");
    search.className = "document-search";
    const input = doc.createElement("input");
    input.className = "document-search-input";
    input.type = "text";
    input.placeholder = "Search GitHub workspace…";
    const close = doc.createElement("button");
    close.className = "document-search-button clickable-icon";
    close.type = "button";
    setIcon(close, "lucide-x");
    close.setAttribute("aria-label", "Close search");
    close.addEventListener("click", () => this.close());
    search.append(input, close);
    container.append(search);
    this.view.contentEl.prepend(container);
    this.containerEl = container;

    // Covers Escape with the popover shut: nothing holds a scope then, so the
    // key reaches the DOM. With it open, GitHubSearchSuggest.onEscapeKey has it.
    input.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      this.close();
    });

    this.suggest = new GitHubSearchSuggest(this.app, input, this);
    input.focus();
    this.load();
  }

  close(): void {
    this.loadGeneration += 1;
    this.suggest?.close();
    this.suggest = null;
    this.containerEl?.remove();
    this.containerEl = null;
    GitHubSearchBar.bars.delete(this.view);
  }

  private load(): void {
    const generation = ++this.loadGeneration;
    // Fixed destinations render immediately; network sources fill in
    // independently so one failure never blanks the others.
    this.repos = [];
    this.orgLogins = [];
    this.selfLogin = null;
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

  private applyLoad(generation: number, mutate: () => void): void {
    if (generation !== this.loadGeneration || !this.containerEl) return;
    mutate();
    this.suggest?.onInputChange();
  }
}
