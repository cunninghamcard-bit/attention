import { createDiv, createEl, createSpan } from "../dom/dom";
import { Menu } from "../ui/Menu";
import { STRINGS } from "./AgentStrings";
import { AgentTransport } from "./AgentTransport";
import { authorHue } from "./ChatMessageList";
import { ChatView } from "./ChatView";

export const MULTI_AGENT_VIEW_TYPE = "multi-agent";

// Several agents conversing in one view. A room is a chat whose speakers
// are many, not a new genre — so this extends ChatView and inherits the
// stream, composer, tool cards and scroll behavior wholesale. The room is
// one canonical event stream (Agent(roomId)); each assistant message
// carries authorId/authorName, and the participants strip derives from the
// authors seen so far (a roster event can replace that later).
export class MultiAgentView extends ChatView {
  override icon = "users";
  private participantsEl: HTMLElement | null = null;
  private readonly inviteTransport = new AgentTransport();

  getViewType(): string {
    return MULTI_AGENT_VIEW_TYPE;
  }

  getDisplayText(): string {
    if (this.agentTitle) return this.agentTitle;
    return this.agentId && this.agentId !== "default" ? STRINGS.room.titleFor(this.agentId) : STRINGS.room.title;
  }

  protected override onChatChromeReady(): void {
    this.participantsEl = createDiv("multi-agent-participants");
    this.contentEl.insertBefore(this.participantsEl, this.contentEl.firstChild);
  }

  protected override onStreamSync(): void {
    super.onStreamSync();
    this.syncParticipants();
  }

  private syncParticipants(): void {
    if (!this.participantsEl || !this.session) return;
    // name + whether that author has a message still streaming — the chip
    // pulses while its agent is speaking.
    const authors = new Map<string, { name: string; speaking: boolean }>();
    for (const message of this.session.getMessages()) {
      if (!message.authorId) continue;
      const entry = authors.get(message.authorId) ?? { name: message.authorName ?? message.authorId, speaking: false };
      if (!message.closed) entry.speaking = true;
      authors.set(message.authorId, entry);
    }
    const signature = [...authors.entries()].map(([id, entry]) => `${id}:${entry.speaking}`).join(",");
    if (this.participantsEl.dataset.signature === signature) return;
    this.participantsEl.dataset.signature = signature;
    this.participantsEl.empty();
    createSpan({ cls: "multi-agent-participants-label", text: STRINGS.room.participants, parent: this.participantsEl });
    this.chip("you", STRINGS.role.you, false);
    for (const [authorId, entry] of authors) this.chip(authorId, entry.name, entry.speaking);
    if (authors.size === 0) {
      createSpan({ cls: "multi-agent-participants-hint", text: STRINGS.room.participantsHint, parent: this.participantsEl });
    }
    this.inviteChip();
  }

  protected override mentionTargets(): string[] {
    const names = new Set<string>();
    for (const message of this.session?.getMessages() ?? []) {
      if (message.authorName) names.add(message.authorName);
    }
    return [...names];
  }

  private chip(id: string, name: string, speaking: boolean): void {
    const chipEl = createSpan({ cls: `multi-agent-chip${speaking ? " is-speaking" : ""}`, parent: this.participantsEl! });
    chipEl.dataset.participantId = id;
    if (id !== "you") chipEl.style.setProperty("--author-hue", String(authorHue(id)));
    createSpan({ cls: "chat-author-avatar", text: name.slice(0, 1), parent: chipEl });
    createSpan({ cls: "multi-agent-chip-name", text: name, parent: chipEl });
  }

  // "+" invites: pick any known agent, address it with an "@" — inviting IS
  // addressing until the roster becomes room state on the backend.
  private inviteChip(): void {
    const inviteEl = createEl("button", { cls: "multi-agent-invite", text: "+", parent: this.participantsEl! });
    inviteEl.title = STRINGS.room.invite;
    inviteEl.addEventListener("click", async (event) => {
      const agents = await this.inviteTransport.listAgents();
      const menu = new Menu(this.containerEl.ownerDocument);
      for (const agent of agents) {
        const name = agent.title ?? agent.id;
        menu.addItem((item) => item.setTitle(name).onClick(() => {
          this.composer?.setValue(`${this.composer.getValue()}@${name} `.trimStart());
          this.composer?.focus();
        }));
      }
      menu.showAtMouseEvent(event);
    });
  }
}
