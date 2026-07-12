import type { App } from "../../app/App";
import { MobileDrawer } from "./MobileDrawer";

export class MobileWorkspace {
  readonly leftDrawer: MobileDrawer | null;
  readonly rightDrawer: MobileDrawer | null;
  readonly drawer: MobileDrawer | null;

  constructor(readonly app: App) {
    this.leftDrawer = app.workspace.leftSplit instanceof MobileDrawer ? app.workspace.leftSplit : null;
    this.rightDrawer = app.workspace.rightSplit instanceof MobileDrawer ? app.workspace.rightSplit : null;
    this.drawer = this.leftDrawer;
  }

  attach(): void {
    document.body.classList.add("is-mobile-workspace");
    this.app.workspace.trigger("mobile-workspace-attach");
  }

  detach(): void {
    document.body.classList.remove("is-mobile-workspace");
    this.leftDrawer?.close();
    this.rightDrawer?.close();
    this.app.workspace.trigger("mobile-workspace-detach");
  }
}
