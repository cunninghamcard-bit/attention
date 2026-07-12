import type { App } from "../../app/App";
import type { EventRef } from "../../core/Events";
import type { Agent } from "./Agent";
import { formatUsage, STRINGS } from "./AgentStrings";
import { AgentTransport } from "./AgentTransport";
import { ChatView } from "./ChatView";

const HEALTH_POLL_MS = 30_000;

// Token usage lives in the app status bar, the way WordCount's counts do:
// it is ephemeral per-view status, not conversation content, so it never
// renders inside ChatView. Follows the active leaf; hidden while the active
// view is not a chat.
export class AgentStatusBar {
  private readonly el: HTMLElement;
  private current: Agent | null = null;
  private changedRef: EventRef | null = null;

  // Kernel liveness from GET /health, polled slowly: "loom v0.1.0" when
  // the sidecar answers, the offline marker when it does not.
  private kernelLabel = "";

  constructor(private readonly app: App) {
    this.el = app.statusBar.registerStatusBarItem();
    this.el.classList.add("agent-status");
    const transport = new AgentTransport();
    const poll = async () => {
      const health = await transport.health();
      this.kernelLabel =
        health?.status === "ok"
          ? STRINGS.status.kernel(health.version)
          : STRINGS.status.kernelOffline;
      this.render();
    };
    void poll();
    window.setInterval(() => void poll(), HEALTH_POLL_MS);
    // active-leaf-change can fire before the view's setState assigns the
    // agentId; layout-change fires after, so listening to both keeps the
    // binding honest (the WordCount pattern: re-resolve on workspace events).
    app.workspace.on("active-leaf-change", () => this.rebind());
    app.workspace.on("layout-change", () => this.rebind());
    this.rebind();
  }

  private rebind(): void {
    const view = this.app.workspace.getActiveViewOfType(ChatView);
    const agentId = view ? String(view.getState().agentId ?? "") : "";
    const agent = agentId ? this.app.agents.get(agentId) : null;
    if (agent !== this.current) {
      if (this.current && this.changedRef) this.current.offref(this.changedRef);
      this.current = agent;
      this.changedRef = agent?.on("changed", () => this.render()) ?? null;
    }
    this.render();
  }

  private render(): void {
    const usage = this.current?.state.usage;
    const pieces: string[] = [];
    if (usage) pieces.push(formatUsage(usage));
    // The offline marker always shows (that is the point); the version
    // tag only accompanies an active chat, keeping the bar quiet.
    if (this.kernelLabel === STRINGS.status.kernelOffline || (this.kernelLabel && this.current))
      pieces.push(this.kernelLabel);
    if (pieces.length === 0) {
      this.el.style.display = "none";
      return;
    }
    this.el.style.display = "";
    this.el.textContent = pieces.join(" · ");
  }
}
