import { afterEach, describe, expect, it, vi } from "vitest";
import { Cli, fuzzySuggest, type CliData } from "./Cli";

// Clean the globals `init` installs so tests never leak into each other.
afterEach(() => {
  const target = globalThis as unknown as { handleCli?: unknown; cliQueue?: unknown };
  delete target.handleCli;
  delete target.cliQueue;
});

// A Cli with the real builtins (via init, which needs no real App for help)
// plus a couple of stub commands. The dispatcher, parser, and help are pure.
function makeCli(): Cli {
  const cli = new Cli();
  cli.init({} as never);
  cli.registerHandler(
    "files",
    "List files in the vault",
    { ext: { description: "extension" }, total: { description: "count" }, format: { value: "json|tsv|csv", description: "output format" } },
    (args) => `files ${JSON.stringify(args)}`,
  );
  cli.registerHandler(
    "search",
    "Search vault for text",
    { query: { description: "query", required: true }, format: { value: "text|json", description: "output format" } },
    (args) => `search ${JSON.stringify(args)}`,
  );
  cli.registerHandler("daily", "Open daily note", { read: { description: "read it" } }, (args) => `daily ${JSON.stringify(args)}`);
  return cli;
}

describe("Cli parsing", () => {
  it("key=value keeps the value; a bare flag becomes the string \"true\"", async () => {
    const out = await makeCli().handleCli(["files", "ext=ts", "total"]);
    expect(JSON.parse(out.slice("files ".length))).toEqual({ ext: "ts", total: "true" });
  });

  it("empty argv and --help both resolve to help", async () => {
    const cli = makeCli();
    const help = await cli.handleCli(["help"]);
    expect(await cli.handleCli([])).toBe(help);
    expect(await cli.handleCli(["--help"])).toBe(help);
  });
});

describe("Cli format shorthand", () => {
  it("`files json` becomes format=json with the shorthand key removed", async () => {
    const out = await makeCli().handleCli(["files", "json"]);
    const args = JSON.parse(out.slice("files ".length)) as CliData;
    expect(args.format).toBe("json");
    expect(args.json).toBeUndefined();
  });

  it("also accepts the --json spelling", async () => {
    const out = await makeCli().handleCli(["files", "--tsv"]);
    const args = JSON.parse(out.slice("files ".length)) as CliData;
    expect(args.format).toBe("tsv");
    expect(args["--tsv"]).toBeUndefined();
  });
});

describe("Cli colon fallback", () => {
  it("daily:read folds into daily with read=true when daily declares a read flag", async () => {
    const out = await makeCli().handleCli(["daily:read"]);
    const args = JSON.parse(out.slice("daily ".length)) as CliData;
    expect(args.read).toBe("true");
  });

  it("an unknown colon command with no matching parent flag stays unknown", async () => {
    // `bogus` is not a `daily` flag, so it never folds into `daily` — it is
    // dispatched as-is and rejected as an unknown command.
    await expect(makeCli().handleCli(["daily:bogus"])).rejects.toMatch(/^Command "daily:bogus" not found\./);
  });
});

describe("Cli unknown command", () => {
  it("suggests near matches (fuzzy) and throws a plain string, best match first", async () => {
    await expect(makeCli().handleCli(["fils"])).rejects.toMatch(/^Command "fils" not found\. Did you mean: files/);
  });

  it("falls back to the plugin hint when nothing is close", async () => {
    await expect(makeCli().handleCli(["zzzzzz"])).rejects.toBe(
      'Command "zzzzzz" not found. It may require a plugin to be enabled.',
    );
  });
});

describe("Cli required parameters", () => {
  it("throws Missing required parameter with a usage line", async () => {
    await expect(makeCli().handleCli(["search"])).rejects.toBe(
      "Missing required parameter: query\nUsage: search query [format=text|json]",
    );
  });

  it("runs when the required parameter is present", async () => {
    const out = await makeCli().handleCli(["search", "query=hello"]);
    expect(JSON.parse(out.slice("search ".length))).toEqual({ query: "hello" });
  });
});

describe("Cli --copy", () => {
  it("mirrors the result to the clipboard and strips the flag from args", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const out = await makeCli().handleCli(["files", "--copy"]);
    const args = JSON.parse(out.slice("files ".length)) as CliData;
    expect(args["--copy"]).toBeUndefined();
    expect(writeText).toHaveBeenCalledWith(out);
    vi.unstubAllGlobals();
  });
});

describe("Cli help output", () => {
  it("lists commands sorted, skips __* internals, groups developer commands", async () => {
    const cli = makeCli();
    cli.registerHandler("__completions", "internal", {}, () => "");
    cli.registerHandler("dev:reload", "Reload for developers", {}, () => "");
    const help = await cli.handleCli(["help"]);
    expect(help).toContain("Arkloop CLI");
    expect(help).toContain("Usage: arkloop <command> [options]");
    expect(help).not.toContain("__completions");
    expect(help).toContain("Developer:");
    expect(help.indexOf("dev:reload")).toBeGreaterThan(help.indexOf("Developer:"));
    // sorted: daily before files before search in the main group
    expect(help.indexOf("daily")).toBeLessThan(help.indexOf("files"));
    expect(help.indexOf("files")).toBeLessThan(help.indexOf("search"));
  });

  it("help <command> shows one command and its subcommand family", async () => {
    const cli = makeCli();
    cli.registerHandler("daily:path", "Get daily note path", {}, () => "");
    const help = await cli.handleCli(["help", "daily"]);
    expect(help).toContain("daily");
    expect(help).toContain("daily:path");
    expect(help).not.toContain("files");
  });
});

describe("Cli.init", () => {
  it("installs window.handleCli and drains cliQueue", async () => {
    const resolve = vi.fn();
    const target = globalThis as unknown as {
      handleCli?: unknown;
      cliQueue?: Array<{ argv: string[]; resolve: (o: string) => void; reject: (e: unknown) => void }>;
    };
    target.cliQueue = [{ argv: ["help"], resolve, reject: () => {} }];
    const cli = new Cli();
    cli.init({} as never);
    expect(typeof target.handleCli).toBe("function");
    await Promise.resolve();
    await Promise.resolve();
    expect(resolve).toHaveBeenCalledOnce();
    expect(target.cliQueue).toEqual([]);
    delete target.handleCli;
    delete target.cliQueue;
  });
});

describe("Cli registration", () => {
  it("refuses a duplicate id instead of silently overwriting", () => {
    const cli = makeCli();
    expect(() => cli.registerHandler("files", "dup", {}, () => "")).toThrow(
      'Command "files" is already registered as a handler.',
    );
  });

  it("unregisterHandler only removes the slot when the handler still owns it", () => {
    const cli = new Cli();
    const first = () => "first";
    cli.registerHandler("x", "d", {}, first);
    cli.unregisterHandler("x", () => "other"); // different handler → no-op
    expect(cli.handlers.has("x")).toBe(true);
    cli.unregisterHandler("x", first);
    expect(cli.handlers.has("x")).toBe(false);
  });
});

describe("fuzzySuggest", () => {
  it("ranks prefix over substring over edit-distance", () => {
    expect(fuzzySuggest("fil", ["files", "profile", "folders"])).toEqual(["files", "profile"]);
  });

  it("drops candidates beyond edit distance 3", () => {
    expect(fuzzySuggest("xyz", ["files", "search"])).toEqual([]);
  });
});
