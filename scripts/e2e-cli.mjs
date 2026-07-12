#!/usr/bin/env node
// True desktop e2e for the CLI: spawns the PRIMARY Arkloop instance on a
// throwaway vault + userData + socket, then drives it through real
// SECOND-INSTANCE invocations (the same `electron main.cjs <argv>` path a
// user types) and asserts exact outputs. Fully hermetic — never touches the
// real profile, vaults, or a running instance.
//
//   pnpm run build && pnpm run build:electron && pnpm run e2e:cli
import { execFile, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const electron = join(root, "node_modules", ".bin", "electron");
const mainJs = join(root, "dist-electron", "main.cjs");
if (!existsSync(mainJs)) {
  console.error("dist-electron/main.cjs missing — run: pnpm run build && pnpm run build:electron");
  process.exit(2);
}

const base = mkdtempSync(join(tmpdir(), "arkloop-e2e-"));
const vault = join(base, "vault");
mkdirSync(join(vault, "Sub"), { recursive: true });
writeFileSync(join(vault, "Note.md"), "---\ntags: [alpha]\n---\n# Top\nHello [[Doc]] world.\n#alpha #beta\n");
writeFileSync(join(vault, "Doc.md"), "# A\n## B\nbody\n");
writeFileSync(join(vault, "Sub/Inner.md"), "deep [[Note]]\n");

const env = {
  ...process.env,
  ARKLOOP_VAULT_PATH: vault,
  ARKLOOP_USER_DATA: join(base, "userData"),
  ARKLOOP_CLI_SOCKET: join(base, "cli.sock"),
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A second-instance CLI invocation — the real user-facing path.
async function cli(...argv) {
  const { stdout } = await execFileAsync(electron, [mainJs, ...argv], { env, encoding: "utf8", timeout: 20000 });
  return stdout;
}

// [argv, expected] — expected is an exact string, or a function of the output.
const CHECKS = [
  [["vault", "info=files"], "3\n"],
  [["files"], "Doc.md\nNote.md\nSub/Inner.md\n"],
  [["folders"], "/\nSub\n"],
  [["read", "file=Doc"], "# A\n## B\nbody\n"],
  [["tags", "counts"], "#alpha\t2\n#beta\t1\n"],
  [["backlinks", "file=Doc"], "Note.md\n"],
  [["outline", "file=Doc", "format=md"], "# A\n## B\n"],
  [["search", "query=hello"], "Note.md\n"],
  [["create", "name=W", "content=x\\ny"], "Created: W.md\n"],
  [["read", "file=W"], "x\ny\n"],
  [["append", "file=W", "content=z"], "Appended to: W.md\n"],
  [["read", "file=W"], "x\ny\nz\n"],
  [["files", "total"], "4\n"],
  [["tags:total"], "2\n"], // colon sugar through the wire
  // Errors are still exit 0 with an Error: line (the real contract).
  [["nope"], (out) => out.startsWith('Error: Command "nope" not found.')],
  [["read", "path=Missing.md"], 'Error: File "Missing.md" not found.\n'],
  [["daily"], (out) => out.startsWith('Error: Command "daily" not found.')],
  [["help"], (out) => out.startsWith("Arkloop CLI\n\nUsage: arkloop <command> [options]\n\nOptions:\n  vault=<name>")],
];

let primary = null;
let failures = 0;
try {
  primary = spawn(electron, [mainJs], { env, stdio: "ignore" });

  // Boot: wait for the socket, then for the vault index to settle.
  const deadline = Date.now() + 40000;
  while (!existsSync(env.ARKLOOP_CLI_SOCKET)) {
    if (primary.exitCode !== null) throw new Error(`primary exited early (${primary.exitCode})`);
    if (Date.now() > deadline) throw new Error("primary never bound the CLI socket");
    await sleep(300);
  }
  while ((await cli("vault", "info=files").catch(() => "")) !== "3\n") {
    if (Date.now() > deadline) throw new Error("vault never finished indexing");
    await sleep(500);
  }

  for (const [argv, expected] of CHECKS) {
    // Metadata-backed commands settle asynchronously after writes; retry
    // briefly before declaring a mismatch.
    const until = Date.now() + 10000;
    let out;
    let pass = false;
    for (;;) {
      out = await cli(...argv).catch((error) => `<<invocation failed: ${error.message}>>`);
      pass = typeof expected === "function" ? Boolean(expected(out)) : out === expected;
      if (pass || Date.now() > until) break;
      await sleep(500);
    }
    console.log(`${pass ? "PASS" : "FAIL"}  ${argv.join(" ")}`);
    if (!pass) {
      failures += 1;
      console.log(`      expected: ${typeof expected === "function" ? "<predicate>" : JSON.stringify(expected)}`);
      console.log(`      got:      ${JSON.stringify(out)}`);
    }
  }
} catch (error) {
  console.error("e2e aborted:", error.message);
  failures += 1;
} finally {
  if (primary && primary.exitCode === null) {
    primary.kill("SIGTERM");
    await Promise.race([new Promise((r) => primary.once("exit", r)), sleep(5000)]);
    if (primary.exitCode === null) primary.kill("SIGKILL");
  }
  rmSync(base, { recursive: true, force: true });
}

console.log(failures === 0 ? `\nOK — ${CHECKS.length} checks over the real two-process wire` : `\n${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
