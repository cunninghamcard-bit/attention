/**
 * Input: ../../app/App, @earendil-works/pi-agent-core, @earendil-works/pi-ai, ./AgentTools
 * Output: AGENT_VIEW_TYPE, AGENT_PROVIDERS, AgentSettings, AgentService, getAgentService
 * Pos: Application code
 *
 * 🔄 Self-reference: When this file changes, update this header
 */

import type { Agent } from "@earendil-works/pi-agent-core";
import type {
  Api,
  Credential,
  CredentialInfo,
  CredentialStore,
  Model,
  MutableModels,
} from "@earendil-works/pi-ai";
import type { App } from "../../app/App";

export const AGENT_VIEW_TYPE = "agent";

const SETTINGS_KEY = "agent-settings";
const CREDENTIALS_KEY = "agent-credentials";

/** The providers offered in settings. pi ships forty; these three cover the
 * accounts people actually hold, and adding one is a single line here. */
export const AGENT_PROVIDERS = [
  { id: "anthropic", name: "Anthropic", defaultModel: "claude-opus-5" },
  { id: "openai", name: "OpenAI", defaultModel: "gpt-5.5" },
  { id: "google", name: "Google", defaultModel: "gemini-3.1-pro-preview" },
] as const;

export interface AgentSettings {
  provider: string;
  model: string;
  systemPrompt: string;
}

export const DEFAULT_SYSTEM_PROMPT = [
  "You are the assistant embedded in a markdown vault.",
  "The user's notes are reachable only through your tools — you cannot see the",
  "vault otherwise, so list or search before you claim a note does or does not",
  "exist. Read a note before rewriting it: write_note replaces the whole file.",
  "Answer in markdown, and use wikilinks ([[Note name]]) when you refer to a note.",
].join(" ");

function defaultSettings(): AgentSettings {
  return {
    provider: AGENT_PROVIDERS[0].id,
    model: AGENT_PROVIDERS[0].defaultModel,
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
  };
}

/**
 * pi's `CredentialStore`, backed by the same per-vault local storage every
 * other core plugin writes its settings to. The store is pi's own seam for
 * exactly this (its docs: "Apps inject persistent stores"), so keys ride the
 * provider's normal auth resolution — no second auth protocol beside it.
 */
class LocalCredentialStore implements CredentialStore {
  constructor(private readonly app: App) {}

  private all(): Record<string, Credential> {
    return this.app.loadLocalStorage<Record<string, Credential>>(CREDENTIALS_KEY) ?? {};
  }

  async read(providerId: string): Promise<Credential | undefined> {
    return this.all()[providerId];
  }

  async list(): Promise<readonly CredentialInfo[]> {
    return Object.entries(this.all()).map(([providerId, credential]) => ({
      providerId,
      type: credential.type,
    }));
  }

  async modify(
    providerId: string,
    fn: (current: Credential | undefined) => Promise<Credential | undefined>,
  ): Promise<Credential | undefined> {
    const stored = this.all();
    const next = await fn(stored[providerId]);
    if (next === undefined) return stored[providerId];
    this.app.saveLocalStorage(CREDENTIALS_KEY, { ...stored, [providerId]: next });
    return next;
  }

  async delete(providerId: string): Promise<void> {
    const stored = this.all();
    delete stored[providerId];
    this.app.saveLocalStorage(CREDENTIALS_KEY, stored);
  }
}

/**
 * Seats pi's Agent SDK (`@earendil-works/pi-agent-core`) in the renderer.
 *
 * The agent loop, the provider adapters and the tool protocol are pi's; what
 * this service owns is everything vault-shaped around them — which model, whose
 * key, which tools, and the system prompt that tells the model it lives in a
 * vault. Nothing here reimplements a turn: `Agent` runs the turn, we hand it a
 * `streamFn` and listen.
 *
 * It runs renderer-side on purpose. pi-ai's Anthropic adapter already sends
 * `anthropic-dangerous-direct-browser-access`, so the same code path serves the
 * browser dev server and the Electron shell, and the vault tools stay on the
 * side of the process that owns the Vault.
 */
export class AgentService {
  private sdk: Promise<LoadedSdk> | null = null;
  private readonly credentials: LocalCredentialStore;

  constructor(private readonly app: App) {
    this.credentials = new LocalCredentialStore(app);
  }

  getSettings(): AgentSettings {
    return {
      ...defaultSettings(),
      ...this.app.loadLocalStorage<Partial<AgentSettings>>(SETTINGS_KEY),
    };
  }

  saveSettings(settings: Partial<AgentSettings>): void {
    this.app.saveLocalStorage(SETTINGS_KEY, { ...this.getSettings(), ...settings });
  }

  /**
   * The SDK arrives on first use, not at boot.
   *
   * Statically importing it put pi's agent core, the model catalog and typebox
   * in the app's entry chunk — measured at +295 KB raw / +80 KB gzip — for a
   * plugin most sessions never open. Behind a dynamic import they become their
   * own chunk and the entry grows by 99 KB instead (the view and its markdown
   * parser, which the view needs on sight); the provider request APIs stay
   * split the way pi already splits them.
   * Memoized as a promise so concurrent callers share one load and one
   * provider set.
   */
  private loadSdk(): Promise<LoadedSdk> {
    this.sdk ??= (async () => {
      const [core, ai, anthropic, openai, google, tools] = await Promise.all([
        import("@earendil-works/pi-agent-core"),
        import("@earendil-works/pi-ai"),
        import("@earendil-works/pi-ai/providers/anthropic"),
        import("@earendil-works/pi-ai/providers/openai"),
        import("@earendil-works/pi-ai/providers/google"),
        import("./AgentTools"),
      ]);
      const models = ai.createModels({ credentials: this.credentials });
      models.setProvider(anthropic.anthropicProvider());
      models.setProvider(openai.openaiProvider());
      models.setProvider(google.googleProvider());
      return { Agent: core.Agent, models, createVaultTools: tools.createVaultTools };
    })();
    return this.sdk;
  }

  async listModelIds(providerId: string): Promise<string[]> {
    const { models } = await this.loadSdk();
    return models
      .getModels(providerId)
      .map((model) => model.id)
      .sort();
  }

  async getApiKey(providerId: string): Promise<string> {
    const credential = await this.credentials.read(providerId);
    return credential?.type === "api_key" ? (credential.key ?? "") : "";
  }

  async setApiKey(providerId: string, key: string): Promise<void> {
    const trimmed = key.trim();
    if (trimmed === "") {
      await this.credentials.delete(providerId);
      return;
    }
    await this.credentials.modify(providerId, async () => ({ type: "api_key", key: trimmed }));
  }

  async resolveModel(): Promise<Model<Api>> {
    const { provider, model } = this.getSettings();
    const { models } = await this.loadSdk();
    const resolved = models.getModel(provider, model);
    if (!resolved) throw new Error(`Unknown model "${model}" for provider "${provider}"`);
    return resolved;
  }

  /** A fresh conversation. One Agent per view; the view owns its lifetime. */
  async createAgent(): Promise<Agent> {
    const { Agent: AgentClass, models, createVaultTools } = await this.loadSdk();
    return new AgentClass({
      initialState: {
        systemPrompt: this.getSettings().systemPrompt,
        model: await this.resolveModel(),
        tools: createVaultTools(this.app),
      },
      streamFn: models.streamSimple.bind(models),
    });
  }
}

interface LoadedSdk {
  Agent: typeof import("@earendil-works/pi-agent-core").Agent;
  models: MutableModels;
  createVaultTools: typeof import("./AgentTools").createVaultTools;
}

const services = new WeakMap<App, AgentService>();

/** One service per App. Kept in the slice rather than on `App` — the agent is a
 * core plugin, not a kernel capability, and nothing outside this folder needs
 * to reach it. */
export function getAgentService(app: App): AgentService {
  let service = services.get(app);
  if (!service) {
    service = new AgentService(app);
    services.set(app, service);
  }
  return service;
}
