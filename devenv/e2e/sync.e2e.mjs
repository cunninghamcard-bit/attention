// The server-form acceptance: OFFICIAL loro clients against a real
// attentiond (echo shell + JWT accounts + syncd + Postgres). Run via
// ./run.sh, or by hand with SERVER already up. Expects SYNC_E2E_PASS.
import { LoroWebsocketClient } from "loro-websocket";
import { LoroAdaptor } from "loro-adaptors/loro";

const base = process.env.SERVER_URL ?? "http://127.0.0.1:8788";
const wsUrl = base.replace(/^http/, "ws") + "/sync";
const enc = new TextEncoder();

const api = async (path, { method = "POST", token, body, raw } = {}) => {
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(raw ? {} : { "content-type": "application/json" }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: raw ?? (body ? JSON.stringify(body) : undefined),
  });
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
  const type = res.headers.get("content-type") ?? "";
  return type.includes("json") ? res.json() : new Uint8Array(await res.arrayBuffer());
};

const waitFor = async (label, predicate, timeoutMs = 8000) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`timeout waiting for: ${label}`);
};

// 1. Account + vault over the HTTP face.
const email = `e2e-${Date.now()}@test.local`;
const { access_token: token } = await api("/auth/register", {
  body: { email, password: "hunter22222" },
});
const { access_token: again } = await api("/auth/login", {
  body: { email, password: "hunter22222" },
});
if (!again) throw new Error("login yielded no token");
const vault = await api("/api/vaults", { token, body: { name: "e2e" } });
const room = `${vault.id}/doc-1`;

// 2. Two devices converge live through the server.
const clientA = new LoroWebsocketClient({ url: wsUrl });
const clientB = new LoroWebsocketClient({ url: wsUrl });
await clientA.waitConnected();
await clientB.waitConnected();
const a = new LoroAdaptor();
const b = new LoroAdaptor();
await clientA.join({ roomId: room, crdtAdaptor: a, auth: enc.encode(token) });
await clientB.join({ roomId: room, crdtAdaptor: b, auth: enc.encode(token) });

a.getDoc().getText("content").insert(0, "Hello from A");
a.getDoc().commit();
await waitFor("B sees A", () => b.getDoc().getText("content").toString() === "Hello from A");

b.getDoc().getText("content").insert(12, " — B was here");
b.getDoc().commit();
const want = "Hello from A — B was here";
await waitFor("A sees B", () => a.getDoc().getText("content").toString() === want);

// 3. A LATE device converges from Postgres backfill alone.
const clientC = new LoroWebsocketClient({ url: wsUrl });
await clientC.waitConnected();
const c = new LoroAdaptor();
await clientC.join({ roomId: room, crdtAdaptor: c, auth: enc.encode(token) });
await waitFor("late C backfills", () => c.getDoc().getText("content").toString() === want);

// 4. A bad token must NOT get in.
const clientEvil = new LoroWebsocketClient({ url: wsUrl });
await clientEvil.waitConnected();
let rejected = false;
try {
  await Promise.race([
    clientEvil.join({ roomId: room, crdtAdaptor: new LoroAdaptor(), auth: enc.encode("forged") }),
    new Promise((_, rej) => setTimeout(() => rej(new Error("join not rejected")), 4000)),
  ]);
} catch {
  rejected = true;
}
if (!rejected) throw new Error("forged token was accepted");

// 5. Blobs round-trip with dedup semantics.
const payload = enc.encode("attachment-bytes");
await api(`/api/vaults/${vault.id}/blobs/deadbeef`, { method: "PUT", token, raw: payload });
const back = await api(`/api/vaults/${vault.id}/blobs/deadbeef`, { method: "GET", token });
if (new TextDecoder().decode(back) !== "attachment-bytes") throw new Error("blob mismatch");

console.log("SYNC_E2E_PASS");
console.log("A:", JSON.stringify(a.getDoc().getText("content").toString()));
console.log("C (late, from backfill):", JSON.stringify(c.getDoc().getText("content").toString()));
clientA.close(); clientB.close(); clientC.close(); clientEvil.close();
process.exit(0);
