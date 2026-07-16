import type { EventRef } from "../../core/Events";
import { createDiv, createEl, createSpan } from "../../dom/dom";
import { setIcon } from "../../ui/Icon";
import { setTooltip } from "../../ui/Popover";
import { Notice } from "../../ui/Notice";
import { SearchComponent } from "../../ui/Setting";
import { ItemView } from "../../views/ItemView";
import type { ViewStateResult } from "../../views/View";
import { formatRelativeDate } from "../git/relativeDate";
import type { GithubRepoListItem } from "./GitHubService";
import { Keymap } from "../../app/hotkeys/Keymap";
import {
  GITHUB_VIEW,
  openGitHubDetail,
  openNotificationTarget,
  openPrDetail,
  openQueryList,
  openRepo,
  type OpenIn,
} from "./open";
import type { GitHubSelection, GitHubTarget } from "./session";
import type { GitHubSearchItem, InvolvementQuery, NotificationItem } from "./types";
import { avatar, errorText, prStateLabel, treeRow } from "./widgets";
import { GitHubFilterSuggest, type FilterOperator } from "./GitHubFilterSuggest";

type ListKind = "pr" | "issue" | "notifications" | "org";

/** The inbox's filter language. Oh My GitHub spends four chips and a toggle on
 * the first five of these; a qualifier costs a line and composes. */
const INBOX_OPERATORS: FilterOperator[] = [
  { operator: "is:unread", description: "only unread notifications" },
  { operator: "is:all", description: "include notifications already read" },
  { operator: "reason:assigned", description: "assigned to you" },
  { operator: "reason:participating", description: "threads you took part in" },
  { operator: "reason:review-requested", description: "your review was requested" },
  { operator: "reason:mentioned", description: "you were mentioned" },
  { operator: "repo:", description: "match a repository, e.g. repo:octo/notes" },
];

/** Free text matches title or repo; qualifiers narrow. Unknown text is a plain
 * substring match, so typing before learning the language still works. */
/** The query list's filter language. `state:` is the qualifier form of the
 * header's open/closed control — the header stays the primary switch. */
const QUERY_OPERATORS: FilterOperator[] = [
  { operator: "state:open", description: "open only" },
  { operator: "state:closed", description: "closed only" },
  { operator: "is:draft", description: "draft pull requests" },
  { operator: "repo:", description: "match a repository, e.g. repo:octo/notes" },
  { operator: "author:", description: "match the author, e.g. author:ada" },
];

/** Same shape as the inbox language: qualifiers narrow, bare words match text. */
export function matchSearchItems(items: GitHubSearchItem[], query: string): GitHubSearchItem[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return items.filter((item) =>
    terms.every((term) => {
      if (term === "is:draft") return item.isDraft;
      if (term.startsWith("state:")) return item.state === term.slice(6);
      if (term.startsWith("repo:"))
        return `${item.owner}/${item.repo}`.toLowerCase().includes(term.slice(5));
      if (term.startsWith("author:"))
        return item.author.login.toLowerCase().includes(term.slice(7));
      return (
        item.title.toLowerCase().includes(term) ||
        `${item.owner}/${item.repo}`.toLowerCase().includes(term) ||
        item.author.login.toLowerCase().includes(term)
      );
    }),
  );
}

/** What a user filters by is not what the API says. GitHub's `reason` values
 * map onto these four by hand, and not one-to-one: `mentioned` also covers a
 * team mention, and `participating` covers every way you end up in a thread —
 * including `mention`, so one notification answers to two filters. Copied from
 * the reference app's own table (`REASON_FILTER_MATCHERS`, verified in the
 * installed OMG bundle), which mirrors GitHub's semantics. Comparing the filter
 * word to `reason` directly is what made `participating` match nothing: no
 * notification's reason is ever literally "participating". */
const REASON_MATCHERS: Record<string, (reason: string) => boolean> = {
  assigned: (reason) => reason === "assign",
  "review-requested": (reason) => reason === "review_requested",
  mentioned: (reason) => reason === "mention" || reason === "team_mention",
  participating: (reason) =>
    ["comment", "author", "manual", "state_change", "mention"].includes(reason),
};

export function matchNotifications(items: NotificationItem[], query: string): NotificationItem[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return items.filter((item) =>
    terms.every((term) => {
      if (term === "is:all") return true;
      if (term === "is:unread") return item.unread;
      if (term.startsWith("reason:")) {
        const filter = term.slice(7);
        // Bare `reason:` is a half-typed qualifier, not a demand for nothing —
        // same as bare `repo:`.
        if (!filter) return true;
        return REASON_MATCHERS[filter]?.(item.reason) ?? false;
      }
      if (term.startsWith("repo:")) return item.repository.toLowerCase().includes(term.slice(5));
      return (
        item.title.toLowerCase().includes(term) || item.repository.toLowerCase().includes(term)
      );
    }),
  );
}

function notificationIcon(type: string): string {
  if (type === "PullRequest") return "lucide-git-pull-request";
  if (type === "Issue") return "lucide-circle-dot";
  if (type === "Discussion") return "lucide-messages-square";
  if (type === "Release") return "lucide-tag";
  if (type === "Commit") return "lucide-git-commit";
  if (type === "CheckSuite") return "lucide-play";
  return "lucide-bell";
}

const TITLES: Record<string, string> = {
  "pr:created": "My pull requests",
  "pr:review-requested": "Needs review",
  "pr:mentioned": "Mentioned · pull requests",
  "pr:assigned": "Assigned · pull requests",
  "issue:created": "My issues",
  "issue:mentioned": "Mentioned · issues",
  "issue:assigned": "Assigned · issues",
  notifications: "Inbox",
};

/** The same queries the sidebar offers for that entity, same icons. */
const PR_QUERIES: { query: InvolvementQuery; label: string; icon: string }[] = [
  { query: "created", label: "Created by me", icon: "lucide-git-pull-request" },
  { query: "review-requested", label: "Needs review", icon: "lucide-eye" },
  { query: "mentioned", label: "Mentioned me", icon: "lucide-at-sign" },
  { query: "assigned", label: "Assigned to me", icon: "lucide-user" },
];

const ISSUE_QUERIES: { query: InvolvementQuery; label: string; icon: string }[] = [
  { query: "created", label: "Created by me", icon: "lucide-circle-dot" },
  { query: "mentioned", label: "Mentioned me", icon: "lucide-at-sign" },
  { query: "assigned", label: "Assigned to me", icon: "lucide-user" },
];

/**
 * A cross-repo center list (Oh My GitHub model A): the caller's PRs / issues by
 * involvement query, or the notifications inbox. Each row shows its own repo;
 * activating a PR / issue opens a detail tab.
 */
export class GitHubListView extends ItemView {
  static readonly VIEW_TYPE = GITHUB_VIEW.list;

  /** A navigable center destination: `recordHistory` ignores views that do not
   * declare this, so it is required alongside `result.history` for back/forward. */
  navigation = true;

  private kind: ListKind = "pr";
  private query: InvolvementQuery = "review-requested";
  private org = "";
  private inboxAll = false;
  private filter = "";
  private request = 0;
  private selectionRef: EventRef | null = null;
  private bodyEl: HTMLElement | null = null;
  private segmentedEl: HTMLElement | null = null;

  getViewType(): string {
    return GitHubListView.VIEW_TYPE;
  }

  getDisplayText(): string {
    if (this.kind === "notifications") return "Inbox";
    if (this.kind === "org") return this.org || "Organization";
    return TITLES[`${this.kind}:${this.query}`] ?? "GitHub";
  }

  getIcon(): string {
    if (this.kind === "notifications") return "lucide-inbox";
    if (this.kind === "org") return "lucide-github";
    if (this.kind === "issue") return "lucide-circle-dot";
    return "lucide-git-pull-request";
  }

  async onOpen(): Promise<void> {
    this.contentEl.classList.add("github-list-view");
    this.selectionRef = this.app.github.session.on<[GitHubSelection]>("selection-change", (s) =>
      this.markSelected(s),
    );
  }

  async setState(state: unknown, result?: ViewStateResult): Promise<void> {
    await super.setState(state, result);
    if (!state || typeof state !== "object") return;
    const previous = this.targetKey();
    const next = state as {
      kind?: ListKind;
      query?: InvolvementQuery;
      org?: string;
    };
    if (next.kind) this.kind = next.kind;
    if (next.query) this.query = next.query;
    if (typeof next.org === "string") this.org = next.org;
    // A same-type in-place re-target records history only if the view opts in
    // (the FileView pattern) — that is what feeds the native back/forward.
    // Guarded on an actual target change so a re-render never stacks history.
    if (result && this.targetKey() !== previous) result.history = true;
    // The session follows what is rendered. back()/forward() call setState
    // directly, so this is the only place that can stay in step with them.
    this.app.github.session.setTarget(this.sessionTarget());
    this.filter = "";
    this.build();
    this.leaf.updateHeader();
  }

  /** `is:` selects the server-side set (read included or not); the rest narrow
   * what is already on screen. Only a change of set costs a request. */
  private applyInboxFilter(): void {
    const all = /(^|\s)is:all(\s|$)/.test(this.filter);
    if (all !== this.inboxAll) {
      this.inboxAll = all;
      return void this.reload();
    }
    this.draw();
  }

  private sessionTarget(): GitHubTarget {
    if (this.kind === "notifications") return { kind: "inbox" };
    if (this.kind === "org") return { kind: "org", org: this.org };
    return { kind: "query", entity: this.kind, query: this.query };
  }

  private targetKey(): string {
    if (this.kind === "notifications") return "notifications";
    if (this.kind === "org") return `org:${this.org}`;
    return `${this.kind}:${this.query}`;
  }

  getState(): Record<string, unknown> {
    if (this.kind === "notifications") return { kind: "notifications" };
    if (this.kind === "org") return { kind: "org", org: this.org };
    return { kind: this.kind, query: this.query };
  }

  async onClose(): Promise<void> {
    this.request += 1;
    if (this.selectionRef) this.app.github.session.offref(this.selectionRef);
    this.selectionRef = null;
    await super.onClose();
  }

  /** Manual reload entry (`github:refresh`) — the header has no button. */
  refresh(): void {
    this.reload();
  }

  private build(): void {
    this.contentEl.empty();
    this.buildHeader();
    // Filter / inbox controls are content-level controls, not tab chrome: the
    // tab's title, segmented switcher and actions live in the real view-header.
    const controls = createDiv("github-list-controls", this.contentEl);
    if (this.kind === "notifications") {
      const search = new SearchComponent(controls).setPlaceholder("Filter…").setValue(this.filter);
      search.inputEl.setAttribute("aria-label", "Filter");
      // The qualifiers are the controls: `is:` replaces the Unread/All toggle,
      // `reason:` the chip row, and `repo:` is a filter no button offered.
      new GitHubFilterSuggest(this.app, search.inputEl, INBOX_OPERATORS, (value) => {
        this.filter = value;
        this.applyInboxFilter();
      });
      search.onChange((value) => {
        this.filter = value;
        this.applyInboxFilter();
      });
      const markAll = createEl(
        "div",
        {
          cls: "github-linkish",
          text: "Mark all as read",
          attr: { role: "button", tabindex: "0" },
        },
        controls,
      );
      const markAllRead = (): void => {
        void this.app.github.markAllNotificationsRead().then((error) => {
          if (error) new Notice(error);
          else {
            new Notice("Marked all as read");
            this.reload();
          }
        });
      };
      markAll.addEventListener("click", markAllRead);
      markAll.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        markAllRead();
      });
    } else {
      const search = new SearchComponent(controls).setPlaceholder("Filter…").setValue(this.filter);
      search.inputEl.setAttribute("aria-label", "Filter");
      new GitHubFilterSuggest(this.app, search.inputEl, QUERY_OPERATORS, (value) => {
        this.filter = value;
        this.draw();
      });
      search.onChange((value) => {
        this.filter = value;
        this.draw();
      });
    }
    this.bodyEl = createDiv("github-list-body", this.contentEl);
    this.reload();
  }

  /** The real `view-header` owns this tab's chrome: back/forward and the title
   * come from ItemView, the query switcher mounts beside them. `addAction()`
   * only makes icon buttons, so the segmented control attaches to headerEl. */
  private buildHeader(): void {
    this.segmentedEl?.remove();
    this.segmentedEl = null;
    if (this.kind !== "pr" && this.kind !== "issue") return;
    const entity = this.kind;
    const nav = createDiv("github-segmented-control github-list-nav");
    for (const q of entity === "pr" ? PR_QUERIES : ISSUE_QUERIES) {
      // clickable-icon: the host's icon-button language, and the only way out of
      // the global `button:not(.clickable-icon)` form-control chrome.
      const item = createEl(
        "button",
        {
          cls: `clickable-icon github-segmented-control-item${
            q.query === this.query ? " is-active" : ""
          }`,
          attr: { type: "button", "aria-label": q.label },
        },
        nav,
      );
      setIcon(item, q.icon);
      setTooltip(item, q.label);
      item.addEventListener("click", (event) => {
        if (q.query === this.query) return;
        const openIn = Keymap.isModEvent(event);
        // Straight to *this* leaf: the global opener reuses the first leaf of
        // the type and would drive another tab. A modifier still forks.
        if (openIn) void openQueryList(this.app, entity, q.query, openIn);
        else
          void this.leaf.setViewState({
            type: GITHUB_VIEW.list,
            active: true,
            state: { kind: entity, query: q.query },
          });
      });
    }
    this.headerEl.insertBefore(nav, this.actionsEl);
    this.segmentedEl = nav;
  }

  private items: GitHubSearchItem[] | null = null;
  private notifications: NotificationItem[] | null = null;
  private orgRepos: GithubRepoListItem[] | null = null;

  private async reload(): Promise<void> {
    if (!this.bodyEl) return;
    const request = ++this.request;
    this.bodyEl.empty();
    createDiv({ cls: "github-empty", text: "Loading…" }, this.bodyEl);
    try {
      if (this.kind === "notifications") {
        this.notifications = await this.app.github.listNotifications({
          all: this.inboxAll,
        });
      } else if (this.kind === "org") {
        // `/orgs/{login}/repos` 404s for a person: your own login is in this
        // list too, so it has to resolve through the user endpoint. The profile
        // tab takes over this door in the github-profile goal.
        const auth = await this.app.github.getAuth();
        this.orgRepos =
          this.org && this.org === auth.login
            ? await this.app.github.listUserRepositories()
            : await this.app.github.listOrgRepositories(this.org);
      } else {
        this.items = await this.app.github.searchInvolvement(this.kind, this.query);
      }
      if (request !== this.request) return;
      this.draw();
    } catch (error) {
      if (request !== this.request) return;
      this.bodyEl.empty();
      createDiv({ cls: "github-error", text: errorText(error) }, this.bodyEl);
    }
  }

  private draw(): void {
    if (!this.bodyEl) return;
    this.bodyEl.empty();
    if (this.kind === "notifications") return this.drawNotifications();
    if (this.kind === "org") return this.drawOrgRepos();
    const list = createDiv("github-list", this.bodyEl);
    const matched = matchSearchItems(this.items ?? [], this.filter);
    if (!matched.length) {
      createDiv({ cls: "github-empty", text: "Nothing here." }, list);
      return;
    }
    for (const item of matched) this.searchRow(list, item);
  }

  private drawOrgRepos(): void {
    const list = createDiv("github-list", this.bodyEl!);
    const q = this.filter.trim().toLowerCase();
    const matched = (this.orgRepos ?? []).filter(
      (repo) =>
        !q ||
        repo.repo.toLowerCase().includes(q) ||
        repo.fullName.toLowerCase().includes(q) ||
        (repo.description ?? "").toLowerCase().includes(q),
    );
    if (!matched.length) {
      createDiv({ cls: "github-empty", text: "No repositories." }, list);
      return;
    }
    for (const repo of matched) {
      const row = treeRow(list, {
        cls: "github-org-repo",
        key: `repo:${repo.owner}/${repo.repo}`,
      });
      setIcon(row.iconEl, repo.private ? "lucide-lock" : "lucide-book");
      createSpan({ cls: "tree-item-inner-text", text: repo.repo }, row.innerEl);
      if (repo.description) {
        createDiv({ cls: "tree-item-inner-subtext", text: repo.description }, row.innerEl);
      }
      row.activate(
        (event) =>
          void openRepo(this.app, repo.owner, repo.repo, "overview", Keymap.isModEvent(event)),
      );
    }
  }

  private searchRow(parent: HTMLElement, item: GitHubSearchItem): void {
    // Cross-repo list: #42 exists in many repos, so the number alone would
    // highlight whichever row happened to come first.
    const key = `${item.isPullRequest ? "pr" : "issue"}:${item.owner}/${item.repo}#${item.number}`;
    const row = treeRow(parent, {
      cls: "github-search",
      key,
      active: selectionKey(this.app.github.session.selection) === key,
    });
    avatar(row.iconEl, item.author.login, item.author.avatarUrl, 20);
    const title = createSpan("github-row-title-line", row.innerEl);
    createSpan({ cls: "github-repo-chip", text: `${item.owner}/${item.repo}` }, title);
    createSpan({ cls: "tree-item-inner-text", text: item.title }, title);
    createSpan({ cls: "github-row-number", text: `#${item.number}` }, title);
    for (const label of item.labels.slice(0, 3)) {
      const chip = createSpan({ cls: "github-label", text: label.name }, title);
      chip.style.setProperty("--label-color", `#${label.color}`);
    }
    createDiv(
      {
        cls: "tree-item-inner-subtext",
        text: `${item.author.login} · ${item.state}`,
      },
      row.innerEl,
    );
    const flair = createSpan("tree-item-flair-outer", row.selfEl);
    createSpan(
      {
        cls: "tree-item-flair github-time",
        text: formatRelativeDate(item.updatedAt),
      },
      flair,
    );
    if (item.comments) {
      const comments = createSpan("tree-item-flair github-comments", flair);
      setIcon(comments, "lucide-message-square");
      createSpan({ text: String(item.comments) }, comments);
    }
    const glyph = createSpan(
      `tree-item-flair github-pr-state mod-${prStateLabel(item.state, item.isDraft)}`,
      flair,
    );
    setIcon(glyph, item.isPullRequest ? "lucide-git-pull-request" : "lucide-circle-dot");
    row.activate((event) => {
      const openIn = Keymap.isModEvent(event);
      if (item.isPullRequest)
        void openPrDetail(this.app, item.owner, item.repo, item.number, openIn);
      else
        void openGitHubDetail(
          this.app,
          {
            kind: "issue",
            number: item.number,
            owner: item.owner,
            repo: item.repo,
          },
          openIn,
        );
    });
  }

  private drawNotifications(): void {
    const list = createDiv("github-list", this.bodyEl!);
    const items = matchNotifications(this.notifications ?? [], this.filter);
    if (!items.length) {
      createDiv({ cls: "github-empty", text: "You're all caught up." }, list);
      return;
    }
    for (const item of items) {
      const row = treeRow(list, {
        cls: "github-notification",
        key: `notification:${item.id}`,
      });
      row.selfEl.classList.toggle("is-unread", item.unread);
      // The type is what tells a PR from a Discussion at a glance; the dot only
      // ever said "unread". This is the center tab, so it carries the detail
      // the dock deliberately leaves out.
      setIcon(row.iconEl, notificationIcon(item.type));
      row.iconEl.classList.toggle("is-unread", item.unread);
      createDiv({ cls: "tree-item-inner-text", text: item.title }, row.innerEl);
      const meta = createDiv({ cls: "tree-item-inner-subtext" }, row.innerEl);
      createSpan({ cls: "github-repo-chip", text: item.repository }, meta);
      createSpan({ cls: "github-muted", text: item.reason.replace(/_/g, " ") }, meta);
      createSpan({ cls: "github-muted", text: formatRelativeDate(item.updatedAt) }, meta);
      row.activate((event) => this.openNotification(item, Keymap.isModEvent(event)));
    }
  }

  private openNotification(item: NotificationItem, openIn?: OpenIn): void {
    // Navigate first. Marking read is bookkeeping: awaiting it would stall the
    // first open on the network and, worse, let two quick clicks arrive in
    // PATCH-completion order — the last click has to win.
    void openNotificationTarget(this.app, item, openIn);
    if (!item.unread) return;
    // The service reports failure as a *returned string*, never a rejection —
    // same shape as markAllNotificationsRead below. Clearing unread on a failed
    // PATCH would lie to the user about server state.
    void this.app.github.markNotificationRead(item.id).then((error) => {
      if (error) return void new Notice(error);
      item.unread = false;
      // The leaf may have re-targeted while the PATCH was in flight; redrawing
      // then would paint stale notifications over whatever is loading now.
      if (this.kind === "notifications" && this.notifications?.includes(item)) this.draw();
    });
  }

  private markSelected(selection: GitHubSelection): void {
    if (!this.bodyEl) return;
    for (const el of this.bodyEl.querySelectorAll(".github-row.is-active"))
      el.classList.remove("is-active");
    const key = selectionKey(selection);
    if (!key) return;
    const escaped = key.replace(/["\\]/g, "\\$&");
    this.bodyEl.querySelector(`[data-key="${escaped}"]`)?.classList.add("is-active");
  }
}

function selectionKey(selection: GitHubSelection): string | null {
  if (!selection) return null;
  if (selection.kind === "pr" || selection.kind === "issue")
    return `${selection.kind}:${selection.owner}/${selection.repo}#${selection.number}`;
  return null;
}
