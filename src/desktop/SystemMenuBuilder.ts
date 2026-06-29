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

export class SystemMenuBuilder {
  private menu: SystemMenuItem[] = [];

  buildDefaultMenu(): SystemMenuItem[] {
    this.menu = [
      { id: "app", label: "Obsidian", submenu: [{ id: "about", label: "About Obsidian", role: "about" }] },
      { id: "file", label: "File", submenu: [{ id: "new-note", label: "New note", accelerator: "CmdOrCtrl+N" }] },
      { id: "edit", label: "Edit", submenu: [{ id: "copy", label: "Copy", role: "copy" }, { id: "paste", label: "Paste", role: "paste" }] },
      { id: "view", label: "View", submenu: [{ id: "reload", label: "Reload", role: "reload" }] },
    ];
    return this.menu;
  }

  setMenu(menu: SystemMenuItem[]): void {
    this.menu = menu;
  }

  getMenu(): readonly SystemMenuItem[] {
    return this.menu;
  }
}
