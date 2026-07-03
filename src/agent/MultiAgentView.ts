import { createDiv, createSpan } from "../dom/dom";
import { ChatView } from "./ChatView";

export const MULTI_AGENT_VIEW_TYPE = "multi-agent";

// Several agents conversing in one view. A room is a chat whose speakers
// are many, not a new genre — so this extends ChatView and inherits the
// stream, composer, tool cards and scroll behavior wholesale. The room is
// one canonical event stream (Agent(roomId)); each assistant message
// carries authorId/authorName, and the participants strip derives from the
// authors seen so far (a roster event can replace that later).
export class MultiAgentView extends ChatView {
  override icon = "lucide-users";
  private participantsEl: HTMLElement | null = null;

  getViewType(): string {
    return MULTI_AGENT_VIEW_TYPE;
  }

  getDisplayText(): string {
    if (this.agentTitle) return this.agentTitle;
    return this.agentId && this.agentId !== "default" ? `Room – ${this.agentId}` : "Room";
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
    const authors = new Map<string, string>();
    for (const message of this.session.getMessages()) {
      if (message.authorId) authors.set(message.authorId, message.authorName ?? message.authorId);
    }
    const signature = [...authors.keys()].join(",");
    if (this.participantsEl.dataset.signature === signature) return;
    this.participantsEl.dataset.signature = signature;
    this.participantsEl.empty();
    createSpan({ cls: "multi-agent-participants-label", text: "Participants", parent: this.participantsEl });
    this.chip("you", "You");
    for (const [authorId, authorName] of authors) this.chip(authorId, authorName);
    if (authors.size === 0) {
      createSpan({ cls: "multi-agent-participants-hint", text: "Agents join as they speak.", parent: this.participantsEl });
    }
  }

  private chip(id: string, name: string): void {
    const chipEl = createSpan({ cls: "multi-agent-chip", parent: this.participantsEl! });
    chipEl.dataset.participantId = id;
    createSpan({ cls: "multi-agent-chip-dot", parent: chipEl });
    chipEl.appendText(name);
  }
}
