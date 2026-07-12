import { getMarkdown, parseMarkdownToStructure } from "stream-markdown-parser";
import { createDiv, createEl } from "../../dom/dom";
import { ItemView } from "../../views/ItemView";
import { StreamMarkdownRenderer } from "../../views/StreamMarkdownRenderer";
import type { WorkspaceLeaf } from "../../views/workspace/WorkspaceLeaf";
import type { App } from "../../app/App";
import type { Agent, ArtifactChatPart } from "./Agent";
import { STRINGS } from "./AgentStrings";
import { ensureChatStyles } from "./ChatStyles";

export const ARTIFACT_VIEW_TYPE = "artifact";

// DeepChat's auto-open memory: an artifact force-opens its view exactly
// once when it finishes generating — and never again after the user closes
// it. In-memory only, like a compaction banner: not history, not persisted.
const completedContexts = new Set<string>();
const dismissedContexts = new Set<string>();

export function artifactKey(agentId: string, messageId: string, partIndex: number): string {
  return `${agentId}:${messageId}:${partIndex}`;
}

export async function openArtifact(
  app: App,
  agentId: string,
  messageId: string,
  partIndex: number,
): Promise<void> {
  const key = artifactKey(agentId, messageId, partIndex);
  const leaves = app.workspace.getLeavesOfType(ARTIFACT_VIEW_TYPE);
  const showing = leaves.find((leaf) => (leaf.view as ArtifactView | null)?.key === key);
  // Artifacts open beside the conversation, not over it.
  const leaf = showing ?? leaves[0] ?? app.workspace.getLeaf("split");
  await leaf.setViewState({
    type: ARTIFACT_VIEW_TYPE,
    active: true,
    state: { agentId, messageId, partIndex },
  });
  await app.workspace.revealLeaf(leaf);
}

export function maybeAutoOpenArtifact(
  app: App,
  agentId: string,
  messageId: string,
  partIndex: number,
): void {
  const key = artifactKey(agentId, messageId, partIndex);
  if (completedContexts.has(key) || dismissedContexts.has(key)) return;
  completedContexts.add(key);
  void openArtifact(app, agentId, messageId, partIndex);
}

// One artifact, rendered by kind: markdown through the shared pipeline,
// html in a scriptless sandbox, svg as an image, anything else as code.
export class ArtifactView extends ItemView {
  override icon = "lucide-file-code";
  override navigation = true;
  private agentId = "";
  private messageId = "";
  private partIndex = 0;
  private session: Agent | null = null;
  private lastLength = -1;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  get key(): string {
    return artifactKey(this.agentId, this.messageId, this.partIndex);
  }

  getViewType(): string {
    return ARTIFACT_VIEW_TYPE;
  }

  getDisplayText(): string {
    return this.part()?.name ?? STRINGS.artifact.displayText;
  }

  async onOpen(): Promise<void> {
    ensureChatStyles(this.app);
    this.contentEl.classList.add("artifact-view");
    this.bind();
  }

  async onClose(): Promise<void> {
    // The user closed it: remember, so completion never force-reopens it.
    dismissedContexts.add(this.key);
    await super.onClose();
  }

  override async setState(state: unknown, result?: unknown): Promise<void> {
    await super.setState(state, result as never);
    if (state && typeof state === "object" && "agentId" in state) {
      const next = state as { agentId?: unknown; messageId?: unknown; partIndex?: unknown };
      this.agentId = String(next.agentId ?? "");
      this.messageId = String(next.messageId ?? "");
      this.partIndex = Number(next.partIndex ?? 0);
      this.lastLength = -1;
      if (this.contentEl.classList.contains("artifact-view")) this.bind();
      this.updateHeader();
    }
  }

  override getState(): Record<string, unknown> {
    return { agentId: this.agentId, messageId: this.messageId, partIndex: this.partIndex };
  }

  private part(): ArtifactChatPart | null {
    const message = this.session?.getMessages().find((item) => item.id === this.messageId);
    const part = message?.parts[this.partIndex];
    return part?.type === "artifact" ? part : null;
  }

  private bind(): void {
    if (!this.agentId) return;
    this.session = this.app.agents.get(this.agentId);
    this.registerEvent(this.session.on("changed", () => this.render()));
    this.render();
  }

  // Re-renders only when the content grew — the view previews live while
  // the artifact streams.
  private render(): void {
    const part = this.part();
    if (!part) return;
    if (part.content.length === this.lastLength && part.closed) return;
    this.lastLength = part.content.length;
    this.contentEl.empty();
    const kind = part.kind ?? "markdown";
    if (kind === "html") {
      const frame = createEl("iframe", { cls: "artifact-frame", parent: this.contentEl });
      // Scriptless sandbox: generated html renders, but never executes.
      frame.setAttribute("sandbox", "");
      frame.srcdoc = part.content;
    } else if (kind === "svg") {
      const img = createEl("img", { cls: "artifact-svg", parent: this.contentEl });
      img.src = `data:image/svg+xml;utf8,${encodeURIComponent(part.content)}`;
    } else if (kind === "markdown") {
      const bodyEl = createDiv("artifact-markdown", this.contentEl);
      const renderer = new StreamMarkdownRenderer(
        bodyEl,
        this,
        `agent://${this.agentId}/${this.messageId}/${this.partIndex}`,
      );
      renderer.update(
        parseMarkdownToStructure(part.content, getMarkdown(this.key), { final: part.closed }),
      );
    } else {
      const pre = createEl("pre", { cls: "artifact-code", parent: this.contentEl });
      const code = createEl("code", { parent: pre, text: part.content });
      code.classList.add(`language-${kind}`);
    }
    this.updateHeader();
  }
}
