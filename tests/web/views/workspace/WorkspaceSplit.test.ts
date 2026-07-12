import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "@web/app/App";
import { WorkspaceLeaf } from "@web/views/workspace/WorkspaceLeaf";
import { WorkspaceParent } from "@web/views/workspace/WorkspaceParent";
import { WorkspaceSplit } from "@web/views/workspace/WorkspaceSplit";
import { WorkspaceTabs } from "@web/views/workspace/WorkspaceTabs";
import { WorkspaceWindow } from "@web/views/workspace/WorkspaceWindow";

describe("WorkspaceSplit", () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
        clear: () => values.clear(),
      },
    });
    Object.defineProperty(window, "focus", { configurable: true, value: () => {} });
  });

  it("creates Obsidian resize handles on workspace items", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    const leaf = new WorkspaceLeaf(app.workspace);

    expect(leaf.resizeHandleEl.tagName).toBe("HR");
    expect(leaf.resizeHandleEl.classList.contains("workspace-leaf-resize-handle")).toBe(true);
    expect(leaf.containerEl.contains(leaf.resizeHandleEl)).toBe(true);
  });

  it("inserts managed children after the parent resize handle using logical child order", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    const split = new WorkspaceSplit(app.workspace, "vertical");
    const first = new WorkspaceLeaf(app.workspace);
    const second = new WorkspaceLeaf(app.workspace);
    const inserted = new WorkspaceLeaf(app.workspace);

    split.appendChild(first);
    split.appendChild(second);
    split.insertChild(0, inserted);

    expect(split.children).toEqual([inserted, first, second]);
    expect(split.containerEl.children.item(0)).toBe(split.resizeHandleEl);
    expect(split.containerEl.children.item(1)).toBe(inserted.containerEl);
    expect(split.containerEl.children.item(2)).toBe(first.containerEl);
    expect(split.containerEl.children.item(3)).toBe(second.containerEl);
  });

  it("replaces managed children without moving the parent resize handle", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    const split = new WorkspaceSplit(app.workspace, "vertical");
    const first = new WorkspaceLeaf(app.workspace);
    const second = new WorkspaceLeaf(app.workspace);
    const replacement = new WorkspaceLeaf(app.workspace);

    split.appendChild(first);
    split.appendChild(second);
    split.replaceChild(first, replacement);

    expect(split.children).toEqual([replacement, second]);
    expect(split.containerEl.children.item(0)).toBe(split.resizeHandleEl);
    expect(split.containerEl.children.item(1)).toBe(replacement.containerEl);
    expect(split.containerEl.children.item(2)).toBe(second.containerEl);
  });

  it("keeps base workspace parents dimension-neutral and lets the layout queue recompute later", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    const parent = new WorkspaceParent(app.workspace);
    const first = new WorkspaceLeaf(app.workspace);
    const second = new WorkspaceLeaf(app.workspace);

    parent.appendChild(first);
    parent.appendChild(second);
    parent.recomputeChildrenDimensions();

    expect(first.dimension).toBeNull();
    expect(second.dimension).toBeNull();
  });

  it("supports Obsidian's index-based replaceChild form", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    const split = new WorkspaceSplit(app.workspace, "vertical");
    const first = new WorkspaceLeaf(app.workspace);
    const second = new WorkspaceLeaf(app.workspace);
    const replacement = new WorkspaceLeaf(app.workspace);

    split.appendChild(first);
    split.appendChild(second);
    split.replaceChild(1, replacement);

    expect(split.children).toEqual([first, replacement]);
    expect(split.containerEl.children.item(0)).toBe(split.resizeHandleEl);
    expect(split.containerEl.children.item(1)).toBe(first.containerEl);
    expect(split.containerEl.children.item(2)).toBe(replacement.containerEl);
  });

  it("finishes resize by converting pixel sizes back to percentage dimensions", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    const split = new WorkspaceSplit(app.workspace, "vertical");
    const left = new WorkspaceLeaf(app.workspace);
    const right = new WorkspaceLeaf(app.workspace);
    split.appendChild(left);
    split.appendChild(right);
    const saveLayout = vi.spyOn(app.workspace, "requestSaveLayout");
    const resize = vi.spyOn(app.workspace, "requestResize");
    Object.defineProperty(left.containerEl, "offsetWidth", { configurable: true, value: 300 });
    Object.defineProperty(right.containerEl, "offsetWidth", { configurable: true, value: 700 });

    split.finishResize();

    expect(left.dimension).toBeCloseTo(30);
    expect(right.dimension).toBeCloseTo(70);
    expect(left.containerEl.style.width).toBe("");
    expect(right.containerEl.style.width).toBe("");
    expect(saveLayout).toHaveBeenCalled();
    expect(resize).toHaveBeenCalled();
    saveLayout.mockRestore();
    resize.mockRestore();
  });

  it("distributes resize deltas across siblings from the handle outward", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    const split = new WorkspaceSplit(app.workspace, "vertical");
    const first = new WorkspaceLeaf(app.workspace);
    const second = new WorkspaceLeaf(app.workspace);
    const third = new WorkspaceLeaf(app.workspace);
    const fourth = new WorkspaceLeaf(app.workspace);
    split.appendChild(first);
    split.appendChild(second);
    split.appendChild(third);
    split.appendChild(fourth);
    Object.defineProperty(first.containerEl, "offsetWidth", { configurable: true, value: 300 });
    Object.defineProperty(second.containerEl, "offsetWidth", { configurable: true, value: 220 });
    Object.defineProperty(third.containerEl, "offsetWidth", { configurable: true, value: 240 });
    Object.defineProperty(fourth.containerEl, "offsetWidth", { configurable: true, value: 260 });

    split.onChildResizeStart(first, new MouseEvent("mousedown", { button: 0, clientX: 0 }));
    const moveEvent = new MouseEvent("mousemove", { button: 0, clientX: 100, cancelable: true });
    window.dispatchEvent(moveEvent);

    expect(first.containerEl.style.width).toBe("400px");
    expect(second.containerEl.style.width).toBe("200px");
    expect(third.containerEl.style.width).toBe("200px");
    expect(fourth.containerEl.style.width).toBe("220px");
    expect(moveEvent.defaultPrevented).toBe(true);

    window.dispatchEvent(new MouseEvent("mouseup"));
  });

  it("serializes tab currentTab only when it is not the first tab", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    const tabs = new WorkspaceTabs(app.workspace);
    tabs.appendChild(new WorkspaceLeaf(app.workspace), false);
    tabs.appendChild(new WorkspaceLeaf(app.workspace), false);
    const saveLayout = vi.spyOn(app.workspace, "requestSaveLayout");
    const resize = vi.spyOn(app.workspace, "requestResize");
    const updateDisplay = vi.spyOn(tabs, "updateTabDisplay");

    expect(tabs.serialize()).not.toHaveProperty("currentTab");

    tabs.selectTabIndex(0, false);

    expect(updateDisplay).not.toHaveBeenCalled();
    expect(saveLayout).not.toHaveBeenCalled();
    expect(resize).not.toHaveBeenCalled();

    tabs.selectTabIndex(1, false);

    expect(tabs.serialize()).toEqual(expect.objectContaining({ currentTab: 1 }));
    expect(updateDisplay).toHaveBeenCalledOnce();
    expect(saveLayout).toHaveBeenCalled();
    expect(resize).toHaveBeenCalled();
    updateDisplay.mockRestore();
    saveLayout.mockRestore();
    resize.mockRestore();
  });

  it("stacked tabs request layout update instead of direct save and resize", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    const tabs = new WorkspaceTabs(app.workspace);
    tabs.appendChild(new WorkspaceLeaf(app.workspace), false);
    const updateLayout = vi.spyOn(app.workspace, "requestUpdateLayout");
    const saveLayout = vi.spyOn(app.workspace, "requestSaveLayout");
    const resize = vi.spyOn(app.workspace, "requestResize");

    tabs.setStacked(true);

    expect(tabs.isStacked).toBe(true);
    expect(tabs.containerEl.classList.contains("mod-stacked")).toBe(true);
    expect(updateLayout).toHaveBeenCalled();
    expect(saveLayout).not.toHaveBeenCalled();
    expect(resize).not.toHaveBeenCalled();
    updateLayout.mockRestore();
    saveLayout.mockRestore();
    resize.mockRestore();
  });

  it("removes empty tab groups and collapses single-child splits through parent removal", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    const outer = new WorkspaceSplit(app.workspace, "vertical");
    const leftTabs = new WorkspaceTabs(app.workspace);
    const rightTabs = new WorkspaceTabs(app.workspace);
    const leftLeaf = new WorkspaceLeaf(app.workspace);
    const rightLeaf = new WorkspaceLeaf(app.workspace);
    leftTabs.appendChild(leftLeaf, false);
    rightTabs.appendChild(rightLeaf, false);
    outer.appendChild(leftTabs);
    outer.appendChild(rightTabs);
    const previousRootChild = app.workspace.rootSplit.children[0];
    app.workspace.rootSplit.replaceChild(previousRootChild, outer);

    leftLeaf.detach();

    expect(leftTabs.parent).toBeNull();
    expect(outer.parent).toBeNull();
    expect(app.workspace.rootSplit.children).toEqual([rightTabs]);
    expect(rightTabs.parent).toBe(app.workspace.rootSplit);
    expect(rightLeaf.parent).toBe(rightTabs);
  });

  it("moves leaves into tab groups and reorders same-group tabs from center drops", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    const first = await app.vault.create("First.md", "first");
    const second = await app.vault.create("Second.md", "second");
    const third = await app.vault.create("Third.md", "third");
    const firstLeaf = await app.workspace.openFile(first, { active: true });
    const secondLeaf = app.workspace.getLeaf("tab");
    await secondLeaf.openFile(second, { active: true });
    const thirdLeaf = app.workspace.getLeaf("tab");
    await thirdLeaf.openFile(third, { active: true });
    const tabs = firstLeaf.parent;
    if (!(tabs instanceof WorkspaceTabs)) throw new Error("Expected tabs");

    const moved = app.workspace.moveLeafToDropTarget(firstLeaf, { leaf: thirdLeaf, side: "center", tabInsertIndex: 3 });

    expect(moved).toBe(true);
    expect(tabs.children).toEqual([secondLeaf, thirdLeaf, firstLeaf]);
    expect(tabs.currentTab).toBe(2);
    expect(app.workspace.activeLeaf).toBe(firstLeaf);
  });

  it("splits target leaves for edge drops and routes DragManager drops through workspace movement", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    const first = await app.vault.create("First.md", "first");
    const second = await app.vault.create("Second.md", "second");
    const firstLeaf = await app.workspace.openFile(first, { active: true });
    const secondLeaf = app.workspace.getLeaf("tab");
    await secondLeaf.openFile(second, { active: true });

    app.workspace.dragManager.startDrag(secondLeaf);
    const moved = app.workspace.dragManager.finishDrag({ leaf: firstLeaf, side: "right" });

    expect(moved).toBe(true);
    expect(app.workspace.rootSplit.children).toHaveLength(2);
    expect(app.workspace.rootSplit.children[0]).toBe(firstLeaf.parent);
    expect(app.workspace.rootSplit.children[1]).toBe(secondLeaf.parent);
    expect(app.workspace.activeLeaf).toBe(secondLeaf);
    expect(secondLeaf.containerEl.classList.contains("is-being-dragged")).toBe(false);
  });

  it("keeps tab header lower zones for center tab insertion instead of top splits", async () => {
    const app = new App(document.body.appendChild(document.createElement("div")));
    await app.ready;
    const first = await app.vault.create("HeaderFirst.md", "first");
    const second = await app.vault.create("HeaderSecond.md", "second");
    const firstLeaf = await app.workspace.openFile(first, { active: true });
    const secondLeaf = app.workspace.getLeaf("tab");
    await secondLeaf.openFile(second, { active: true });
    const tabs = firstLeaf.parent;
    if (!(tabs instanceof WorkspaceTabs)) throw new Error("Expected tabs");
    setRect(tabs.containerEl, { x: 0, y: 0, width: 240, height: 160 });
    setRect(tabs.tabHeaderContainerEl, { x: 0, y: 0, width: 240, height: 30 });
    setRect(firstLeaf.containerEl, { x: 0, y: 0, width: 240, height: 160 });
    setRect(firstLeaf.tabHeaderEl, { x: 0, y: 0, width: 100, height: 30 });
    setRect(secondLeaf.containerEl, { x: 0, y: 0, width: 240, height: 160 });
    setRect(secondLeaf.tabHeaderEl, { x: 100, y: 0, width: 100, height: 30 });
    const dataTransfer = createDataTransfer();

    secondLeaf.tabHeaderEl.dispatchEvent(createDragEvent("dragstart", dataTransfer, 110, 20));
    window.dispatchEvent(createDragEvent("dragover", dataTransfer, 40, 20));

    expect(document.body.querySelector(".workspace-drop-overlay")).not.toBeNull();
    expect(document.body.querySelector(".workspace-fake-target-container")).toBeNull();

    window.dispatchEvent(createDragEvent("drop", dataTransfer, 40, 20));

    expect(app.workspace.rootSplit.children).toEqual([tabs]);
    expect(tabs.children).toEqual([secondLeaf, firstLeaf]);
    expect(app.workspace.activeLeaf).toBe(secondLeaf);
  });

  it("allows tab header top zones to create top splits", async () => {
    const app = new App(document.body.appendChild(document.createElement("div")));
    await app.ready;
    const first = await app.vault.create("TopFirst.md", "first");
    const second = await app.vault.create("TopSecond.md", "second");
    const firstLeaf = await app.workspace.openFile(first, { active: true });
    const secondLeaf = app.workspace.getLeaf("tab");
    await secondLeaf.openFile(second, { active: true });
    const tabs = firstLeaf.parent;
    if (!(tabs instanceof WorkspaceTabs)) throw new Error("Expected tabs");
    setRect(tabs.containerEl, { x: 0, y: 0, width: 240, height: 160 });
    setRect(tabs.tabHeaderContainerEl, { x: 0, y: 0, width: 240, height: 30 });
    setRect(firstLeaf.containerEl, { x: 0, y: 0, width: 240, height: 160 });
    setRect(firstLeaf.tabHeaderEl, { x: 0, y: 0, width: 100, height: 30 });
    setRect(secondLeaf.containerEl, { x: 0, y: 0, width: 240, height: 160 });
    setRect(secondLeaf.tabHeaderEl, { x: 100, y: 0, width: 100, height: 30 });
    const dataTransfer = createDataTransfer();

    secondLeaf.tabHeaderEl.dispatchEvent(createDragEvent("dragstart", dataTransfer, 110, 20));
    window.dispatchEvent(createDragEvent("dragover", dataTransfer, 40, 4));

    expect(document.body.querySelector(".workspace-drop-overlay")).not.toBeNull();
    expect(document.body.querySelector(".workspace-fake-target-container")).not.toBeNull();

    window.dispatchEvent(createDragEvent("drop", dataTransfer, 40, 4));

    expect(app.workspace.rootSplit.children[0]).toBeInstanceOf(WorkspaceSplit);
    expect(secondLeaf.getRoot()).toBe(app.workspace.rootSplit);
    expect(firstLeaf.getRoot()).toBe(app.workspace.rootSplit);
    expect(app.workspace.activeLeaf).toBe(secondLeaf);
  });

  it("keeps stacked tab content side edges for center tab insertion instead of side splits", async () => {
    const app = new App(document.body.appendChild(document.createElement("div")));
    await app.ready;
    const first = await app.vault.create("StackedContentFirst.md", "first");
    const second = await app.vault.create("StackedContentSecond.md", "second");
    const firstLeaf = await app.workspace.openFile(first, { active: true });
    const secondLeaf = app.workspace.getLeaf("tab");
    await secondLeaf.openFile(second, { active: true });
    const tabs = firstLeaf.parent;
    if (!(tabs instanceof WorkspaceTabs)) throw new Error("Expected tabs");
    tabs.setStacked(true, false);
    setRect(tabs.containerEl, { x: 0, y: 0, width: 240, height: 160 });
    setRect(tabs.tabHeaderContainerEl, { x: 0, y: 0, width: 240, height: 30 });
    setRect(firstLeaf.containerEl, { x: 0, y: 30, width: 240, height: 130 });
    setRect(firstLeaf.tabHeaderEl, { x: 0, y: 0, width: 100, height: 30 });
    setRect(secondLeaf.containerEl, { x: 0, y: 30, width: 240, height: 130 });
    setRect(secondLeaf.tabHeaderEl, { x: 100, y: 0, width: 100, height: 30 });
    const dataTransfer = createDataTransfer();

    secondLeaf.tabHeaderEl.dispatchEvent(createDragEvent("dragstart", dataTransfer, 110, 20));
    window.dispatchEvent(createDragEvent("dragover", dataTransfer, 4, 100));

    expect(document.body.querySelector(".workspace-drop-overlay")).not.toBeNull();
    expect(document.body.querySelector(".workspace-fake-target-container")).toBeNull();

    window.dispatchEvent(createDragEvent("drop", dataTransfer, 4, 100));

    expect(app.workspace.rootSplit.children).toEqual([tabs]);
    expect(tabs.children).toEqual([secondLeaf, firstLeaf]);
    expect(app.workspace.activeLeaf).toBe(secondLeaf);
  });

  it("allows stacked tab header side edges to create side splits", async () => {
    const app = new App(document.body.appendChild(document.createElement("div")));
    await app.ready;
    const first = await app.vault.create("StackedHeaderFirst.md", "first");
    const second = await app.vault.create("StackedHeaderSecond.md", "second");
    const firstLeaf = await app.workspace.openFile(first, { active: true });
    const secondLeaf = app.workspace.getLeaf("tab");
    await secondLeaf.openFile(second, { active: true });
    const tabs = firstLeaf.parent;
    if (!(tabs instanceof WorkspaceTabs)) throw new Error("Expected tabs");
    tabs.setStacked(true, false);
    setRect(tabs.containerEl, { x: 0, y: 0, width: 240, height: 160 });
    setRect(tabs.tabHeaderContainerEl, { x: 0, y: 0, width: 240, height: 30 });
    setRect(firstLeaf.containerEl, { x: 0, y: 30, width: 240, height: 130 });
    setRect(firstLeaf.tabHeaderEl, { x: 0, y: 0, width: 100, height: 30 });
    setRect(secondLeaf.containerEl, { x: 0, y: 30, width: 240, height: 130 });
    setRect(secondLeaf.tabHeaderEl, { x: 100, y: 0, width: 100, height: 30 });
    const dataTransfer = createDataTransfer();

    secondLeaf.tabHeaderEl.dispatchEvent(createDragEvent("dragstart", dataTransfer, 110, 20));
    window.dispatchEvent(createDragEvent("dragover", dataTransfer, 4, 20));

    expect(document.body.querySelector(".workspace-drop-overlay")).not.toBeNull();
    expect(document.body.querySelector(".workspace-fake-target-container")).not.toBeNull();

    window.dispatchEvent(createDragEvent("drop", dataTransfer, 4, 20));

    expect(app.workspace.rootSplit.children).toHaveLength(2);
    expect(secondLeaf.parent).toBeInstanceOf(WorkspaceTabs);
    expect(secondLeaf.parent).not.toBe(tabs);
    expect(secondLeaf.parent?.parent).toBe(app.workspace.rootSplit);
    expect(tabs.parent).toBe(app.workspace.rootSplit);
    expect(secondLeaf.getRoot()).toBe(app.workspace.rootSplit);
    expect(firstLeaf.getRoot()).toBe(app.workspace.rootSplit);
    expect(app.workspace.activeLeaf).toBe(secondLeaf);
  });

  it("previews workspace-level leaf drag targets and moves the leaf on window drop", async () => {
    const app = new App(document.body.appendChild(document.createElement("div")));
    await app.ready;
    const first = await app.vault.create("First.md", "first");
    const second = await app.vault.create("Second.md", "second");
    const firstLeaf = await app.workspace.openFile(first, { active: true });
    const secondLeaf = app.workspace.getLeaf("tab");
    await secondLeaf.openFile(second, { active: true });
    const sourceTabs = firstLeaf.parent;
    if (!(sourceTabs instanceof WorkspaceTabs)) throw new Error("Expected source tabs");
    setRect(sourceTabs.containerEl, { x: 0, y: 0, width: 200, height: 120 });
    setRect(firstLeaf.containerEl, { x: 0, y: 0, width: 200, height: 120 });
    setRect(firstLeaf.tabHeaderEl, { x: 0, y: 0, width: 80, height: 24 });
    const dataTransfer = createDataTransfer();

    secondLeaf.tabHeaderEl.dispatchEvent(createDragEvent("dragstart", dataTransfer, 10, 10));
    expect(dataTransfer.getData("text/plain")).toBe("");
    expect(dataTransfer.effectAllowed).toBe("all");
    expect(secondLeaf.containerEl.classList.contains("is-being-dragged")).toBe(false);
    const ghost = document.body.querySelector<HTMLElement>(".drag-ghost.mod-leaf");
    expect(ghost).not.toBeNull();
    expect(ghost?.querySelector(".drag-ghost-icon svg")).not.toBeNull();
    expect(ghost?.textContent).toContain("Second");

    window.dispatchEvent(createDragEvent("dragenter", dataTransfer, 190, 60));
    expect(dataTransfer.dropEffect).toBe("move");
    expect(document.body.querySelector(".workspace-drop-overlay")).toBeNull();

    window.dispatchEvent(createDragEvent("dragover", dataTransfer, 190, 60));

    const overlay = document.body.querySelector<HTMLElement>(".workspace-drop-overlay");
    expect(overlay).not.toBeNull();
    expect(overlay?.style.width).toBe(`${200 / 3}px`);
    expect(overlay?.style.height).toBe("120px");
    expect(document.body.querySelector(".workspace-fake-target-container")).not.toBeNull();
    expect(document.body.querySelector(".workspace-fake-target-overlay")).not.toBeNull();
    expect(sourceTabs.containerEl.style.opacity).toBe("0");
    const fakeTargetContainer = document.body.querySelector<HTMLElement>(".workspace-fake-target-container");
    // fake target should preserve the target parent class chain, matching Obsidian's preview DOM.
    expect(
      Array.from(fakeTargetContainer?.querySelectorAll("div") ?? []).some(
        (el) => el.className === sourceTabs.containerEl.parentElement?.className,
      ),
    ).toBe(true);
    expect(dataTransfer.dropEffect).toBe("move");
    expect(document.body.classList.contains("is-grabbing")).toBe(true);

    window.dispatchEvent(createDragEvent("dragleave", dataTransfer, 300, 300));

    expect(document.body.querySelector(".workspace-drop-overlay")).toBeNull();
    expect(document.body.querySelector(".workspace-fake-target-container")).toBeNull();
    expect(document.body.querySelector(".workspace-fake-target-overlay")).toBeNull();
    expect(sourceTabs.containerEl.style.opacity).toBe("");

    window.dispatchEvent(createDragEvent("dragover", dataTransfer, 190, 60));
    expect(document.body.querySelector(".workspace-drop-overlay")).not.toBeNull();
    expect(document.body.querySelector(".workspace-fake-target-container")).not.toBeNull();
    expect(sourceTabs.containerEl.style.opacity).toBe("0");

    window.dispatchEvent(createDragEvent("drop", dataTransfer, 190, 60));

    expect(document.body.querySelector(".workspace-drop-overlay")).toBeNull();
    expect(document.body.querySelector(".workspace-fake-target-container")).toBeNull();
    expect(document.body.querySelector(".workspace-fake-target-overlay")).toBeNull();
    expect(sourceTabs.containerEl.style.opacity).toBe("");
    expect(document.body.classList.contains("is-grabbing")).toBe(false);
    expect(app.workspace.rootSplit.children).toHaveLength(2);
    expect(app.workspace.rootSplit.children[0]).toBe(firstLeaf.parent);
    expect(app.workspace.rootSplit.children[1]).toBe(secondLeaf.parent);
    expect(app.workspace.activeLeaf).toBe(secondLeaf);
  });

  it("exposes Obsidian drop target helpers and mutates the drop direction rect", async () => {
    const app = new App(document.body.appendChild(document.createElement("div")));
    await app.ready;
    const tabs = app.workspace.rootSplit.children[0];
    if (!(tabs instanceof WorkspaceTabs)) throw new Error("Expected default tabs");
    const leaf = tabs.children[0];
    if (!(leaf instanceof WorkspaceLeaf)) throw new Error("Expected default leaf");
    setRect(app.workspace.rootSplit.containerEl, { x: 0, y: 0, width: 300, height: 180 });
    setRect(tabs.containerEl, { x: 0, y: 0, width: 300, height: 180 });
    setRect(leaf.containerEl, { x: 0, y: 0, width: 300, height: 180 });
    const dataTransfer = createDataTransfer();

    const location = app.workspace.getDropLocation(createDragEvent("dragover", dataTransfer, 4, 90));
    const target = app.workspace.recursiveGetTarget(createDragEvent("dragover", dataTransfer, 4, 90), app.workspace.rootSplit);
    const rect = new DOMRect(0, 0, 300, 180);
    const side = app.workspace.getDropDirection(createDragEvent("dragover", dataTransfer, 4, 90), rect, [], leaf);

    expect(location).toBe(tabs);
    expect(target).toBe(tabs);
    expect(side).toBe("left");
    expect(rect.x).toBe(0);
    expect(rect.width).toBe(100);
    expect(rect.height).toBe(180);
  });

  it("follows original child-order hit testing for overlapping drop locations", async () => {
    const app = new App(document.body.appendChild(document.createElement("div")));
    await app.ready;
    const first = await app.vault.create("OverlapFirst.md", "first");
    const second = await app.vault.create("OverlapSecond.md", "second");
    const third = await app.vault.create("OverlapThird.md", "third");
    const firstLeaf = await app.workspace.openFile(first, { active: true });
    const secondLeaf = app.workspace.getLeaf("split");
    await secondLeaf.openFile(second, { active: true });
    const sourceLeaf = app.workspace.getLeaf("split");
    await sourceLeaf.openFile(third, { active: true });
    const firstTabs = firstLeaf.parent;
    const secondTabs = secondLeaf.parent;
    const sourceTabs = sourceLeaf.parent;
    if (!(firstTabs instanceof WorkspaceTabs) || !(secondTabs instanceof WorkspaceTabs) || !(sourceTabs instanceof WorkspaceTabs)) {
      throw new Error("Expected overlapping leaves to be wrapped in tab groups");
    }
    setRect(firstTabs.containerEl, { x: 0, y: 0, width: 240, height: 160 });
    setRect(secondTabs.containerEl, { x: 0, y: 0, width: 240, height: 160 });
    setRect(sourceTabs.containerEl, { x: 360, y: 0, width: 240, height: 160 });
    setRect(firstLeaf.containerEl, { x: 0, y: 0, width: 240, height: 160 });
    setRect(firstLeaf.tabHeaderEl, { x: 0, y: 0, width: 100, height: 24 });
    setRect(secondLeaf.containerEl, { x: 0, y: 0, width: 240, height: 160 });
    setRect(secondLeaf.tabHeaderEl, { x: 0, y: 0, width: 100, height: 24 });
    setRect(sourceLeaf.containerEl, { x: 360, y: 0, width: 240, height: 160 });
    setRect(sourceLeaf.tabHeaderEl, { x: 360, y: 0, width: 100, height: 24 });
    const dataTransfer = createDataTransfer();

    sourceLeaf.tabHeaderEl.dispatchEvent(createDragEvent("dragstart", dataTransfer, 370, 10));
    window.dispatchEvent(createDragEvent("dragover", dataTransfer, 236, 80));

    expect(document.body.querySelector(".workspace-fake-target-container")).not.toBeNull();

    window.dispatchEvent(createDragEvent("drop", dataTransfer, 236, 80));

    expect(app.workspace.rootSplit.children[0]).toBe(firstLeaf.parent);
    expect(app.workspace.rootSplit.children[1]).toBe(sourceLeaf.parent);
    expect(sourceLeaf.parent).not.toBe(secondLeaf.parent);
    expect(sourceLeaf.getRoot()).toBe(app.workspace.rootSplit);
    expect(app.workspace.activeLeaf).toBe(sourceLeaf);
  });

  it("drops a workspace leaf into sidedock container whitespace", async () => {
    const app = new App(document.body.appendChild(document.createElement("div")));
    await app.ready;
    const file = await app.vault.create("Side.md", "side");
    const leaf = await app.workspace.openFile(file, { active: true });
    for (const child of [...app.workspace.leftSplit.children]) child.detach();
    (app.workspace.leftSplit as { expand?: () => void }).expand?.();
    setRect(app.workspace.leftSplit.containerEl, { x: 0, y: 0, width: 300, height: 600 });
    setRect(leaf.containerEl, { x: 400, y: 0, width: 400, height: 300 });
    setRect(leaf.tabHeaderEl, { x: 400, y: 0, width: 100, height: 24 });
    const dataTransfer = createDataTransfer();
    const sideChildrenBefore = app.workspace.leftSplit.children.length;

    leaf.tabHeaderEl.dispatchEvent(createDragEvent("dragstart", dataTransfer, 410, 10));
    window.dispatchEvent(createDragEvent("dragover", dataTransfer, 150, 300));

    const overlay = document.body.querySelector<HTMLElement>(".workspace-drop-overlay");
    expect(overlay).not.toBeNull();
    expect(overlay?.style.width).toBe("300px");
    expect(overlay?.style.height).toBe("600px");
    expect(document.body.querySelector(".workspace-fake-target-container")).toBeNull();

    window.dispatchEvent(createDragEvent("drop", dataTransfer, 150, 300));

    expect(app.workspace.leftSplit.children).toHaveLength(sideChildrenBefore + 1);
    expect(leaf.parent?.parent).toBe(app.workspace.leftSplit);
    expect(app.workspace.activeLeaf).toBe(leaf);
    expect(document.body.querySelector(".workspace-drop-overlay")).toBeNull();
  });

  it("uses the collapsed sidedock toggle rect for direct sidedock drops", async () => {
    const app = new App(document.body.appendChild(document.createElement("div")));
    await app.ready;
    const file = await app.vault.create("CollapsedSide.md", "side");
    const leaf = await app.workspace.openFile(file, { active: true });
    for (const child of [...app.workspace.leftSplit.children]) child.detach();
    (app.workspace.leftSplit as { collapse?: () => void }).collapse?.();
    setRect(app.workspace.leftSidebarToggleButtonEl, { x: 8, y: 12, width: 36, height: 32 });
    setRect(app.workspace.leftSplit.containerEl, { x: 0, y: 0, width: 300, height: 600 });
    setRect(leaf.containerEl, { x: 400, y: 0, width: 400, height: 300 });
    setRect(leaf.tabHeaderEl, { x: 400, y: 0, width: 100, height: 24 });
    const dataTransfer = createDataTransfer();

    leaf.tabHeaderEl.dispatchEvent(createDragEvent("dragstart", dataTransfer, 410, 10));
    window.dispatchEvent(createDragEvent("dragover", dataTransfer, 20, 20));

    const overlay = document.body.querySelector<HTMLElement>(".workspace-drop-overlay");
    expect(overlay).not.toBeNull();
    expect(overlay?.style.transform).toBe("translate(8px, 12px)");
    expect(overlay?.style.width).toBe("36px");
    expect(overlay?.style.height).toBe("32px");
    expect(document.body.querySelector(".workspace-fake-target-container")).toBeNull();

    window.dispatchEvent(createDragEvent("drop", dataTransfer, 20, 20));

    expect(app.workspace.leftSplit.children[0]).toBeInstanceOf(WorkspaceTabs);
    expect(leaf.parent?.parent).toBe(app.workspace.leftSplit);
    expect(app.workspace.leftSplit.containerEl.classList.contains("is-sidedock-collapsed")).toBe(false);
    expect(app.workspace.activeLeaf).toBe(leaf);
  });

  it("blocks outward edge splits in the left sidedock", async () => {
    const app = new App(document.body.appendChild(document.createElement("div")));
    await app.ready;
    const file = await app.vault.create("SidebarBlocked.md", "sidebar");
    const sourceLeaf = await app.workspace.openFile(file, { active: true });
    const sideLeaf = app.workspace.getLeftLeaf();
    const sideTabs = sideLeaf.parent;
    if (!(sideTabs instanceof WorkspaceTabs)) throw new Error("Expected side tabs");
    const sideChildrenBefore = [...sideTabs.children];
    setRect(sideTabs.containerEl, { x: 0, y: 0, width: 240, height: 200 });
    setRect(sideLeaf.containerEl, { x: 0, y: 0, width: 240, height: 200 });
    setRect(sideLeaf.tabHeaderEl, { x: 0, y: 0, width: 100, height: 24 });
    setRect(sourceLeaf.containerEl, { x: 420, y: 0, width: 320, height: 220 });
    setRect(sourceLeaf.tabHeaderEl, { x: 420, y: 0, width: 100, height: 24 });
    const dataTransfer = createDataTransfer();

    sourceLeaf.tabHeaderEl.dispatchEvent(createDragEvent("dragstart", dataTransfer, 430, 10));
    window.dispatchEvent(createDragEvent("dragover", dataTransfer, 4, 100));

    expect(document.body.querySelector(".workspace-drop-overlay")).not.toBeNull();
    expect(document.body.querySelector(".workspace-fake-target-container")).toBeNull();

    window.dispatchEvent(createDragEvent("drop", dataTransfer, 4, 100));

    expect(app.workspace.leftSplit.children).toEqual([sideTabs]);
    expect(sideTabs.children).toHaveLength(sideChildrenBefore.length + 1);
    expect(sideTabs.children).toContain(sourceLeaf);
    expect(sideTabs.children).toContain(sideLeaf);
    for (const child of sideChildrenBefore) {
      expect(sideTabs.children).toContain(child);
    }
    expect(sourceLeaf.getRoot()).toBe(app.workspace.leftSplit);
    expect(app.workspace.activeLeaf).toBe(sourceLeaf);
  });

  it("blocks outward edge splits in the right sidedock", async () => {
    const app = new App(document.body.appendChild(document.createElement("div")));
    await app.ready;
    const file = await app.vault.create("RightSidebarBlocked.md", "sidebar");
    const sourceLeaf = await app.workspace.openFile(file, { active: true });
    const sideLeaf = app.workspace.getRightLeaf();
    const sideTabs = sideLeaf.parent;
    if (!(sideTabs instanceof WorkspaceTabs)) throw new Error("Expected side tabs");
    const sideChildrenBefore = [...sideTabs.children];
    setRect(sideTabs.containerEl, { x: 500, y: 0, width: 240, height: 200 });
    setRect(sideLeaf.containerEl, { x: 500, y: 0, width: 240, height: 200 });
    setRect(sideLeaf.tabHeaderEl, { x: 500, y: 0, width: 100, height: 24 });
    setRect(sourceLeaf.containerEl, { x: 0, y: 0, width: 320, height: 220 });
    setRect(sourceLeaf.tabHeaderEl, { x: 0, y: 0, width: 100, height: 24 });
    const dataTransfer = createDataTransfer();

    sourceLeaf.tabHeaderEl.dispatchEvent(createDragEvent("dragstart", dataTransfer, 10, 10));
    window.dispatchEvent(createDragEvent("dragover", dataTransfer, 736, 100));

    expect(document.body.querySelector(".workspace-drop-overlay")).not.toBeNull();
    expect(document.body.querySelector(".workspace-fake-target-container")).toBeNull();

    window.dispatchEvent(createDragEvent("drop", dataTransfer, 736, 100));

    expect(app.workspace.rightSplit.children).toEqual([sideTabs]);
    expect(sideTabs.children).toHaveLength(sideChildrenBefore.length + 1);
    expect(sideTabs.children).toContain(sourceLeaf);
    expect(sideTabs.children).toContain(sideLeaf);
    for (const child of sideChildrenBefore) {
      expect(sideTabs.children).toContain(child);
    }
    expect(sourceLeaf.getRoot()).toBe(app.workspace.rightSplit);
    expect(app.workspace.activeLeaf).toBe(sourceLeaf);
  });

  it("blocks horizontal edge splits in sidedocks", async () => {
    const leftApp = new App(document.body.appendChild(document.createElement("div")));
    await leftApp.ready;
    const leftFile = await leftApp.vault.create("LeftSidebarInward.md", "left inward");
    const leftSourceLeaf = await leftApp.workspace.openFile(leftFile, { active: true });
    const leftTargetLeaf = leftApp.workspace.getLeftLeaf();
    const leftTargetTabs = leftTargetLeaf.parent;
    if (!(leftTargetTabs instanceof WorkspaceTabs)) throw new Error("Expected left side tabs");
    const leftSideChildrenBefore = [...leftTargetTabs.children];
    setRect(leftTargetTabs.containerEl, { x: 0, y: 0, width: 240, height: 200 });
    setRect(leftTargetLeaf.containerEl, { x: 0, y: 0, width: 240, height: 200 });
    setRect(leftTargetLeaf.tabHeaderEl, { x: 0, y: 0, width: 100, height: 24 });
    setRect(leftSourceLeaf.containerEl, { x: 420, y: 0, width: 320, height: 220 });
    setRect(leftSourceLeaf.tabHeaderEl, { x: 420, y: 0, width: 100, height: 24 });
    const leftTransfer = createDataTransfer();

    leftSourceLeaf.tabHeaderEl.dispatchEvent(createDragEvent("dragstart", leftTransfer, 430, 10));
    window.dispatchEvent(createDragEvent("dragover", leftTransfer, 236, 100));

    expect(document.body.querySelector(".workspace-drop-overlay")).not.toBeNull();
    expect(document.body.querySelector(".workspace-fake-target-container")).toBeNull();

    window.dispatchEvent(createDragEvent("drop", leftTransfer, 236, 100));

    expect(leftApp.workspace.leftSplit.children).toEqual([leftTargetTabs]);
    expect(leftTargetTabs.children).toHaveLength(leftSideChildrenBefore.length + 1);
    expect(leftTargetTabs.children).toContain(leftSourceLeaf);
    expect(leftTargetTabs.children).toContain(leftTargetLeaf);
    for (const child of leftSideChildrenBefore) {
      expect(leftTargetTabs.children).toContain(child);
    }
    expect(leftSourceLeaf.getRoot()).toBe(leftApp.workspace.leftSplit);
    expect(leftApp.workspace.activeLeaf).toBe(leftSourceLeaf);

    const rightApp = new App(document.body.appendChild(document.createElement("div")));
    await rightApp.ready;
    const rightFile = await rightApp.vault.create("RightSidebarInward.md", "right inward");
    const rightSourceLeaf = await rightApp.workspace.openFile(rightFile, { active: true });
    const rightTargetLeaf = rightApp.workspace.getRightLeaf();
    const rightTargetTabs = rightTargetLeaf.parent;
    if (!(rightTargetTabs instanceof WorkspaceTabs)) throw new Error("Expected right side tabs");
    const rightSideChildrenBefore = [...rightTargetTabs.children];
    setRect(rightTargetTabs.containerEl, { x: 500, y: 0, width: 240, height: 200 });
    setRect(rightTargetLeaf.containerEl, { x: 500, y: 0, width: 240, height: 200 });
    setRect(rightTargetLeaf.tabHeaderEl, { x: 500, y: 0, width: 100, height: 24 });
    setRect(rightSourceLeaf.containerEl, { x: 0, y: 0, width: 320, height: 220 });
    setRect(rightSourceLeaf.tabHeaderEl, { x: 0, y: 0, width: 100, height: 24 });
    const rightTransfer = createDataTransfer();

    rightSourceLeaf.tabHeaderEl.dispatchEvent(createDragEvent("dragstart", rightTransfer, 10, 10));
    window.dispatchEvent(createDragEvent("dragover", rightTransfer, 504, 100));

    expect(document.body.querySelector(".workspace-drop-overlay")).not.toBeNull();
    expect(document.body.querySelector(".workspace-fake-target-container")).toBeNull();

    window.dispatchEvent(createDragEvent("drop", rightTransfer, 504, 100));

    expect(rightApp.workspace.rightSplit.children).toEqual([rightTargetTabs]);
    expect(rightTargetTabs.children).toHaveLength(rightSideChildrenBefore.length + 1);
    expect(rightTargetTabs.children).toContain(rightSourceLeaf);
    expect(rightTargetTabs.children).toContain(rightTargetLeaf);
    for (const child of rightSideChildrenBefore) {
      expect(rightTargetTabs.children).toContain(child);
    }
    expect(rightSourceLeaf.getRoot()).toBe(rightApp.workspace.rightSplit);
    expect(rightApp.workspace.activeLeaf).toBe(rightSourceLeaf);
  });

  it("blocks vertical edge splits in desktop sidedocks", async () => {
    const app = new App(document.body.appendChild(document.createElement("div")));
    await app.ready;
    const file = await app.vault.create("SidebarVerticalBlocked.md", "sidebar");
    const sourceLeaf = await app.workspace.openFile(file, { active: true });
    const sideLeaf = app.workspace.getLeftLeaf();
    const sideTabs = sideLeaf.parent;
    if (!(sideTabs instanceof WorkspaceTabs)) throw new Error("Expected side tabs");
    const sideChildrenBefore = [...sideTabs.children];
    setRect(sideTabs.containerEl, { x: 0, y: 0, width: 240, height: 200 });
    setRect(sideTabs.tabHeaderContainerEl, { x: 0, y: 0, width: 240, height: 24 });
    setRect(sideLeaf.containerEl, { x: 0, y: 0, width: 240, height: 200 });
    setRect(sideLeaf.tabHeaderEl, { x: 0, y: 0, width: 100, height: 24 });
    setRect(sourceLeaf.containerEl, { x: 420, y: 0, width: 320, height: 220 });
    setRect(sourceLeaf.tabHeaderEl, { x: 420, y: 0, width: 100, height: 24 });
    const dataTransfer = createDataTransfer();

    sourceLeaf.tabHeaderEl.dispatchEvent(createDragEvent("dragstart", dataTransfer, 430, 10));
    window.dispatchEvent(createDragEvent("dragover", dataTransfer, 120, 4));

    expect(document.body.querySelector(".workspace-drop-overlay")).not.toBeNull();
    expect(document.body.querySelector(".workspace-fake-target-container")).toBeNull();

    window.dispatchEvent(createDragEvent("drop", dataTransfer, 120, 4));

    expect(app.workspace.leftSplit.children).toEqual([sideTabs]);
    expect(sideTabs.children).toHaveLength(sideChildrenBefore.length + 1);
    expect(sideTabs.children).toContain(sourceLeaf);
    for (const child of sideChildrenBefore) expect(sideTabs.children).toContain(child);
    expect(sourceLeaf.getRoot()).toBe(app.workspace.leftSplit);
    expect(app.workspace.activeLeaf).toBe(sourceLeaf);
  });

  it("ignores existing popout window whitespace without a child target", async () => {
    const app = new App(document.body.appendChild(document.createElement("div")));
    await app.ready;
    const iframe = document.body.appendChild(document.createElement("iframe"));
    const targetWin = iframe.contentWindow;
    if (!targetWin) throw new Error("Expected iframe window");
    const targetDoc = targetWin.document;
    const popoutWindow = new WorkspaceWindow(app.workspace, targetWin);
    app.workspace.floatingSplit.appendChild(popoutWindow);
    app.workspace.floatingSplit.openPopout();
    const sourceFile = await app.vault.create("Source.md", "source");
    const sourceLeaf = await app.workspace.openFile(sourceFile, { active: true });
    const popoutChildrenBefore = popoutWindow.children.length;
    setRect(popoutWindow.containerEl, { x: 20, y: 20, width: 320, height: 240 });
    setRect(sourceLeaf.containerEl, { x: 420, y: 0, width: 360, height: 260 });
    setRect(sourceLeaf.tabHeaderEl, { x: 420, y: 0, width: 100, height: 24 });
    const dataTransfer = createDataTransfer();

    sourceLeaf.tabHeaderEl.dispatchEvent(createDragEvent("dragstart", dataTransfer, 430, 10));
    targetWin.dispatchEvent(createDragEvent("dragover", dataTransfer, 160, 140, targetWin));

    expect(targetDoc.body.querySelector(".workspace-drop-overlay")).toBeNull();
    expect(targetDoc.body.querySelector(".workspace-fake-target-container")).toBeNull();
    expect(dataTransfer.dropEffect).toBe("none");

    targetWin.dispatchEvent(createDragEvent("drop", dataTransfer, 160, 140, targetWin));

    expect(popoutWindow.children).toHaveLength(popoutChildrenBefore);
    expect(sourceLeaf.getContainer()).toBe(app.workspace.rootSplit);
    expect(sourceLeaf.containerEl.ownerDocument).toBe(document);
    expect(sourceLeaf.tabHeaderEl.ownerDocument).toBe(document);
    expect(app.workspace.activeLeaf).toBe(sourceLeaf);
    expect(targetDoc.body.querySelector(".workspace-drop-overlay")).toBeNull();
    expect(targetDoc.body.querySelector(".workspace-fake-target-container")).toBeNull();
  });

  it("listens for leaf drops in an existing popout window document", async () => {
    const app = new App(document.body.appendChild(document.createElement("div")));
    await app.ready;
    const iframe = document.body.appendChild(document.createElement("iframe"));
    const targetWin = iframe.contentWindow;
    if (!targetWin) throw new Error("Expected iframe window");
    const targetDoc = targetWin.document;
    const popoutWindow = new WorkspaceWindow(app.workspace, targetWin);
    app.workspace.floatingSplit.appendChild(popoutWindow);
    app.workspace.floatingSplit.openPopout();
    expect(popoutWindow.containerEl.ownerDocument).toBe(targetDoc);
    expect(popoutWindow.resizeHandleEl.ownerDocument).toBe(targetDoc);
    expect(popoutWindow.appContainerEl.ownerDocument).toBe(targetDoc);
    const targetTabs = new WorkspaceTabs(app.workspace, undefined, targetDoc);
    const targetLeaf = new WorkspaceLeaf(app.workspace, undefined, targetDoc);
    targetTabs.appendChild(targetLeaf);
    popoutWindow.appendChild(targetTabs);
    const sourceFile = await app.vault.create("CrossWindow.md", "cross-window");
    const sourceLeaf = await app.workspace.openFile(sourceFile, { active: true });
    const popoutChildrenBefore = popoutWindow.children.length;
    setRect(popoutWindow.containerEl, { x: 20, y: 20, width: 320, height: 240 });
    setRect(targetTabs.containerEl, { x: 20, y: 20, width: 320, height: 240 });
    setRect(targetLeaf.containerEl, { x: 20, y: 20, width: 320, height: 240 });
    setRect(targetLeaf.tabHeaderEl, { x: 20, y: 20, width: 100, height: 24 });
    setRect(sourceLeaf.containerEl, { x: 420, y: 0, width: 360, height: 260 });
    setRect(sourceLeaf.tabHeaderEl, { x: 420, y: 0, width: 100, height: 24 });
    const dataTransfer = createDataTransfer();

    sourceLeaf.tabHeaderEl.dispatchEvent(createDragEvent("dragstart", dataTransfer, 430, 10));
    targetWin.dispatchEvent(createDragEvent("dragover", dataTransfer, 330, 140, targetWin));

    const overlay = targetDoc.body.querySelector<HTMLElement>(".workspace-drop-overlay");
    expect(overlay).not.toBeNull();
    expect(overlay?.ownerDocument).toBe(targetDoc);
    expect(overlay?.parentElement).toBe(targetDoc.body);
    expect(targetDoc.body.querySelector(".workspace-fake-target-container")).not.toBeNull();
    expect(document.body.classList.contains("is-grabbing")).toBe(true);
    expect(targetDoc.body.classList.contains("is-grabbing")).toBe(true);

    targetWin.dispatchEvent(createDragEvent("drop", dataTransfer, 330, 140, targetWin));

    expect(popoutWindow.children).toHaveLength(popoutChildrenBefore + 1);
    const insertedTabs = popoutWindow.children[popoutChildrenBefore];
    expect(insertedTabs).toBeInstanceOf(WorkspaceTabs);
    expect(insertedTabs.containerEl.ownerDocument).toBe(targetDoc);
    expect((insertedTabs as WorkspaceTabs).tabHeaderContainerEl.ownerDocument).toBe(targetDoc);
    expect(sourceLeaf.parent).toBe(insertedTabs);
    expect(sourceLeaf.getContainer()).toBe(popoutWindow);
    expect(sourceLeaf.containerEl.ownerDocument).toBe(targetDoc);
    expect(sourceLeaf.tabHeaderEl.ownerDocument).toBe(targetDoc);
    expect(targetDoc.body.querySelector(".workspace-drop-overlay")).toBeNull();
    expect(document.body.classList.contains("is-grabbing")).toBe(false);
    expect(targetDoc.body.classList.contains("is-grabbing")).toBe(false);
  });

  it("creates split leaves directly in a popout window document", async () => {
    const app = new App(document.body.appendChild(document.createElement("div")));
    await app.ready;
    const iframe = document.body.appendChild(document.createElement("iframe"));
    const targetWin = iframe.contentWindow;
    if (!targetWin) throw new Error("Expected iframe window");
    const targetDoc = targetWin.document;
    const popoutWindow = new WorkspaceWindow(app.workspace, targetWin);
    app.workspace.floatingSplit.appendChild(popoutWindow);
    app.workspace.floatingSplit.openPopout();
    const sourceTabs = new WorkspaceTabs(app.workspace, undefined, targetDoc);
    const sourceLeaf = new WorkspaceLeaf(app.workspace, undefined, targetDoc);
    sourceTabs.appendChild(sourceLeaf);
    popoutWindow.appendChild(sourceTabs);

    const nextLeaf = app.workspace.createLeafBySplit(sourceLeaf, "vertical");
    const nextTabs = nextLeaf.parent;

    expect(nextTabs).toBeInstanceOf(WorkspaceTabs);
    expect(nextLeaf.containerEl.ownerDocument).toBe(targetDoc);
    expect(nextLeaf.tabHeaderEl.ownerDocument).toBe(targetDoc);
    expect(nextTabs?.containerEl.ownerDocument).toBe(targetDoc);
    expect((nextTabs as WorkspaceTabs).tabHeaderContainerEl.ownerDocument).toBe(targetDoc);
    expect(nextLeaf.getContainer()).toBe(popoutWindow);
  });

  it("listens for leaf drops from a popout window back into the main workspace", async () => {
    const app = new App(document.body.appendChild(document.createElement("div")));
    await app.ready;
    const iframe = document.body.appendChild(document.createElement("iframe"));
    const sourceWin = iframe.contentWindow;
    if (!sourceWin) throw new Error("Expected iframe window");
    const sourceDoc = sourceWin.document;
    const popoutWindow = new WorkspaceWindow(app.workspace, sourceWin);
    app.workspace.floatingSplit.appendChild(popoutWindow);
    app.workspace.floatingSplit.openPopout();
    const sourceTabs = new WorkspaceTabs(app.workspace, undefined, sourceDoc);
    const sourceLeaf = new WorkspaceLeaf(app.workspace, undefined, sourceDoc);
    sourceTabs.appendChild(sourceLeaf);
    popoutWindow.appendChild(sourceTabs);
    const rootTabs = app.workspace.rootSplit.children[0];
    if (!(rootTabs instanceof WorkspaceTabs)) throw new Error("Expected root tabs");
    const rootTargetLeaf = rootTabs.children[0];
    if (!(rootTargetLeaf instanceof WorkspaceLeaf)) throw new Error("Expected root target leaf");
    const floatingChildrenBefore = app.workspace.floatingSplit.children.length;
    const closedWindows: WorkspaceWindow[] = [];
    app.workspace.on("window-close", (workspaceWindow) => closedWindows.push(workspaceWindow as WorkspaceWindow));
    setRect(sourceLeaf.containerEl, { x: 20, y: 20, width: 260, height: 180 });
    setRect(sourceLeaf.tabHeaderEl, { x: 20, y: 20, width: 100, height: 24 });
    setRect(app.workspace.rootSplit.containerEl, { x: 420, y: 0, width: 360, height: 260 });
    setRect(rootTabs.containerEl, { x: 420, y: 0, width: 360, height: 260 });
    setRect(rootTargetLeaf.containerEl, { x: 420, y: 0, width: 360, height: 260 });
    setRect(rootTargetLeaf.tabHeaderEl, { x: 420, y: 0, width: 100, height: 24 });
    const dataTransfer = createDataTransfer();

    sourceLeaf.tabHeaderEl.dispatchEvent(createDragEvent("dragstart", dataTransfer, 30, 30, sourceWin));
    window.dispatchEvent(createDragEvent("dragover", dataTransfer, 600, 130));

    const overlay = document.body.querySelector<HTMLElement>(".workspace-drop-overlay");
    expect(overlay).not.toBeNull();
    expect(overlay?.ownerDocument).toBe(document);
    expect(overlay?.parentElement).toBe(document.body);
    expect(sourceDoc.body.querySelector(".workspace-drop-overlay")).toBeNull();
    expect(document.body.classList.contains("is-grabbing")).toBe(true);
    expect(sourceDoc.body.classList.contains("is-grabbing")).toBe(true);

    window.dispatchEvent(createDragEvent("drop", dataTransfer, 600, 130));

    expect(app.workspace.floatingSplit.children).toHaveLength(floatingChildrenBefore - 1);
    expect(app.workspace.floatingSplit.children).not.toContain(popoutWindow);
    expect(app.workspace.floatingSplit.containerEl.classList.contains("is-popout-window")).toBe(false);
    expect(popoutWindow.parent).toBeNull();
    expect(popoutWindow.appContainerEl.isConnected).toBe(false);
    expect(closedWindows).toEqual([popoutWindow]);
    expect(sourceLeaf.getContainer()).toBe(app.workspace.rootSplit);
    expect(sourceLeaf.containerEl.ownerDocument).toBe(document);
    expect(sourceLeaf.tabHeaderEl.ownerDocument).toBe(document);
    expect(app.workspace.activeLeaf).toBe(sourceLeaf);
    expect(document.body.querySelector(".workspace-drop-overlay")).toBeNull();
    expect(document.body.classList.contains("is-grabbing")).toBe(false);
    expect(sourceDoc.body.classList.contains("is-grabbing")).toBe(false);
  });

  it("replaces an empty target leaf on center drop", async () => {
    const app = new App(document.body.appendChild(document.createElement("div")));
    await app.ready;
    const sourceFile = await app.vault.create("Replace.md", "replace");
    const sourceLeaf = await app.workspace.openFile(sourceFile, { active: true });
    const sourceTabs = sourceLeaf.parent;
    if (!(sourceTabs instanceof WorkspaceTabs)) throw new Error("Expected source tabs");
    const emptyLeaf = app.workspace.createLeafBySplit(sourceLeaf, "vertical");
    const targetTabs = emptyLeaf.parent;
    if (!(targetTabs instanceof WorkspaceTabs)) throw new Error("Expected empty target in tabs");
    setRect(targetTabs.containerEl, { x: 320, y: 0, width: 240, height: 160 });
    setRect(sourceLeaf.containerEl, { x: 0, y: 0, width: 240, height: 160 });
    setRect(sourceLeaf.tabHeaderEl, { x: 0, y: 0, width: 100, height: 24 });
    setRect(emptyLeaf.containerEl, { x: 320, y: 0, width: 240, height: 160 });
    setRect(emptyLeaf.tabHeaderEl, { x: 320, y: 0, width: 100, height: 24 });
    const dataTransfer = createDataTransfer();

    sourceLeaf.tabHeaderEl.dispatchEvent(createDragEvent("dragstart", dataTransfer, 10, 10));
    window.dispatchEvent(createDragEvent("dragover", dataTransfer, 440, 80));
    window.dispatchEvent(createDragEvent("drop", dataTransfer, 440, 80));

    expect(targetTabs.children).toEqual([sourceLeaf]);
    expect(targetTabs.children).not.toContain(emptyLeaf);
    expect(sourceLeaf.parent).toBe(targetTabs);
    expect(sourceTabs.parent).toBeNull();
    expect(app.workspace.rootSplit.children).toEqual([targetTabs]);
    expect(emptyLeaf.parent).toBeNull();
    expect(emptyLeaf.containerEl.isConnected).toBe(false);
    expect(emptyLeaf.tabHeaderEl.isConnected).toBe(false);
    expect(app.workspace.activeLeaf).toBe(sourceLeaf);
  });

  it("repairs an empty root split on the next layout update and restores stacked tab groups", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    app.workspace.markLayoutReady();
    const tabs = app.workspace.rootSplit.children[0];
    if (!(tabs instanceof WorkspaceTabs)) throw new Error("Expected default tabs");
    const leaf = tabs.children[0];
    if (!(leaf instanceof WorkspaceLeaf)) throw new Error("Expected default leaf");
    tabs.setStacked(true, false);

    leaf.detach();

    expect(app.workspace.rootSplit.children).toEqual([]);

    app.workspace.updateLayout();

    const repairedTabs = app.workspace.rootSplit.children[0];
    expect(repairedTabs).toBeInstanceOf(WorkspaceTabs);
    expect((repairedTabs as WorkspaceTabs).isStacked).toBe(true);
    expect((repairedTabs as WorkspaceTabs).children[0]).toBeInstanceOf(WorkspaceLeaf);
  });
});

function setRect(el: HTMLElement, rect: { x: number; y: number; width: number; height: number }): void {
  const value = new DOMRect(rect.x, rect.y, rect.width, rect.height);
  Object.defineProperty(value, "right", { configurable: true, value: rect.x + rect.width });
  Object.defineProperty(value, "bottom", { configurable: true, value: rect.y + rect.height });
  Object.defineProperty(el, "getBoundingClientRect", { configurable: true, value: () => value });
}

function createDataTransfer(): DataTransfer {
  const values = new Map<string, string>();
  return {
    dropEffect: "none",
    effectAllowed: "all",
    files: [] as unknown as FileList,
    items: [] as unknown as DataTransferItemList,
    types: [] as unknown as string[],
    clearData: (format?: string) => {
      if (format) values.delete(format);
      else values.clear();
    },
    getData: (format: string) => values.get(format) ?? "",
    setData: (format: string, value: string) => {
      values.set(format, value);
    },
    setDragImage: () => {},
  } as unknown as DataTransfer;
}

function createDragEvent(type: string, dataTransfer: DataTransfer, clientX: number, clientY: number, view: Window = window, target?: EventTarget): DragEvent {
  const EventConstructor = view.document.defaultView?.Event ?? Event;
  const event = new EventConstructor(type, { bubbles: true, cancelable: true }) as DragEvent;
  Object.defineProperty(event, "dataTransfer", { configurable: true, value: dataTransfer });
  Object.defineProperty(event, "clientX", { configurable: true, value: clientX });
  Object.defineProperty(event, "clientY", { configurable: true, value: clientY });
  Object.defineProperty(event, "view", { configurable: true, value: view });
  if (target) Object.defineProperty(event, "target", { configurable: true, value: target });
  return event;
}
