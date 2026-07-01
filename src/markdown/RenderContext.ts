import type { App } from "../app/App";
import type { HoverParent, HoverPopover } from "../ui/Popover";

export class RenderContext implements HoverParent {
  hoverPopover: HoverPopover | null = null;

  constructor(readonly app: App | null, readonly sourcePath: string, readonly containerEl: HTMLElement) {
  }
}
