/**
 * The system-menu wire shape — the template the renderer assembles
 * (SystemMenuBuilder / DesktopMenu) and the Electron main process feeds to
 * Menu.buildFromTemplate over the `set-menu` / `update-menu-items` channels.
 * Pure data, ONE definition for both sides of the seam: construction logic
 * stays in the renderer, consumption in main.
 */
export interface SystemMenuItem {
  id?: string;
  label?: string;
  type?: "separator" | "radio" | "checkbox";
  role?: string;
  accelerator?: string;
  registerAccelerator?: boolean;
  enabled?: boolean;
  visible?: boolean;
  checked?: boolean;
  appCommand?: string;
  before?: string[];
  submenu?: SystemMenuItem[];
}
