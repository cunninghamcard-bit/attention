// @vitest-environment node
/**
 * Input: None
 * Output: test suite
 * Pos: Test code
 *
 * 🔄 Self-reference: When this file changes, update this header
 */

import { describe, expect, it } from "vitest";
import { LoroDataAdapter } from "@web/sync/LoroDataAdapter";
import { MemorySyncStore } from "@web/sync/SyncStore";
import { SyncClient } from "@web/sync/SyncClient";

/**
 * 多端跑通 — the acceptance for the whole data layer: two full replica
 * stacks (SyncStore → VaultDocs → LoroDataAdapter → SyncClient over the
 * official loro-websocket) converging through a REAL attentiond and
 * Postgres. Runs when TEST_SYNC_SERVER points at a live server
 * (devenv/e2e/run.sh provides one); skips otherwise.
 */

const base = process.env.TEST_SYNC_SERVER ?? "";

const api = async (path: string, token: string | null, body: unknown): Promise<any> => {
  const res = await fetch(base + path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return res.json();
};

const waitFor = async (label: string, predicate: () => Promise<boolean>, timeoutMs = 15000) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`timeout waiting for: ${label}`);
};

describe.skipIf(!base)("multi-end convergence through a real server", () => {
  it("two replicas converge live; a third converges from the server alone", async () => {
    const { access_token: token } = await api("/auth/register", null, {
      email: `multiend-${Date.now()}@test.local`,
      password: "hunter22222",
    });
    const vault = await api("/api/vaults", token, { name: "multiend" });
    const wsUrl = base.replace(/^http/, "ws") + "/sync";
    const auth = () => new TextEncoder().encode(token);
    const connect = async () => {
      const adapter = await LoroDataAdapter.load(new MemorySyncStore(), vault.id);
      const client = await SyncClient.connect(adapter.vaultDocs(), {
        url: wsUrl,
        vaultId: vault.id,
        auth,
      });
      return { adapter, client };
    };

    const a = await connect();
    const b = await connect();
    try {
      // A creates; B must see the file appear and read A's content.
      await a.adapter.write("notes/hello.md", "from A");
      await waitFor(
        "B sees A's file",
        async () =>
          (await b.adapter.exists("notes/hello.md")) &&
          (await b.adapter.read("notes/hello.md")) === "from A",
      );

      // B edits; A must converge.
      await b.adapter.write("notes/hello.md", "from A — edited by B");
      await waitFor(
        "A sees B's edit",
        async () => (await a.adapter.read("notes/hello.md")) === "from A — edited by B",
      );

      // B renames; identity survives, so A sees the move with content intact.
      await b.adapter.rename("notes/hello.md", "renamed.md");
      await waitFor(
        "A sees the rename",
        async () =>
          (await a.adapter.exists("renamed.md", true)) &&
          !(await a.adapter.exists("notes/hello.md")) &&
          (await a.adapter.read("renamed.md")) === "from A — edited by B",
      );
    } finally {
      a.client.close();
      b.client.close();
    }

    // A cold, fresh device: everything must come from the server's storage.
    const c = await connect();
    try {
      await waitFor(
        "late C converges from backfill alone",
        async () => (await c.adapter.read("renamed.md")) === "from A — edited by B",
      );
      expect(await c.adapter.exists("notes/hello.md")).toBe(false);
    } finally {
      c.client.close();
    }
  }, 60000);
});
