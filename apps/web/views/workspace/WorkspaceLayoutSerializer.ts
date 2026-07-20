import type { Workspace } from "./Workspace";
import { WorkspaceLeaf } from "./WorkspaceLeaf";
import { WorkspaceParent } from "./WorkspaceParent";
import { WorkspaceSplit } from "./WorkspaceSplit";
import { WorkspaceSidedock } from "./WorkspaceSidedock";
import { WorkspaceTabs } from "./WorkspaceTabs";
import { WorkspaceFloating } from "./WorkspaceFloating";
import { WorkspaceWindow } from "./WorkspaceWindow";
import { MobileDrawer } from "../../platform/mobile/MobileDrawer";
import type { WorkspaceItem } from "./WorkspaceItem";
import type { WorkspaceLayout, WorkspaceLayoutNode } from "./WorkspaceLayout";

export class WorkspaceLayoutSerializer {
  serialize(workspace: Workspace): WorkspaceLayout {
    const layout: WorkspaceLayout = {
      main: this.serializeItem(workspace.rootSplit),
      left: this.serializeItem(workspace.leftSplit),
      right: this.serializeItem(workspace.rightSplit),
      "left-ribbon": workspace.leftRibbon.serialize(),
      active: workspace.activeLeaf?.id,
    };
    if (workspace.floatingSplit.children.length > 0)
      layout.floating = this.serializeItem(workspace.floatingSplit);
    return layout;
  }

  serializeItem(item: WorkspaceItem): WorkspaceLayoutNode {
    if (item instanceof WorkspaceLeaf) {
      return {
        id: item.id,
        type: "leaf",
        state: item.getViewState(),
        ...(item.group ? { group: item.group } : {}),
        ...(item.pinned ? { pinned: item.pinned } : {}),
        ...(item.dimension == null ? {} : { dimension: item.dimension }),
      };
    }

    if (item instanceof WorkspaceTabs) {
      return {
        id: item.id,
        type: "tabs",
        ...(item.currentTab > 0 ? { currentTab: item.currentTab } : {}),
        ...(item.isStacked ? { stacked: true } : {}),
        children: item.children.map((child) => this.serializeItem(child)),
        ...(item.dimension == null ? {} : { dimension: item.dimension }),
      };
    }

    if (item instanceof MobileDrawer) {
      return {
        id: item.id,
        type: "mobile-drawer",
        currentTab: item.currentTab,
        ...(item.isPinned ? { pinned: true } : {}),
        children: item.children.map((child) => this.serializeItem(child)),
        ...(item.dimension == null ? {} : { dimension: item.dimension }),
      };
    }

    if (item instanceof WorkspaceWindow) {
      item.updateSize();
      return {
        id: item.id,
        type: "window",
        direction: item.direction,
        children: item.children.map((child) => this.serializeItem(child)),
        ...(item.x == null ? {} : { x: item.x }),
        ...(item.y == null ? {} : { y: item.y }),
        ...(item.width == null ? {} : { width: item.width }),
        ...(item.height == null ? {} : { height: item.height }),
        ...(item.maximize ? { maximize: true } : {}),
        ...(item.zoom == null ? {} : { zoom: item.zoom }),
        ...(item.dimension == null ? {} : { dimension: item.dimension }),
      };
    }

    if (item instanceof WorkspaceFloating) {
      return {
        id: item.id,
        type: "floating",
        children: item.children.map((child) => this.serializeItem(child)),
        ...(item.dimension == null ? {} : { dimension: item.dimension }),
      };
    }

    if (item instanceof WorkspaceSplit) {
      return {
        id: item.id,
        type: "split",
        direction: item.direction,
        children: item.children.map((child) => this.serializeItem(child)),
        ...(item instanceof WorkspaceSidedock && item.collapsed ? { collapsed: true } : {}),
        ...(item instanceof WorkspaceSidedock && item.width != null ? { width: item.width } : {}),
        ...(item.dimension == null ? {} : { dimension: item.dimension }),
      };
    }

    if (item instanceof WorkspaceParent) {
      return {
        id: item.id,
        type: "split",
        direction: "vertical",
        children: item.children.map((child) => this.serializeItem(child)),
      };
    }

    return { id: item.id, type: "leaf", state: { type: "empty" } };
  }
}
