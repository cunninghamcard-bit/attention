/**
 * Input: None
 * Output: test suite
 * Pos: Test code
 *
 * 🔄 Self-reference: When this file changes, update this header
 */

import { beforeEach, describe, expect, it } from "vitest";
import { App } from "@web/app/App";
import {
  AGENT_VIEW_TYPE,
  getAgentService,
  type AgentService,
} from "@web/builtin/agent/AgentService";
import { createVaultTools } from "@web/builtin/agent/AgentTools";
import type { AgentView } from "@web/builtin/agent/AgentView";

// pi's SDK is a dependency of @app/web, not of the tests lane, so its types are
// reached through the modules that already declare them rather than by importing
// the package here (which this lane cannot resolve).
type Agent = Awaited<ReturnType<AgentService["createAgent"]>>;
type AgentEvent = Parameters<Parameters<Agent["subscribe"]>[0]>[0];
type AgentTool = ReturnType<typeof createVaultTools>[number];

async function createApp(): Promise<App> {
  const app = new App(document.createElement("div"));
  await app.ready;
  return app;
}

function toolNamed(tools: AgentTool[], name: string): AgentTool {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`no tool named ${name}`);
  return tool;
}

async function runTool(tools: AgentTool[], name: string, params: unknown): Promise<string> {
  const result = await toolNamed(tools, name).execute("call-1", params as never);
  return result.content.map((block) => (block.type === "text" ? block.text : "")).join("");
}

describe("agent vault tools", () => {
  let app: App;
  let tools: AgentTool[];

  beforeEach(async () => {
    app = await createApp();
    tools = createVaultTools(app);
  });

  it("lists notes, optionally under one folder", async () => {
    await app.vault.createFolder("projects");
    await app.vault.create("projects/roadmap.md", "# Roadmap");
    await app.vault.create("inbox.md", "note");

    expect(await runTool(tools, "list_notes", {})).toContain("projects/roadmap.md");
    const scoped = await runTool(tools, "list_notes", { folder: "projects" });
    expect(scoped).toContain("projects/roadmap.md");
    expect(scoped).not.toContain("inbox.md");
  });

  it("reads a note and refuses a path that is not one", async () => {
    await app.vault.create("note.md", "hello vault");
    expect(await runTool(tools, "read_note", { path: "note.md" })).toBe("hello vault");
    await expect(runTool(tools, "read_note", { path: "missing.md" })).rejects.toThrow(/No note at/);
  });

  // write_note goes through Vault.create/modify rather than touching storage,
  // which is what keeps the metadata cache and open editors in step.
  it("creates a note, then overwrites the same path", async () => {
    expect(await runTool(tools, "write_note", { path: "new.md", content: "first" })).toContain(
      "Created",
    );
    expect(await runTool(tools, "write_note", { path: "new.md", content: "second" })).toContain(
      "Updated",
    );
    const file = app.vault.getFiles().find((candidate) => candidate.path === "new.md");
    expect(file).toBeDefined();
    expect(await app.vault.read(file!)).toBe("second");
  });

  it("searches note bodies and reports the matching line", async () => {
    await app.vault.create("a.md", "nothing here");
    await app.vault.create("b.md", "line one\nthe Needle is here\nline three");

    const hit = await runTool(tools, "search_notes", { query: "needle" });
    expect(hit).toContain("b.md: the Needle is here");
    expect(hit).not.toContain("a.md");
    expect(await runTool(tools, "search_notes", { query: "absent" })).toContain("No note matches");
  });
});

describe("AgentService", () => {
  it("round-trips settings and api keys through vault-local storage", async () => {
    const app = await createApp();
    const service = getAgentService(app);

    expect(service.getSettings().provider).toBe("anthropic");
    service.saveSettings({ model: "claude-haiku-4-5" });
    expect(service.getSettings().model).toBe("claude-haiku-4-5");
    // Saving one field must not drop the others.
    expect(service.getSettings().systemPrompt).not.toBe("");

    await service.setApiKey("anthropic", "sk-test");
    expect(await service.getApiKey("anthropic")).toBe("sk-test");
    await service.setApiKey("anthropic", "  ");
    expect(await service.getApiKey("anthropic")).toBe("");
  });

  it("resolves a model pi knows and rejects one it does not", async () => {
    const app = await createApp();
    const service = getAgentService(app);

    // Explicit rather than relying on the default: local storage is keyed by
    // vault, and every app in this file opens the same in-memory one.
    service.saveSettings({ provider: "anthropic", model: "claude-opus-5" });
    expect(await service.listModelIds("anthropic")).toContain("claude-opus-5");
    expect((await service.resolveModel()).id).toBe("claude-opus-5");

    service.saveSettings({ model: "claude-imaginary-9" });
    await expect(service.resolveModel()).rejects.toThrow(/Unknown model/);
  });

  it("hands one service per app", async () => {
    const app = await createApp();
    expect(getAgentService(app)).toBe(getAgentService(app));
  });
});

/** The view is a listener over pi's event stream, so the fake is the stream. */
function fakeAgent(): { agent: Agent; emit: (event: AgentEvent) => void; prompts: string[] } {
  const listeners: Array<(event: AgentEvent) => void> = [];
  const prompts: string[] = [];
  const agent = {
    state: { isStreaming: false, errorMessage: undefined },
    subscribe(listener: (event: AgentEvent) => void) {
      listeners.push(listener);
      return () => listeners.splice(listeners.indexOf(listener), 1);
    },
    async prompt(text: string) {
      prompts.push(text);
    },
    abort() {},
  } as unknown as Agent;
  return { agent, emit: (event) => listeners.forEach((listener) => listener(event)), prompts };
}

/** submit() awaits the SDK load before it reaches the agent, so the click
 * handler settles a tick later than the click. */
async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function openAgentView(app: App): Promise<AgentView> {
  const leaf = app.workspace.getRightLeaf(false);
  if (!leaf) throw new Error("no right leaf");
  await leaf.setViewState({ type: AGENT_VIEW_TYPE } as never);
  return leaf.view as AgentView;
}

describe("AgentView", () => {
  it("registers as a core plugin view type", async () => {
    const app = await createApp();
    const view = await openAgentView(app);
    expect(view.getViewType()).toBe(AGENT_VIEW_TYPE);
    expect(view.contentEl.querySelector(".agent-composer-input")).not.toBeNull();
  });

  it("renders the transcript pi's events describe", async () => {
    const app = await createApp();
    const view = await openAgentView(app);
    const { agent, emit, prompts } = fakeAgent();
    getAgentService(app).createAgent = async () => agent;

    const input = view.contentEl.querySelector<HTMLTextAreaElement>(".agent-composer-input")!;
    input.value = "hello";
    view.contentEl.querySelector<HTMLButtonElement>(".agent-composer-send")!.click();
    await flush();
    expect(prompts).toEqual(["hello"]);

    const user = { role: "user", content: "hello", timestamp: 0 } as never;
    const assistant = { role: "assistant", content: [{ type: "text", text: "# Hi" }] } as never;
    emit({ type: "agent_start" });
    emit({ type: "message_start", message: user });
    emit({ type: "message_start", message: assistant });
    emit({ type: "message_end", message: assistant } as AgentEvent);

    expect(view.contentEl.querySelector(".agent-message.mod-user")?.textContent).toBe("hello");
    expect(view.contentEl.querySelector(".agent-message.mod-assistant h1")?.textContent).toBe("Hi");
    // The send button doubles as stop while a run is live.
    expect(view.contentEl.querySelector(".agent-composer-send")?.textContent).toBe("Stop");
    emit({ type: "agent_end", messages: [] });
    expect(view.contentEl.querySelector(".agent-composer-send")?.textContent).toBe("Send");
  });

  it("shows a tool row per tool call and marks failures", async () => {
    const app = await createApp();
    const view = await openAgentView(app);
    const { agent, emit } = fakeAgent();
    getAgentService(app).createAgent = async () => agent;
    view.contentEl.querySelector<HTMLTextAreaElement>(".agent-composer-input")!.value = "go";
    view.contentEl.querySelector<HTMLButtonElement>(".agent-composer-send")!.click();
    await flush();

    emit({
      type: "tool_execution_start",
      toolCallId: "t1",
      toolName: "read_note",
      args: { path: "a.md" },
    });
    const row = view.contentEl.querySelector(".agent-tool");
    expect(row?.classList.contains("is-running")).toBe(true);
    expect(row?.querySelector(".agent-tool-label")?.textContent).toBe("read_note");
    expect(row?.querySelector(".agent-tool-args")?.textContent).toBe("path: a.md");

    emit({
      type: "tool_execution_end",
      toolCallId: "t1",
      toolName: "read_note",
      result: {},
      isError: true,
    });
    expect(row?.classList.contains("is-running")).toBe(false);
    expect(row?.classList.contains("is-error")).toBe(true);
  });
});
