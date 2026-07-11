import { describe, expect, it, vi } from "vitest";
import { createTerminalFocusScope, isSystemChord } from "./TerminalView";
import { normalizedKeymapEventFromKeyboardEvent } from "../hotkeys/Scope";

function key(init: KeyboardEventInit & { code?: string }): KeyboardEvent {
  return new KeyboardEvent("keydown", init);
}

function handle(scope: ReturnType<typeof createTerminalFocusScope>, evt: KeyboardEvent) {
  return scope.handleKey(evt, normalizedKeymapEventFromKeyboardEvent(evt));
}

describe("createTerminalFocusScope", () => {
  it("lets plain typing and Ctrl combos flow to the terminal (undefined)", () => {
    const dispatch = vi.fn();
    const scope = createTerminalFocusScope(dispatch);
    expect(handle(scope, key({ key: "a", code: "KeyA" }))).toBeUndefined();
    expect(handle(scope, key({ key: "c", code: "KeyC", ctrlKey: true }))).toBeUndefined();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("routes Cmd combos to the app and consumes them", () => {
    const dispatch = vi.fn();
    const scope = createTerminalFocusScope(dispatch);
    const evt = key({ key: "p", code: "KeyP", metaKey: true });
    expect(handle(scope, evt)).toBe(false);
    expect(dispatch).toHaveBeenCalledOnce();
  });

  it("consumes unbound Cmd combos too, so ghostty never sends SUPER sequences", () => {
    const scope = createTerminalFocusScope(() => undefined);
    expect(handle(scope, key({ key: "g", code: "KeyG", metaKey: true }))).toBe(false);
  });

  it("leaves Cmd+C / Cmd+V with the terminal for copy/paste", () => {
    const dispatch = vi.fn();
    const scope = createTerminalFocusScope(dispatch);
    expect(handle(scope, key({ key: "c", code: "KeyC", metaKey: true }))).toBeUndefined();
    expect(handle(scope, key({ key: "v", code: "KeyV", metaKey: true }))).toBeUndefined();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("leaves system chords untouched so native menu accelerators still fire", () => {
    const dispatch = vi.fn();
    const scope = createTerminalFocusScope(dispatch);
    // undefined = no preventDefault from Keymap → Electron menu roles (quit/
    // hide/minimize) keep working; the surface capture listener keeps these
    // away from ghostty separately.
    expect(handle(scope, key({ key: "q", code: "KeyQ", metaKey: true }))).toBeUndefined();
    expect(handle(scope, key({ key: "h", code: "KeyH", metaKey: true }))).toBeUndefined();
    expect(handle(scope, key({ key: "h", code: "KeyH", metaKey: true, altKey: true }))).toBeUndefined();
    expect(handle(scope, key({ key: "m", code: "KeyM", metaKey: true }))).toBeUndefined();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("classifies system chords strictly (meta without ctrl, fixed key set)", () => {
    expect(isSystemChord(key({ code: "KeyQ", metaKey: true }))).toBe(true);
    expect(isSystemChord(key({ code: "Backquote", metaKey: true }))).toBe(true);
    expect(isSystemChord(key({ code: "KeyQ", metaKey: true, ctrlKey: true }))).toBe(false);
    expect(isSystemChord(key({ code: "KeyQ" }))).toBe(false);
    expect(isSystemChord(key({ code: "KeyP", metaKey: true }))).toBe(false);
  });
});
