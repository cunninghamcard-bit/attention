import { describe, expect, it, vi } from "vitest";
import { dispatchCli, type CliDispatchDeps } from "@desktop/cli/CliDispatch";

function makeDeps(overrides: Partial<CliDispatchDeps> = {}): CliDispatchDeps {
  return {
    isCliEnabled: () => true,
    openStarter: vi.fn(),
    handleUrl: (url) => `Processed URI ${url}`,
    executeCliRequest: vi.fn(async (argv) => `ran ${argv.join(",")}`),
    ...overrides,
  };
}

describe("dispatchCli", () => {
  it("runs a command in the workspace renderer", async () => {
    // Real routed to a vault first (vault=<name> / cwd containment / most
    // recent); the one-window form hands the argv straight over.
    const deps = makeDeps();
    const out = await dispatchCli({ argv: ["files", "ext=ts"], tty: false, cwd: "/x" }, deps);
    expect(out).toBe("ran files,ext=ts");
    expect(deps.openStarter).not.toHaveBeenCalled();
  });

  it("opens the workspace window on empty non-tty argv, then still dispatches (help)", async () => {
    const deps = makeDeps();
    await dispatchCli({ argv: [], tty: false, cwd: "/tmp" }, deps);
    expect(deps.openStarter).toHaveBeenCalledOnce();
    expect(deps.executeCliRequest).toHaveBeenCalledWith([]);
  });

  it("does not open the window for a tty request", async () => {
    const deps = makeDeps();
    await dispatchCli({ argv: [], tty: true, cwd: "/tmp" }, deps);
    expect(deps.openStarter).not.toHaveBeenCalled();
  });

  it("short-circuits a trailing attention:// URL to the URL router", async () => {
    const deps = makeDeps();
    const out = await dispatchCli(
      { argv: ["attention://open?file=A"], tty: false, cwd: "/x" },
      deps,
    );
    expect(out).toBe("Processed URI attention://open?file=A");
    expect(deps.executeCliRequest).not.toHaveBeenCalled();
  });

  it("returns the not-enabled message when the CLI is disabled, but still handles URLs", async () => {
    const deps = makeDeps({ isCliEnabled: () => false });
    const out = await dispatchCli({ argv: ["vault"], tty: false, cwd: "/x" }, deps);
    expect(out).toBe(
      "Command line interface is not enabled. Please turn it on in Settings > General > Advanced.",
    );
    expect(deps.executeCliRequest).not.toHaveBeenCalled();
    // URLs bypass the gate (real et short-circuits before the C.cli check).
    const url = await dispatchCli(
      { argv: ["attention://open?file=A"], tty: false, cwd: "/x" },
      deps,
    );
    expect(url).toBe("Processed URI attention://open?file=A");
  });
});
