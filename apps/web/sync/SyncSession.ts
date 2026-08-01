/**
 * Input: None
 * Output: SyncSession, SyncedVaultChoice, sessionStore, syncApi
 * Pos: Application code
 *
 * 🔄 Self-reference: When this file changes, update this header
 */

/**
 * Connection state for the synced-vault mode, read BEFORE the App exists
 * (the boot sequence decides the adapter from it), so it lives in plain
 * localStorage rather than any app-level store. Two records: who you are
 * (server + JWT) and which vault this window opens.
 */

export interface SyncSession {
  url: string;
  token: string;
  email: string;
}

export interface SyncedVaultChoice {
  id: string;
  name: string;
}

const SESSION_KEY = "attention-sync-session";
const VAULT_KEY = "attention-sync-vault";

function readJson<T>(key: string): T | null {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export const sessionStore = {
  session(): SyncSession | null {
    return readJson<SyncSession>(SESSION_KEY);
  },
  saveSession(session: SyncSession): void {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  },
  vault(): SyncedVaultChoice | null {
    return readJson<SyncedVaultChoice>(VAULT_KEY);
  },
  saveVault(choice: SyncedVaultChoice): void {
    localStorage.setItem(VAULT_KEY, JSON.stringify(choice));
  },
  clear(): void {
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(VAULT_KEY);
  },
};

/** Typed calls to attentiond's HTTP face. Errors carry the server's text. */
export const syncApi = {
  async credentials(
    url: string,
    kind: "register" | "login",
    email: string,
    password: string,
  ): Promise<SyncSession> {
    const body = await post(`${url}/auth/${kind}`, null, { email, password });
    return { url, token: String(body.access_token), email: String(body.email) };
  },

  async listVaults(session: SyncSession): Promise<SyncedVaultChoice[]> {
    const res = await fetch(`${session.url}/api/vaults`, {
      headers: { authorization: `Bearer ${session.token}` },
    });
    if (!res.ok) throw new Error(await errorText(res));
    const rows = (await res.json()) as Array<{ id: string; name: string }>;
    return rows.map((row) => ({ id: row.id, name: row.name }));
  },

  async createVault(session: SyncSession, name: string): Promise<SyncedVaultChoice> {
    const body = await post(`${session.url}/api/vaults`, session.token, { name });
    return { id: String(body.id), name: String(body.name) };
  },
};

async function post(
  url: string,
  token: string | null,
  payload: unknown,
): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await errorText(res));
  return (await res.json()) as Record<string, unknown>;
}

async function errorText(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    if (body.error) return body.error;
  } catch {
    // fall through to the status line
  }
  return `${res.status} ${res.statusText}`;
}
