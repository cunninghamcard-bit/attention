import { Events } from "../core/Events";

const STORAGE_KEY = "obsidian-reconstructed-secret-storage";
const SECRET_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const fallbackSecrets = new Map<string, string>();

export class SecretStorage extends Events {
  private readonly secrets = new Map<string, string>();

  constructor() {
    super();
    this.load();
  }

  setSecret(id: string, secret: string): void {
    this.validateId(id);
    this.secrets.set(id, secret);
    this.save();
    this.trigger("changed", id, secret);
  }

  getSecret(id: string): string | null {
    return this.secrets.get(id) ?? null;
  }

  listSecrets(): string[] {
    return [...this.secrets.keys()].sort();
  }

  private validateId(id: string): void {
    if (!SECRET_ID_RE.test(id)) throw new Error(`Invalid secret ID: ${id}`);
  }

  private load(): void {
    for (const [id, secret] of fallbackSecrets) this.secrets.set(id, secret);
    try {
      const raw = getBrowserStorage()?.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      for (const [id, secret] of Object.entries(parsed)) {
        if (SECRET_ID_RE.test(id) && typeof secret === "string") this.secrets.set(id, secret);
      }
    } catch {
      this.secrets.clear();
    }
  }

  private save(): void {
    fallbackSecrets.clear();
    for (const [id, secret] of this.secrets) fallbackSecrets.set(id, secret);
    try {
      getBrowserStorage()?.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(this.secrets)));
    } catch {
      // Keep the in-memory value for this app session if browser storage is unavailable.
    }
  }
}

function getBrowserStorage(): Storage | null {
  try {
    return globalThis.window?.localStorage ?? null;
  } catch {
    return null;
  }
}
