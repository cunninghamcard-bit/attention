import { createDiv } from "../../dom/dom";
import { writeClipboardText } from "../../dom/Clipboard";
import { Notice } from "../../ui/Notice";
import { Menu } from "../../ui/Menu";
import { StreamView } from "../../views/StreamView";
import type { WorkspaceLeaf } from "../../views/workspace/WorkspaceLeaf";
import { ChatComposer } from "./ChatComposer";
import { ChatMessageList } from "./ChatMessageList";
import { chatTranscriptToMarkdown, type ChatAttachmentPayload, type Agent } from "./Agent";
import { STRINGS } from "./AgentStrings";
import { AgentTransport, type HarnessCapabilities, type KernelAgent } from "./AgentTransport";
import { maybeAutoOpenArtifact } from "./ArtifactView";
import { ensureChatStyles } from "./ChatStyles";
import { MarkdownRenderer } from "../../markdown/MarkdownRenderer";
import type { App } from "../../app/App";

export const CHAT_VIEW_TYPE = "chat";

const TITLE_MAX_LENGTH = 40;

interface ChatViewEphemeralState {
  draft?: string;
  scrollTop?: number;
}

export class ChatView extends StreamView {
  override icon = "message-circle";
  override navigation = true;
  protected agentId = "default";
  protected agentTitle: string | null = null;
  protected session: Agent | null = null;
  private list: ChatMessageList | null = null;
  protected composer: ChatComposer | null = null;
  private harnessCommands: Array<{ name: string; description?: string }> = [];
  private stopActionEl: HTMLElement | null = null;
  // Set on send: the next sync pins the new user message to the viewport top
  // (chat-style anchoring) so the reply reads downward from the question.
  private anchorPending = false;
  private readonly profileTransport = new AgentTransport();
  // The thread's first member agent — what the composer's model chip
  // reflects and the thinking menu edits. null until links resolve.
  protected memberAgent: KernelAgent | null = null;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  getViewType(): string {
    return CHAT_VIEW_TYPE;
  }

  getDisplayText(): string {
    if (this.agentTitle) return this.agentTitle;
    return this.agentId === "default" ? STRINGS.chat.displayText : STRINGS.chat.displayTextFor(this.agentId);
  }

  isRunning(): boolean {
    return this.session?.isRunning() ?? false;
  }

  async steerRun(text: string): Promise<void> {
    try {
      await this.session?.steer(text);
      new Notice(STRINGS.slash.steered);
    } catch (error) {
      new Notice(STRINGS.notices.bridgeUnreachable(error instanceof Error ? error.message : String(error)));
    }
  }

  async renameThread(title: string): Promise<void> {
    await new AgentTransport().rename(this.agentId, title);
    new Notice(STRINGS.slash.renamed(title));
  }

  async deleteThread(): Promise<void> {
    if (!window.confirm(STRINGS.slash.deleteDesc + "?")) return;
    await new AgentTransport().delete(this.agentId);
    new Notice(STRINGS.slash.deleted);
    this.leaf.detach();
  }

  async stopRun(): Promise<void> {
    await this.session?.stop();
  }

  setComposerText(text: string): void {
    this.composer?.setValue(text);
    this.composer?.focus();
  }

  async onOpen(): Promise<void> {
    ensureChatStyles(this.app);
    this.contentEl.classList.add("chat-view");
    this.addAction("message-circle-plus", STRINGS.menu.newAgent, () => this.app.commands.executeCommandById("agent:create"));
    this.stopActionEl = this.addAction("lucide-square", STRINGS.slash.stop, () => void this.stopRun());
    this.stopActionEl.hide();
    this.initFor(this.agentId);
  }

  async onClose(): Promise<void> {
    await super.onClose();
  }

  override onPaneMenu(menu: Menu, source?: string): void {
    super.onPaneMenu(menu, source);
    menu.addItem((item) => item
      .setSection("action")
      .setTitle(STRINGS.menu.agentProperties)
      .setIcon("bot")
      .onClick(() => this.app.commands.executeCommandById("agent:open-properties")));
    menu.addItem((item) => item
      .setSection("action")
      .setTitle(STRINGS.menu.newAgent)
      .setIcon("message-circle-plus")
      .onClick(() => this.app.commands.executeCommandById("agent:create")));
    menu.addItem((item) => item
      .setSection("action")
      .setTitle(STRINGS.menu.copyConversation)
      .setIcon("lucide-copy")
      .setDisabled(!this.session || this.session.getMessages().length === 0)
      .onClick(() => void this.copyConversation()));
    menu.addItem((item) => item
      .setSection("action")
      .setTitle(STRINGS.members.title)
      .setIcon("users")
      .onClick((evt) => void this.openMembersMenu(evt as MouseEvent)));
    menu.addItem((item) => item
      .setSection("action")
      .setTitle(STRINGS.menu.fork)
      .setIcon("lucide-git-branch")
      .onClick(() => void this.forkThread()));
    menu.addItem((item) => item
      .setSection("action")
      .setTitle(STRINGS.menu.rename)
      .setIcon("lucide-pencil")
      .onClick(() => {
        const title = window.prompt(STRINGS.menu.renamePrompt, this.agentTitle ?? this.agentId);
        if (title?.trim()) void this.renameThread(title.trim());
      }));
    menu.addItem((item) => item
      .setSection("action")
      .setTitle(STRINGS.menu.delete)
      .setIcon("lucide-trash-2")
      .onClick(() => void this.deleteThread()));
  }

  // Fork = branch this thread: the kernel copies members and forks each
  // harness session natively, so the new thread's agent remembers
  // everything. We open the branch beside the parent.
  async forkThread(): Promise<void> {
    try {
      const { id } = await this.profileTransport.forkThread(this.agentId);
      new Notice(STRINGS.menu.forked(id));
      const { openAgent } = await import("./AgentBuiltin");
      await openAgent(this.app, id);
    } catch (error) {
      new Notice(STRINGS.menu.forkFailed(error instanceof Error ? error.message : String(error)));
    }
  }

  override async setState(state: unknown, result?: unknown): Promise<void> {
    await super.setState(state, result as never);
    if (state && typeof state === "object" && "agentId" in state) {
      const next = String((state as { agentId?: unknown }).agentId ?? "default");
      if (next !== this.agentId) {
        this.agentId = next;
        this.agentTitle = null;
        if (this.contentEl.classList.contains("chat-view")) this.initFor(next);
        this.refreshTitle();
      }
    }
  }

  override getState(): Record<string, unknown> {
    return { agentId: this.agentId };
  }

  override setEphemeralState(state: unknown): void {
    const ephemeral = (state ?? {}) as ChatViewEphemeralState;
    if (ephemeral.draft !== undefined) this.composer?.setValue(ephemeral.draft);
    if (ephemeral.scrollTop !== undefined && this.scrollEl) this.scrollEl.scrollTop = ephemeral.scrollTop;
  }

  override getEphemeralState(): ChatViewEphemeralState {
    return {
      draft: this.composer?.getValue() ?? "",
      scrollTop: this.scrollEl?.scrollTop ?? 0,
    };
  }

  private initFor(agentId: string): void {
    if (this.list) this.removeChild(this.list);
    if (this.composer) this.removeChild(this.composer);
    if (this.scroller) this.removeChild(this.scroller);
    this.contentEl.empty();

    this.session = this.app.agents.get(agentId);
    void new AgentTransport().listCommands(agentId).then((commands) => {
      if (this.agentId !== agentId) return; // view switched while in flight
      this.harnessCommands = commands;
    });
    // The body owns the dock relationship: the transcript is the only
    // scroller, the composer floats over its bottom edge, and the
    // transcript scrolls under it through the scrim (see the anatomy).
    const bodyEl = createDiv("chat-body", this.contentEl);
    const scrollEl = this.createStreamRegion("chat-scroll", bodyEl);
    // Chat speaks MarkdownView's element vocabulary, so the same delegated
    // handlers give internal links their click/hover/context-menu behavior.
    (MarkdownRenderer as unknown as {
      installInternalLinkHandlers(app: App, root: HTMLElement, sourcePath: string): void;
    }).installInternalLinkHandlers(this.app, scrollEl, `agent://${agentId}`);
    this.list = this.addChild(new ChatMessageList(scrollEl, this.session, () => this.scroller?.notifyContentChanged(), this.app));
    this.composer = this.addChild(
      new ChatComposer(
        bodyEl,
        {
          send: (text, attachments) => void this.sendMessage(text, attachments),
          queue: (text, attachments) => this.session?.queueMessage(text, attachments),
          stop: () => void this.stopRun(),
          getHarnessCommands: () => this.harnessCommands,
          isRunning: () => this.isRunning(),
          getWikilinkTargets: () => this.app.vault.getMarkdownFiles().map((file) => file.basename),
          getMentionTargets: () => this.mentionTargets(),
          getModelLabel: () => this.modelChipLabel(),
          openModelMenu: (event) => void this.openModelMenu(event),
        },
        { agentId },
      ),
    );

    if (typeof ResizeObserver !== "undefined" && this.composer) {
      const dockObserver = new ResizeObserver(() => {
        bodyEl.style.setProperty("--chat-dock-h", `${this.composer?.el.offsetHeight ?? 120}px`);
      });
      dockObserver.observe(this.composer.el);
      this.register(() => dockObserver.disconnect());
    }
    this.registerEvent(this.session.on("changed", () => this.scheduleSync()));
    void this.profileTransport.memberAgents(agentId).then((members) => {
      // Guard the race: onOpen inits for the constructor-default thread,
      // setState re-inits for the real one; the stale response must not
      // land last and overwrite the fresh member (or its absence).
      if (this.agentId !== agentId) return;
      this.memberAgent = members[0] ?? null;
      this.composer?.refreshModelChip();
    });
    this.onChatChromeReady();
    this.scheduleSync();
    this.composer.focus();
  }

  // Called after the chat regions rebuild; subclasses add their chrome here
  // (MultiAgentView inserts its participants strip above the stream).
  protected onChatChromeReady(): void {}

  // Reload the member roster after link changes; the chip follows.
  private async refreshMember(): Promise<void> {
    const members = await this.profileTransport.memberAgents(this.agentId);
    this.memberAgent = members[0] ?? null;
    this.composer?.refreshModelChip();
    void this.profileTransport.listCommands(this.agentId).then((commands) => {
      this.harnessCommands = commands;
    });
  }

  // The member roster menu. Harness is the first-class axis (user
  // ruling): current members sit on top, then one submenu per
  // registered harness — its linkable agents plus a "New {harness}
  // agent…" that creates the row and links it in one motion. Pure
  // relay of /harnesses + /agents + /links; the UI never invents a
  // default member (fail-fast).
  private async openMembersMenu(event: MouseEvent): Promise<void> {
    const [members, all, harnesses] = await Promise.all([
      this.profileTransport.memberAgents(this.agentId),
      this.profileTransport.listAgentEntities(),
      this.profileTransport.listHarnesses(),
    ]);
    const menu = new Menu(this.containerEl.ownerDocument);
    const memberLink = (agentId: string) => ({
      fromType: "agent", fromId: agentId, toType: "thread", toId: this.agentId, type: "member",
    });
    const link = async (agentId: string) => {
      try {
        await this.profileTransport.putLink(memberLink(agentId));
        new Notice(STRINGS.members.added(agentId));
        await this.refreshMember();
      } catch (error) {
        new Notice(error instanceof Error ? error.message : String(error));
      }
    };
    for (const member of members) {
      menu.addItem((item) => item
        .setTitle(STRINGS.members.remove(`${member.id} (${member.harness})`))
        .setIcon("lucide-user-minus")
        .onClick(async () => {
          await this.profileTransport.deleteLink(memberLink(member.id));
          new Notice(STRINGS.members.removed(member.id));
          await this.refreshMember();
        }));
    }
    const memberIds = new Set(members.map((member) => member.id));
    const addable = all.filter((agent) => !memberIds.has(agent.id) && (agent.type ?? "agent") === "agent");
    menu.addSections(["", ...harnesses.map((h) => `harness-${h.name}`)]);
    for (const harness of harnesses) {
      const section = `harness-${harness.name}`;
      menu.setSectionSubmenu(section, { title: harness.name, icon: "bot" });
      for (const agent of addable.filter((a) => a.harness === harness.name)) {
        menu.addItem((item) => item
          .setSection(section)
          .setTitle(STRINGS.members.add(agent.model ? `${agent.id} · ${agent.model}` : agent.id))
          .setIcon("lucide-user-plus")
          .onClick(() => void link(agent.id)));
      }
      menu.addItem((item) => item
        .setSection(section)
        .setTitle(STRINGS.members.newAgent(harness.name))
        .setIcon("lucide-plus")
        .onClick(async () => {
          const id = window.prompt(STRINGS.members.newAgentPrompt(harness.name))?.trim();
          if (!id) return;
          try {
            await this.profileTransport.putAgent({ id, name: id, harness: harness.name });
            await link(id);
          } catch (error) {
            new Notice(error instanceof Error ? error.message : String(error));
          }
        }));
    }
    // Agents on harnesses this kernel no longer registers stay reachable.
    const known = new Set(harnesses.map((h) => h.name));
    for (const agent of addable.filter((a) => !known.has(a.harness))) {
      menu.addItem((item) => item
        .setTitle(STRINGS.members.add(`${agent.id} (${agent.harness})`))
        .setIcon("lucide-user-plus")
        .onClick(() => void link(agent.id)));
    }
    if (harnesses.length === 0 && addable.length === 0 && members.length === 0) {
      menu.addItem((item) => item.setTitle(STRINGS.members.empty).setDisabled(true));
    }
    menu.showAtMouseEvent(event);
  }

  private modelChipLabel(): string {
    if (!this.memberAgent) return STRINGS.members.linkPrompt;
    const model = this.memberAgent.model || STRINGS.composer.modelDefault;
    const label = `${this.memberAgent.harness} · ${model}`;
    return this.memberAgent.thinking ? `${label} · ${this.memberAgent.thinking}` : label;
  }

  // The quick switch beside the composer: thinking levels come from the
  // member harness's own capability declaration (GET /harnesses), never
  // a hardcoded list. Saves go through the agent upsert with env OMITTED
  // so masked secrets are preserved, not clobbered. File-origin agents
  // reject writes (409) — the kernel's error text is the guidance.
  private async openModelMenu(event: MouseEvent): Promise<void> {
    const agent = this.memberAgent;
    if (!agent) {
      await this.openMembersMenu(event);
      return;
    }
    const capabilities = (await this.profileTransport.listHarnesses())
      .find((h): h is HarnessCapabilities => h.name === agent.harness);
    const menu = new Menu(this.containerEl.ownerDocument);
    const save = (patch: Partial<KernelAgent>) => {
      const next = { ...agent, ...patch };
      delete next.env; // masked on read; omitted = preserved
      this.profileTransport.putAgent(next)
        .then(() => {
          this.memberAgent = { ...agent, ...patch };
          this.composer?.refreshModelChip();
        })
        .catch((error) => new Notice(error instanceof Error ? error.message : String(error)));
    };
    menu.addItem((item) => item
      .setTitle(STRINGS.properties.editModel(capabilities?.modelHint))
      .setIcon("lucide-pencil")
      .onClick(() => {
        const model = window.prompt(capabilities?.modelHint || STRINGS.properties.modelPlaceholder, agent.model ?? "");
        if (model !== null) save({ model: model.trim() || undefined });
      }));
    const levels = capabilities?.thinkingLevels ?? [];
    if (levels.length > 0) {
      menu.addSeparator();
      for (const level of ["", ...levels]) {
        menu.addItem((item) => item
          .setTitle(level || STRINGS.properties.effortDefault)
          .setChecked((agent.thinking ?? "") === level)
          .onClick(() => save({ thinking: level || undefined })));
      }
    }
    menu.showAtMouseEvent(event);
  }

  // "@" completion targets; single-agent chats have none, rooms feed their
  // participants.
  protected mentionTargets(): string[] {
    return [];
  }

  // Transport failure is transient app trouble, not conversation content —
  // it surfaces as a Notice, the way Obsidian reports failed operations.
  // Run errors are history events and render inside the stream.
  private async sendMessage(text: string, attachments: ChatAttachmentPayload[] = []): Promise<void> {
    try {
      this.anchorPending = true;
      await this.session?.sendMessage(text, attachments);
    } catch (error) {
      new Notice(STRINGS.notices.bridgeUnreachable(error instanceof Error ? error.message : String(error)));
    }
  }

  async copyConversation(): Promise<void> {
    if (!this.session) return;
    await writeClipboardText(chatTranscriptToMarkdown(this.session.getMessages()));
    new Notice(STRINGS.notices.conversationCopied);
  }

  // The tab title follows the thread: first line of the first user message.
  private refreshTitle(): void {
    const firstUserMessage = this.session?.getMessages().find((message) => message.role === "user");
    const textPart = firstUserMessage?.parts.find((part) => part?.type === "text");
    const line = (textPart && "markdown" in textPart ? textPart.markdown : "").trim().split("\n")[0] ?? "";
    const title = line ? (line.length > TITLE_MAX_LENGTH ? `${line.slice(0, TITLE_MAX_LENGTH)}…` : line) : null;
    if (title === this.agentTitle) return;
    this.agentTitle = title;
    this.updateHeader();
    this.leaf.tabHeaderInnerTitleEl.textContent = this.getDisplayText();
  }

  protected onStreamSync(): void {
    this.list?.sync();
    for (const message of this.session?.getMessages() ?? []) {
      message.parts.forEach((part, index) => {
        if (part?.type === "artifact" && part.closed) maybeAutoOpenArtifact(this.app, this.agentId, message.id, index);
      });
    }
    // Empty = welcome: the dock rises to the reading line; the first
    // message drops it to the bottom for good.
    this.contentEl.toggleClass("is-empty", (this.session?.getMessages().length ?? 0) === 0 && !this.isRunning());
    this.anchorLastUserMessage();
    this.composer?.syncRunning();
    this.stopActionEl?.toggle(this.isRunning());
    this.refreshTitle();
  }

  // Pin the just-sent user message toward the viewport top and detach the
  // scroller: the reply streams downward from the question instead of the
  // viewport chasing the bottom. Without a spacer the pin clamps at the
  // current bottom, but the position stays stable while the reply grows.
  // ponytail: no bottom spacer — exact-top pinning on short content needs
  // one; add it if the clamped position reads badly in practice.
  private anchorLastUserMessage(): void {
    if (!this.anchorPending || !this.scrollEl) return;
    const userEls = this.scrollEl.querySelectorAll('.chat-message[data-role="user"]');
    const target = userEls[userEls.length - 1] as HTMLElement | undefined;
    if (!target) return;
    this.anchorPending = false;
    this.scrollEl.scrollTop += target.getBoundingClientRect().top - this.scrollEl.getBoundingClientRect().top - 8;
    this.scroller?.detach();
  }

}
