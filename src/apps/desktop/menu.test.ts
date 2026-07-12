import { describe, expect, it, vi } from "vitest";
vi.mock("electron", () => ({ Menu: {}, BrowserWindow: class {} }));
import { toElectronTemplate } from "./menu";
import type { SystemMenuItem } from "@app/web/platform/desktop/SystemMenuBuilder";

describe("toElectronTemplate", () => {
  it("passes role/accelerator/type through for native items", () => {
    const template: SystemMenuItem[] = [
      { id: "copy", label: "Copy", role: "copy", accelerator: "Cmd+C" },
      { type: "separator" },
    ];
    expect(toElectronTemplate(template, () => {})).toEqual([
      { id: "copy", label: "Copy", role: "copy", accelerator: "Cmd+C" },
      { type: "separator" },
    ]);
  });

  it("maps appCommand to id and attaches a click handler", () => {
    const [item] = toElectronTemplate([{ label: "Toggle X", appCommand: "app:toggle-x" }], () => {});
    expect(item.id).toBe("app:toggle-x");
    expect(typeof item.click).toBe("function");
    // Non-BrowserWindow arg is ignored (guarded), so this must not throw.
    expect(() => item.click?.({} as never, undefined as never, {} as never)).not.toThrow();
  });

  it("recurses into submenus", () => {
    const template: SystemMenuItem[] = [
      { label: "File", submenu: [{ id: "new", label: "New", accelerator: "Cmd+N" }] },
    ];
    const out = toElectronTemplate(template, () => {});
    expect(out[0].submenu).toEqual([{ id: "new", label: "New", accelerator: "Cmd+N" }]);
  });
});
