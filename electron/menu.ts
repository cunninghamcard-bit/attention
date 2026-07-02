import { Menu, BrowserWindow, type MenuItemConstructorOptions } from "electron";
import type { SystemMenuItem } from "../src/desktop/SystemMenuBuilder";

/**
 * Native menu from a renderer-supplied template (reverse note `set-menu` +
 * `Qe`). Role items are handled natively by Electron; `appCommand` items click
 * through to `app.commands.executeCommandById` in the focused window.
 *
 * The converter is pure (click injected) and tested; registerMenu wires the
 * real Electron Menu.
 */
export function toElectronTemplate(
  items: SystemMenuItem[],
  runCommand: (win: BrowserWindow, commandId: string) => void,
): MenuItemConstructorOptions[] {
  return items.map((item) => {
    const out: MenuItemConstructorOptions = {};
    if (item.id) out.id = item.id;
    if (item.label) out.label = item.label;
    if (item.type) out.type = item.type;
    if (item.role) out.role = item.role as MenuItemConstructorOptions["role"];
    if (item.accelerator) out.accelerator = item.accelerator;
    if (item.enabled !== undefined) out.enabled = item.enabled;
    if (item.visible !== undefined) out.visible = item.visible;
    if (item.checked !== undefined) out.checked = item.checked;
    if (item.appCommand) {
      out.id = item.appCommand;
      const commandId = item.appCommand;
      out.click = (_menuItem, win) => {
        if (win instanceof BrowserWindow) runCommand(win, commandId);
      };
    }
    if (item.submenu) out.submenu = toElectronTemplate(item.submenu, runCommand);
    return out;
  });
}

/** Real `set-menu` handler: build and apply the menu for the sender window. */
export function applyMenu(win: BrowserWindow, template: SystemMenuItem[]): void {
  const menu = Menu.buildFromTemplate(
    toElectronTemplate(template, (target, commandId) => {
      void target.webContents.executeJavaScript(
        `app.commands.executeCommandById(${JSON.stringify(commandId)})`,
      );
    }),
  );
  // macOS uses a single application menu; other platforms attach per-window.
  if (process.platform === "darwin") Menu.setApplicationMenu(menu);
  else win.setMenu(menu);
}

/** Real `update-menu-items`: patch enabled/checked/visible on the live menu. */
export function updateMenuItems(
  updates: Array<{ itemId: string; eState: Record<string, unknown> }>,
): void {
  const menu = Menu.getApplicationMenu();
  if (!menu) return;
  for (const { itemId, eState } of updates) {
    const item = menu.getMenuItemById(itemId);
    if (!item) continue;
    for (const key of Object.keys(eState)) {
      (item as unknown as Record<string, unknown>)[key] = eState[key];
    }
  }
}
