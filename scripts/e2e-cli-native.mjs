#!/usr/bin/env node
/**
 * Input: node:child_process, node:fs, node:os, node:path, node:url, node:util
 * Output: None
 * Pos: Application code
 *
 * 🔄 Self-reference: When this file changes, update this header
 */

// The CLI e2e of scripts/e2e-cli.mjs over the Go reader (RFC 0001 roadmap
// P2): a headless attention on a throwaway mount, config folder, socket and
// trash, driven by real second-process invocations, every output checked
// exactly. The same vault and checks as the TS app's, its paths
// mount-prefixed (docs/cli-deviations.md).
//
//   (cd native && go build -o bin/attention ./cmd/attention)
//   RUTIS_HOST=/path/to/rutis-host node scripts/e2e-cli-native.mjs
import { execFile, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bin = process.env.ATTENTION_BIN ?? join(root, "native", "bin", "attention");
if (!existsSync(bin)) {
  console.error(`${bin} missing — run: (cd native && go build -o bin/attention ./cmd/attention)`);
  process.exit(2);
}

const base = mkdtempSync(join(tmpdir(), "attention-e2e-native-"));
const vault = join(base, "vault");
mkdirSync(join(vault, "Sub"), { recursive: true });
writeFileSync(
  join(vault, "Note.md"),
  "---\ntags: [alpha]\n---\n# Top\nHello [[Doc]] world.\n#alpha #beta\n",
);
writeFileSync(join(vault, "Doc.md"), "# A\n## B\nbody\n");
writeFileSync(join(vault, "Sub/Inner.md"), "deep [[Note]]\n");

const env = {
  ...process.env,
  ATTENTION_CONFIG_DIR: join(base, "config"),
  ATTENTION_SOCKET: join(base, "cli.sock"),
  XDG_DATA_HOME: join(base, "data"), // the trash
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function cli(...argv) {
  const { stdout } = await execFileAsync(bin, argv, { env, encoding: "utf8", timeout: 20000 });
  return stdout;
}

// [argv, expected] — expected is an exact string, or a function of the output.
const CHECKS = [
  [["vault", "info=files"], "3\n"],
  [["files"], "vault/Doc.md\nvault/Note.md\nvault/Sub/Inner.md\n"],
  [["folders"], "vault\nvault/Sub\n"],
  [["read", "file=Doc"], "# A\n## B\nbody\n"],
  [["tags", "counts"], "#alpha\t2\n#beta\t1\n"],
  [["backlinks", "file=Doc"], "vault/Note.md\n"],
  [["outline", "file=Doc", "format=md"], "# A\n## B\n"],
  [["search", "query=hello"], "vault/Note.md\n"],
  [["create", "name=W", "content=x\\ny"], "Created: vault/W.md\n"],
  [["read", "file=W"], "x\ny\n"],
  [["append", "file=W", "content=z"], "Appended to: vault/W.md\n"],
  [["read", "file=W"], "x\ny\nz\n"],
  [["files", "total"], "4\n"],
  [["tags:total"], "2\n"], // colon sugar through the wire
  [["nope"], (out) => out.startsWith('Error: Command "nope" not found.')],
  [["read", "path=Missing.md"], 'Error: File "Missing.md" not found.\n'],
  [["daily"], (out) => out.startsWith('Error: Command "daily" not found.')],
  [["help"], (out) => out.startsWith("Usage: attention <command>")],
  // The reader's own, past the TS list.
  [["links", "file=Inner"], "vault/Note.md\n"],
  [["unresolved"], "No unresolved links found.\n"],
  [["delete", "file=W"], "Moved to trash: vault/W.md\n"],
  [["files", "total"], "3\n"],
];

let primary = null;
let failures = 0;
try {
  primary = spawn(bin, ["--profile", "headless", vault], { env, stdio: "ignore" });
  const deadline = Date.now() + 40000;
  while ((await cli("vault", "info=files").catch(() => "")) !== "3\n") {
    if (primary.exitCode !== null) throw new Error(`primary exited early (${primary.exitCode})`);
    if (Date.now() > deadline) throw new Error("the reader never answered");
    await sleep(300);
  }
  for (const [argv, expected] of CHECKS) {
    // The index follows writes through fs/changed: retry briefly.
    const until = Date.now() + 5000;
    let out;
    let pass = false;
    for (;;) {
      out = await cli(...argv).catch((error) => `<<invocation failed: ${error.message}>>`);
      pass = typeof expected === "function" ? Boolean(expected(out)) : out === expected;
      if (pass || Date.now() > until) break;
      await sleep(200);
    }
    console.log(`${pass ? "PASS" : "FAIL"}  ${argv.join(" ")}`);
    if (!pass) {
      failures += 1;
      console.log(
        `      expected: ${typeof expected === "function" ? "<predicate>" : JSON.stringify(expected)}`,
      );
      console.log(`      got:      ${JSON.stringify(out)}`);
    }
  }
} catch (error) {
  console.error("e2e aborted:", error.message);
  failures += 1;
} finally {
  await cli("quit").catch(() => "");
  if (primary) {
    await Promise.race([new Promise((r) => primary.once("exit", r)), sleep(10000)]);
    if (primary.exitCode === null) primary.kill("SIGTERM");
  }
  rmSync(base, { recursive: true, force: true });
}

console.log(
  failures === 0
    ? `\nOK — ${CHECKS.length} checks over the real two-process wire`
    : `\n${failures} failure(s)`,
);
process.exit(failures === 0 ? 0 : 1);
