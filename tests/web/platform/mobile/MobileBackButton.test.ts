import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "@web/app/App";
import { resetActiveWindow } from "@web/dom/ActiveDocument";
import {
  closeTopActiveCloseable,
  getActiveCloseables,
  registerActiveCloseable,
  unregisterActiveCloseable,
} from "@web/ui/ActiveCloseableRegistry";
import { MobileDrawer } from "@web/platform/mobile/MobileDrawer";
import {
  MobileBackButtonController,
  type MobileBackButtonBridge,
} from "@web/platform/mobile/MobileBackButton";

describe("MobileBackButtonController", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
    document.body.classList.add("is-mobile");
    Object.defineProperty(window, "focus", { configurable: true, value: () => {} });
    resetActiveWindow();
    drainActiveCloseables();
  });

  afterEach(() => {
    drainActiveCloseables();
    document.body.classList.remove("is-mobile");
    resetActiveWindow();
  });

  it("closes active closeables before drawers and history", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    const controller = createController(app);
    const left = expectMobileDrawer(app.mobileWorkspace.leftDrawer);
    left.expand();
    const collapse = vi.spyOn(left, "collapse");
    const closed: string[] = [];
    const first = { close: vi.fn(() => closed.push("first")) };
    const second = {
      close: vi.fn(() => {
        closed.push("second");
        unregisterActiveCloseable(second);
      }),
    };
    registerActiveCloseable(first);
    registerActiveCloseable(second);

    await expect(controller.handleBackButton()).resolves.toBe(true);

    expect(closed).toEqual(["second"]);
    expect(collapse).not.toHaveBeenCalled();
    unregisterActiveCloseable(first);
  });

  it("collapses the left drawer before the right drawer", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    const controller = createController(app);
    const left = expectMobileDrawer(app.mobileWorkspace.leftDrawer);
    const right = expectMobileDrawer(app.mobileWorkspace.rightDrawer);
    left.expand();
    right.expand();

    await controller.handleBackButton();

    expect(left.collapsed).toBe(true);
    expect(right.collapsed).toBe(false);
  });

  it("skips pinned drawers and collapses the next unpinned drawer", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    const controller = createController(app);
    const left = expectMobileDrawer(app.mobileWorkspace.leftDrawer);
    const right = expectMobileDrawer(app.mobileWorkspace.rightDrawer);
    left.setPinned(true);
    right.expand();

    await controller.handleBackButton();

    expect(left.collapsed).toBe(false);
    expect(left.isPinned).toBe(true);
    expect(right.collapsed).toBe(true);
  });

  it("navigates the active leaf history after closeables and drawers", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    const controller = createController(app);
    const first = await app.vault.create("First.md", "first");
    const second = await app.vault.create("Second.md", "second");
    const leaf = await app.workspace.openFile(first, { active: true });
    await app.workspace.openFile(second, { active: true });

    await controller.handleBackButton();

    expect((leaf.view as { file?: { path: string } | null } | null)?.file?.path).toBe("First.md");
  });

  it("shows an exit notice first, then minimizes on a second back within the interval", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    prepareExitBranch(app);
    const bridge = createBridge();
    const controller = new MobileBackButtonController(app, bridge, {
      exitNoticeMessage: "Back again to exit",
    });

    await controller.handleBackButton();

    expect(bridge.minimizeApp).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Back again to exit");

    bridge.advance(3000);
    await controller.handleBackButton();

    expect(bridge.minimizeApp).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).not.toContain("Back again to exit");
  });

  it("does not minimize when the second back is outside the exit interval", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    prepareExitBranch(app);
    const bridge = createBridge();
    const controller = new MobileBackButtonController(app, bridge, {
      exitNoticeMessage: "Back again to exit",
    });

    await controller.handleBackButton();
    bridge.advance(6000);
    await controller.handleBackButton();

    expect(bridge.minimizeApp).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Back again to exit");
  });

  it("attaches and detaches the native back listener", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    const bridge = createBridge();
    const controller = new MobileBackButtonController(app, bridge);

    controller.attach();

    expect(bridge.listeners).toHaveLength(1);

    controller.detach();

    expect(bridge.removed).toBe(1);
    expect(bridge.listeners).toHaveLength(0);
  });
});

function createController(app: App): MobileBackButtonController {
  return new MobileBackButtonController(app, createBridge());
}

function createBridge(): MobileBackButtonBridge & {
  listeners: Array<() => void | Promise<void>>;
  removed: number;
  advance(ms: number): void;
} {
  let now = 1000;
  const listeners: Array<() => void | Promise<void>> = [];
  const bridge = {
    listeners,
    removed: 0,
    addBackButtonListener(listener) {
      listeners.push(listener);
      return () => {
        const index = listeners.indexOf(listener);
        if (index !== -1) listeners.splice(index, 1);
        bridge.removed += 1;
      };
    },
    minimizeApp: vi.fn(),
    now: () => now,
    advance(ms: number) {
      now += ms;
    },
  };
  return bridge;
}

function expectMobileDrawer(drawer: MobileDrawer | null): MobileDrawer {
  if (!(drawer instanceof MobileDrawer)) throw new Error("Expected mobile drawer");
  return drawer;
}

function drainActiveCloseables(): void {
  // oxlint-disable-next-line unicorn/no-useless-spread -- unregister mutates the registry; the test intentionally drains a stable snapshot.
  for (const closeable of [...getActiveCloseables()]) unregisterActiveCloseable(closeable);
  while (closeTopActiveCloseable()) {
    // A defensive drain for closeables that unregister themselves during close.
  }
}

function clearLeafHistory(app: App): void {
  app.workspace.activeLeaf?.backHistory.splice(0);
  app.workspace.activeLeaf?.forwardHistory.splice(0);
}

function prepareExitBranch(app: App): void {
  drainActiveCloseables();
  app.mobileWorkspace.leftDrawer?.collapse();
  app.mobileWorkspace.rightDrawer?.collapse();
  clearLeafHistory(app);
}
