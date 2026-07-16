import type { EventRef } from "../../core/Events";
import { createDiv, createEl, createSpan } from "../../dom/dom";
import { Keymap, type UserEvent } from "../../app/hotkeys/Keymap";
import { setIcon } from "../../ui/Icon";
import { setTooltip } from "../../ui/Popover";
import { TreeItem } from "../../ui/TreeItem";
import { ItemView } from "../../views/ItemView";
import { GITHUB_VIEW, openInbox, openNotificationTarget, openOrg, openQueryList } from "./open";
import { renderGitHubSignIn, type SignInHandle } from "./signin";
import { targetKey, type GitHubTarget } from "./session";
import type { GitHubAuthState, InvolvementQuery } from "./types";
import { errorText } from "./widgets";

const PR_QUERIES: { query: InvolvementQuery; label: string; icon: string }[] = [
  { query: "created", label: "Created by me", icon: "lucide-git-pull-request" },
  { query: "review-requested", label: "Needs review", icon: "lucide-eye" },
  { query: "mentioned", label: "Mentioned me", icon: "lucide-at-sign" },
  { query: "assigned", label: "Assigned to me", icon: "lucide-user" },
];

const ISSUE_QUERIES: {
  query: InvolvementQuery;
  label: string;
  icon: string;
}[] = [
  { query: "created", label: "Created by me", icon: "lucide-circle-dot" },
  { query: "mentioned", label: "Mentioned me", icon: "lucide-at-sign" },
  { query: "assigned", label: "Assigned to me", icon: "lucide-user" },
];

type NavSection = "inbox" | "pr" | "issue" | "org";

/** The dock is a remote control: a few rows to scan, never the whole inbox. */
const INBOX_DOCK_ROWS = 5;

function notificationIcon(type: string): string {
  if (type === "PullRequest") return "lucide-git-pull-request";
  if (type === "Issue") return "lucide-circle-dot";
  if (type === "Discussion") return "lucide-messages-square";
  if (type === "Release") return "lucide-tag";
  if (type === "Commit") return "lucide-git-commit";
  if (type === "CheckSuite") return "lucide-play";
  return "lucide-bell";
}

const SECTIONS: { id: NavSection; label: string; icon: string }[] = [
  { id: "inbox", label: "Inbox", icon: "lucide-inbox" },
  { id: "pr", label: "Pull requests", icon: "lucide-git-pull-request" },
  { id: "issue", label: "Issues", icon: "lucide-circle-dot" },
  { id: "org", label: "Organizations", icon: "lucide-github" },
];

/**
 * Left-dock GitHub navigator: a four-state section switcher in the nav header
 * (Inbox | Pull requests | Issues | Organizations) over a thin body that lists
 * only the active section's navigation items. GitHub is navigated by
 * participation, not by picking a repo — there is no repo picker here; repos
 * are reached through an organization.
 */
export class GitHubNavView extends ItemView {
  static readonly VIEW_TYPE = GITHUB_VIEW.nav;

  private auth: GitHubAuthState | null = null;
  private request = 0;
  private sessionRefs: EventRef[] = [];
  private signin: SignInHandle | null = null;
  private section: NavSection = "pr";
  /** Bumped by every rewrite of the nav body. The body element is reused across
   * sections, sign-in and loading states, so `isConnected` can never tell a
   * stale async fill from a live one — only an epoch can. */
  private bodyEpoch = 0;
  private sectionButtons = new Map<NavSection, HTMLElement>();
  private bodyEl: HTMLElement | null = null;

  getViewType(): string {
    return GitHubNavView.VIEW_TYPE;
  }

  getDisplayText(): string {
    return "GitHub";
  }

  getIcon(): string {
    return "lucide-github";
  }

  async onOpen(): Promise<void> {
    this.contentEl.classList.add("github-nav-view");
    const header = createDiv("nav-header", this.contentEl);
    const buttons = createDiv("nav-buttons-container", header);
    // Header is section icons only. Search sits in the body (OMG's "Search
    // workspace" position) and Refresh is gone — a section reloads when
    // activated, and `github:refresh` covers a deliberate reload.
    for (const section of SECTIONS)
      this.sectionButtons.set(
        section.id,
        this.action(buttons, section.label, section.icon, (event) =>
          this.activateSection(section.id, event),
        ),
      );
    this.bodyEl = createDiv("nav-files-container github-nav-body", this.contentEl);
    const session = this.app.github.session;
    this.sessionRefs = [
      session.on<[GitHubTarget]>("target-change", (target) => this.markTarget(target)),
      session.on("repo-change", () => this.markTarget(session.target)),
    ];
    await this.bootstrap();
  }

  async onClose(): Promise<void> {
    this.request += 1;
    this.signin?.destroy();
    this.signin = null;
    for (const ref of this.sessionRefs) this.app.github.session.offref(ref);
    this.sessionRefs = [];
    this.contentEl.empty();
    await super.onClose();
  }

  private action(
    parent: HTMLElement,
    label: string,
    icon: string,
    onClick: (event: MouseEvent) => void,
  ): HTMLElement {
    const button = createEl(
      "div",
      {
        cls: "clickable-icon nav-action-button",
        attr: { "aria-label": label },
      },
      parent,
    );
    setIcon(button, icon);
    setTooltip(button, label);
    button.addEventListener("click", onClick);
    return button;
  }

  /** Sections are mutually exclusive and swap the body in place — never a leaf.
   * Inbox additionally opens (or focuses) the center list: the notifications
   * are worth a full tab, while the dock keeps only their titles. */
  private activateSection(section: NavSection, event?: MouseEvent): void {
    // Inbox is an entry, not a body state: its icon opens the center list and
    // the dock keeps whatever section it was showing. The dock never carries
    // notification content — the badge is the whole of its inbox presence.
    if (section === "inbox") return void openInbox(this.app, Keymap.isModEvent(event));
    this.section = section;
    this.markSection();
    this.renderSection();
  }

  private markSection(): void {
    for (const [id, button] of this.sectionButtons)
      button.classList.toggle("is-active", id === this.section);
  }

  /** Manual reload entry (`github:refresh`) — the header has no button. */
  refresh(): void {
    void this.bootstrap();
  }

  /** The dock's entire inbox presence: a count, not a list. Owner asked for
   * "some content" in the sidebar; Oh My GitHub carries none at all — a badge
   * is the smallest thing that answers both. */
  private async refreshInboxBadge(): Promise<void> {
    const button = this.sectionButtons.get("inbox");
    if (!button) return;
    try {
      const unread = (await this.app.github.listNotifications({})).filter((n) => n.unread).length;
      if (!button.isConnected) return;
      let badge = button.querySelector(".github-nav-badge");
      if (!unread) return void badge?.remove();
      if (!badge) badge = createSpan({ cls: "github-nav-badge" }, button);
      badge.textContent = unread > 99 ? "99+" : String(unread);
    } catch {
      // A badge is decoration: never let its fetch surface as an error state.
    }
  }

  private async bootstrap(): Promise<void> {
    if (!this.bodyEl) return;
    const request = ++this.request;
    this.message("Loading GitHub…");
    const auth = await this.app.github.getAuth();
    if (request !== this.request) return;
    this.auth = auth;
    if (!auth.hasToken || !auth.login) {
      this.renderSignIn();
      return;
    }
    this.markSection();
    this.renderSection();
    void this.refreshInboxBadge();
  }

  private renderSignIn(): void {
    if (!this.bodyEl) return;
    this.bodyEpoch += 1;
    this.signin?.destroy();
    this.bodyEl.empty();
    this.signin = renderGitHubSignIn(this.bodyEl, this.app, (auth) => {
      this.auth = auth;
      void this.bootstrap();
    });
  }

  private message(text: string): void {
    if (!this.bodyEl) return;
    this.bodyEpoch += 1;
    this.bodyEl.empty();
    createDiv({ cls: "github-nav-empty", text }, this.bodyEl);
  }

  /** Only the active section's navigation items — content density belongs to
   * center tabs, not to a narrow dock. */
  private renderSection(): void {
    if (!this.bodyEl) return;
    const epoch = ++this.bodyEpoch;
    this.bodyEl.empty();
    if (this.section === "org") {
      this.renderOrgs(this.bodyEl, epoch);
    } else if (this.section !== "inbox") {
      const entity = this.section;
      for (const q of entity === "pr" ? PR_QUERIES : ISSUE_QUERIES)
        this.item(this.bodyEl, {
          key: `query:${entity}:${q.query}`,
          icon: q.icon,
          label: q.label,
          onClick: (event) =>
            void openQueryList(this.app, entity, q.query, Keymap.isModEvent(event)),
        });
    }
    this.markTarget(this.app.github.session.target);
  }

  /** You are always the first entry — `/user/orgs` only returns organizations
   * you joined, so an account with none would otherwise face an empty section.
   * Your own login is the door to your profile, exactly as Oh My GitHub lists
   * it. That makes the empty state unreachable. */
  private renderOrgs(parent: HTMLElement, epoch: number): void {
    const self = this.auth?.login;
    if (self) this.orgItem(parent, self);
    const loading = createDiv({ cls: "github-nav-empty", text: "Loading…" }, parent);
    void this.app.github
      .listUserOrganizations()
      .then((orgs) => {
        if (epoch !== this.bodyEpoch) return;
        loading.remove();
        for (const org of orgs) if (org.login !== self) this.orgItem(parent, org.login);
        this.markTarget(this.app.github.session.target);
      })
      .catch((error) => {
        if (epoch !== this.bodyEpoch) return;
        loading.remove();
        createDiv({ cls: "github-nav-error", text: errorText(error) }, parent);
      });
  }

  private orgItem(parent: HTMLElement, login: string): void {
    this.item(parent, {
      key: `org:${login}`,
      icon: "lucide-user",
      label: login,
      onClick: (event) => void openOrg(this.app, login, Keymap.isModEvent(event)),
    });
  }

  private item(
    parent: HTMLElement,
    opts: {
      key: string;
      label: string;
      icon?: string;
      onClick: (event: UserEvent) => void;
    },
  ): void {
    const item = new TreeItem(parent, {
      itemClass: "nav-file github-nav-item",
      selfClass: "nav-file-title tappable is-clickable github-nav-row",
      innerClass: "nav-file-title-content",
      iconClass: "github-nav-icon",
    });
    const { selfEl, innerEl, iconEl } = item;
    selfEl.dataset.key = opts.key;
    selfEl.setAttribute("role", "button");
    selfEl.tabIndex = 0;
    if (opts.icon) setIcon(iconEl, opts.icon);
    createSpan({ cls: "tree-item-inner-text", text: opts.label }, innerEl);
    if (targetKey(this.app.github.session.target) === opts.key) selfEl.classList.add("is-active");
    item.onSelfClick = (event) => opts.onClick(event);
    selfEl.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      opts.onClick(event);
    });
  }

  private markTarget(target: GitHubTarget | null): void {
    if (!this.bodyEl) return;
    for (const el of this.bodyEl.querySelectorAll(".github-nav-row.is-active"))
      el.classList.remove("is-active");
    const key = targetKey(target);
    if (!key || key.startsWith("repo:")) return;
    const escaped = key.replace(/["\\]/g, "\\$&");
    this.bodyEl.querySelector(`[data-key="${escaped}"]`)?.classList.add("is-active");
  }
}
