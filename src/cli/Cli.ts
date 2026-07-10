import type { App } from "../app/App";

/**
 * `App.cli` — the command-line registry and dispatcher, reconstructed from
 * real Obsidian's `app.cli` (decompiled `CA` class + `window.handleCli`).
 *
 * This is the ONE registry: the core app, internal plugins, and community
 * plugins all register through `app.cli.registerHandler` directly (the real
 * shape). The Electron main process owns the socket, vault routing,
 * and the CLI-enable gate; THIS class owns every command semantic — parsing,
 * the unknown-command error, fuzzy suggestions, required-parameter validation,
 * and the command table itself. The transport layer never learns a business
 * concept.
 *
 * Not reconstructed (no TUI): the interactive completion REPL and its
 * `__completions`/`__commands`/`__files` helpers. The socket protocol reserves
 * `tty:true` for that future branch.
 */

// Parsed parameters. Values are always strings: `key=value` keeps the value,
// a bare `flag` becomes the literal string "true" (faithful to real Obsidian —
// NOT a boolean).
export interface CliData {
  [key: string]: string | "true";
}

export interface CliFlag {
  // A "|"-separated option set, e.g. "json|tsv|csv". On a `format` flag it
  // enables the format shorthand; in usage it renders as `name=value`.
  value?: string;
  description: string;
  required?: boolean;
}

export type CliFlags = Record<string, CliFlag>;

export type CliHandler = (params: CliData) => string | Promise<string>;

// One registry entry — the real decompiled shape: the Map key is the command
// id, the record carries only handler/description/flags.
export interface CliCommand {
  description: string;
  flags: CliFlags | null;
  handler: CliHandler;
}

export class Cli {
  readonly handlers = new Map<string, CliCommand>();
  private app: App | null = null;

  // A duplicate id is an error, never a silent overwrite (faithful: the
  // registry refuses a second claim so a plugin can't shadow a core or peer
  // command).
  registerHandler(id: string, description: string, flags: CliFlags | null, handler: CliHandler): void {
    if (this.handlers.has(id)) {
      throw new Error(`Command "${id}" is already registered as a handler.`);
    }
    this.handlers.set(id, { description, flags, handler });
  }

  // Real shape: no handler → delete; with handler → delete only while it still
  // owns the slot (a peer re-registration is never clobbered by a late unload).
  unregisterHandler(id: string, handler?: CliHandler): void {
    const existing = this.handlers.get(id);
    if (!handler || (existing && existing.handler === handler)) this.handlers.delete(id);
  }

  // Installs `window.handleCli` (the main process reaches it via
  // executeJavaScript) and registers the builtins. Requests the main process
  // queued before the renderer was ready (`window.cliQueue`) drain only once
  // the workspace layout is ready — the real boundary: no command runs
  // against a half-built workspace.
  init(app: App): void {
    this.app = app;
    this.registerBuiltins();

    const target = globalThis as unknown as {
      handleCli?: (argv: string[]) => Promise<string>;
      cliQueue?: Array<{ argv: string[]; resolve: (out: string) => void; reject: (err: unknown) => void }> | null;
    };
    target.handleCli = (argv: string[]) => this.handleCli(argv);
    app.workspace.onLayoutReady(() => {
      const queued = target.cliQueue;
      if (Array.isArray(queued)) {
        for (const { argv, resolve, reject } of queued) this.handleCli(argv).then(resolve, reject);
      }
      target.cliQueue = null;
    });
  }

  // The dispatcher — the exact shape of real Obsidian's `window.handleCli`.
  // Returns the text the socket writes back; throws a plain string for the
  // main process to wrap as `Error: <string>` (the reference's catch clause).
  async handleCli(argv: string[]): Promise<string> {
    let command = argv[0];
    if (!command || command === "--help") command = "help";

    const params = parseParams(argv.slice(1));

    // Colon fallback: `daily:read` with no exact handler degrades to `daily`
    // when `daily` declares a `read` flag.
    if (!this.handlers.has(command)) {
      const colon = command.lastIndexOf(":");
      if (colon !== -1) {
        const parent = command.slice(0, colon);
        const suffix = command.slice(colon + 1);
        const parentCmd = this.handlers.get(parent);
        if (parentCmd && parentCmd.flags && suffix in parentCmd.flags) {
          command = parent;
          params[suffix] = "true";
        }
      }
    }

    const cmd = this.handlers.get(command);
    if (!cmd) {
      const suggestions = fuzzySuggest(command, [...this.handlers.keys()]);
      let message = `Command "${command}" not found.`;
      message += suggestions.length
        ? ` Did you mean: ${suggestions.join(", ")}?`
        : " It may require a plugin to be enabled.";
      throw message;
    }

    applyFormatShorthand(cmd.flags, params);
    validateRequired(command, cmd.flags, params);

    // `--copy` is a framework flag, handled centrally: strip it, run the
    // command, then mirror a non-empty result to the clipboard.
    const copy = params["--copy"] === "true";
    delete params["--copy"];
    const result = (await cmd.handler(params)) || "";
    if (copy && result) await navigator.clipboard.writeText(result);
    return result;
  }

  private registerBuiltins(): void {
    this.registerHandler(
      "help",
      "Show list of all available commands",
      { "<command>": { description: "Show help for a specific command" } },
      (args) => this.renderHelp(args),
    );
  }

  // `help` lists every command sorted by id (skipping the TUI-internal `__*`),
  // splitting developer commands into their own group; `help <command>` shows
  // one command (or its `<command>:*` family).
  private renderHelp(args: CliData): string {
    const requested = Object.keys(args).find((key) => args[key] === "true");
    const entries = [...this.handlers.entries()].sort((a, b) => a[0].localeCompare(b[0]));

    if (requested) {
      const matched = entries.filter(([id]) => id === requested || id.startsWith(`${requested}:`));
      if (matched.length === 0) {
        const suggestions = fuzzySuggest(requested, entries.map(([id]) => id));
        let message = `No commands matching "${requested}".`;
        if (suggestions.length) message += ` Did you mean: ${suggestions.join(", ")}?`;
        return message;
      }
      return matched.map(([id, cmd]) => formatCommand(id, cmd)).join("\n");
    }

    const main: string[] = [];
    const developer: string[] = [];
    for (const [id, cmd] of entries) {
      if (id.startsWith("__")) continue;
      const block = formatCommand(id, cmd);
      (id.startsWith("dev:") || id === "devtools" || id === "eval" ? developer : main).push(block);
    }
    let out = "Arkloop CLI\n\nUsage: arkloop <command> [options]\n\nCommands:\n" + main.join("\n");
    if (developer.length) out += "\n\nDeveloper:\n" + developer.join("\n");
    return out;
  }
}

// key=value keeps the value; a bare token becomes "true".
function parseParams(tokens: string[]): CliData {
  const params: CliData = {};
  for (const token of tokens) {
    const eq = token.indexOf("=");
    if (eq !== -1) params[token.slice(0, eq)] = token.slice(eq + 1);
    else params[token] = "true";
  }
  return params;
}

// `files json` or `files --json` -> `format=json`, with the shorthand key
// removed. Only fires for a `format` flag that declares its option set.
function applyFormatShorthand(flags: CliFlags | null, params: CliData): void {
  const format = flags?.format;
  if (!format?.value || params.format) return;
  for (const option of format.value.split("|")) {
    if (params[option] || params[`--${option}`]) {
      params.format = option;
      delete params[option];
      delete params[`--${option}`];
      break;
    }
  }
}

function validateRequired(command: string, flags: CliFlags | null, params: CliData): void {
  const missing: string[] = [];
  for (const [name, flag] of Object.entries(flags ?? {})) {
    if (flag.required && !(name in params)) missing.push(flag.value ? `${name}=${flag.value}` : name);
  }
  if (missing.length > 0) {
    throw `Missing required parameter: ${missing.join(", ")}\nUsage: ${command} ${formatUsage(flags)}`;
  }
}

// One flag: `name=value` (required) or `[name=value]` (optional), space-joined.
function formatUsage(flags: CliFlags | null): string {
  return Object.entries(flags ?? {})
    .map(([name, flag]) => {
      const atom = flag.value ? `${name}=${flag.value}` : name;
      return flag.required ? atom : `[${atom}]`;
    })
    .join(" ");
}

// A help block: the command line, then one indented line per flag. A flag
// with a value domain renders as `name=value`; required flags are marked.
function formatCommand(id: string, cmd: CliCommand): string {
  let block = `  ${id.padEnd(20)}  ${cmd.description}`;
  for (const [name, flag] of Object.entries(cmd.flags ?? {})) {
    const atom = flag.value ? `${name}=${flag.value}` : name;
    const required = flag.required ? " (required)" : "";
    block += `\n    ${atom.padEnd(18)} - ${flag.description}${required}`;
  }
  return block;
}

// Fuzzy suggest (real `wA`): prefix (0) > substring (1) > Levenshtein<=3 (2+d);
// everything else drops. Sorted best-first, capped at `max`.
export function fuzzySuggest(query: string, candidates: string[], max = 3): string[] {
  const q = query.toLowerCase();
  return candidates
    .map((cmd) => {
      const c = cmd.toLowerCase();
      if (c.startsWith(q)) return { cmd, score: 0 };
      if (c.includes(q)) return { cmd, score: 1 };
      const d = levenshtein(q, c);
      return { cmd, score: d <= 3 ? 2 + d : 999 };
    })
    .filter((entry) => entry.score < 999)
    .sort((a, b) => a.score - b.score)
    .slice(0, max)
    .map((entry) => entry.cmd);
}

function levenshtein(a: string, b: string): number {
  const row = Array.from({ length: a.length + 1 }, (_, i) => i);
  for (let j = 1; j <= b.length; j++) {
    let prev = row[0]++;
    for (let i = 1; i <= a.length; i++) {
      const current = row[i];
      row[i] = Math.min(row[i] + 1, row[i - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = current;
    }
  }
  return row[a.length];
}
