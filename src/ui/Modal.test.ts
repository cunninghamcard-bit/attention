import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../app/App";
import { ConfirmationButton, ConfirmationModal, Modal } from "./Modal";

class RecordingModal extends Modal {
  openedCount = 0;
  closedCount = 0;
  sawDimOnOpen = false;
  sawBgOpacityOnOpen = "";
  sawSelfInOpenStackOnClose = false;

  override onOpen(): Promise<void> | void {
    this.openedCount += 1;
    this.sawDimOnOpen = this.containerEl.classList.contains("mod-dim");
    this.sawBgOpacityOnOpen = this.bgEl.style.opacity;
  }

  override onClose(): void {
    this.closedCount += 1;
    this.sawSelfInOpenStackOnClose = Modal.getOpenModals().includes(this);
  }
}

describe("Modal Obsidian base behavior", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
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

  afterEach(() => {
    Modal.closeAll();
  });

  it("matches Obsidian modal DOM order and close icon structure", () => {
    const app = new App(document.createElement("div"));
    const modal = new Modal(app).setTitle("Modal title").setContent("Body");

    expect(modal.app).toBe(app);
    expect([...modal.containerEl.children].map((child) => child.className)).toEqual(["modal-bg", "modal"]);
    expect([...modal.modalEl.children].map((child) => child.className)).toEqual([
      "modal-close-button mod-raised clickable-icon",
      "modal-header",
      "modal-content",
    ]);
    expect(modal.buttonEl.parentElement).toBeNull();
    expect([...modal.headerEl.children].map((child) => child.className)).toEqual(["modal-title"]);
    expect(modal.closeButtonEl.parentElement).toBe(modal.modalEl);
    expect(modal.closeButtonEl.querySelector("svg")?.classList.contains("lucide-x")).toBe(true);
    expect(modal.titleEl.textContent).toBe("Modal title");
    expect(modal.contentEl.textContent).toBe("Body");
  });

  it("keeps the base modal button row detached until compatibility button APIs are used", () => {
    const app = new App(document.createElement("div"));
    const modal = new Modal(app);
    const callback = vi.fn();

    expect(modal.modalEl.querySelector(".modal-button-container")).toBeNull();

    modal.addButton("mod-cta", "Run", callback).addCancelButton();

    expect(modal.buttonEl.parentElement).toBe(modal.modalEl);
    expect([...modal.modalEl.children].map((child) => child.className)).toEqual([
      "modal-close-button mod-raised clickable-icon",
      "modal-header",
      "modal-content",
      "modal-button-container",
    ]);
    expect(modal.buttonEl.querySelector("button")?.textContent).toBe("Run");
  });

  it("respects prevented Escape events and closes on unprevented Escape", () => {
    const app = new App(document.createElement("div"));
    const modal = new Modal(app);
    modal.open();
    const prevented = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
    prevented.preventDefault();

    expect(modal.scope.handleKey(prevented)).toBe(false);
    expect(modal.containerEl.parentElement).toBe(document.body);

    expect(modal.scope.handleKey(new KeyboardEvent("keydown", { key: "Escape" }))).toBe(false);
    expect(modal.containerEl.parentElement).toBeNull();
  });

  it("applies dim background settings on open while setters only update stored state", () => {
    const app = new App(document.createElement("div"));
    const modal = new RecordingModal(app)
      .setBackgroundOpacity("0.42")
      .setDimBackground(false);

    modal.open();

    expect(modal.sawDimOnOpen).toBe(false);
    expect(modal.sawBgOpacityOnOpen).toBe("");
    expect(modal.containerEl.classList.contains("mod-dim")).toBe(false);
    expect(modal.bgEl.style.opacity).toBe("0");

    modal.setDimBackground(true);
    modal.setBackgroundOpacity("0.9");
    expect(modal.containerEl.classList.contains("mod-dim")).toBe(false);
    expect(modal.bgEl.style.opacity).toBe("0");

    modal.close();
    modal.open();

    expect(modal.sawDimOnOpen).toBe(false);
    expect(modal.sawBgOpacityOnOpen).toBe("0");
    expect(modal.containerEl.classList.contains("mod-dim")).toBe(true);
    expect(modal.bgEl.style.opacity).toBe("0.9");
  });

  it("sets string content but appends node content like Obsidian", () => {
    const app = new App(document.createElement("div"));
    const modal = new Modal(app);
    const first = document.createElement("p");
    const second = document.createElement("strong");
    first.textContent = "First";
    second.textContent = "Second";

    modal.setContent("Intro");
    expect(modal.contentEl.textContent).toBe("Intro");

    modal.setContent(first).setContent(second);
    expect([...modal.contentEl.children].map((child) => child.textContent)).toEqual(["First", "Second"]);

    modal.setContent("Reset");
    expect(modal.contentEl.textContent).toBe("Reset");
    expect(modal.contentEl.children).toHaveLength(0);

    const fragment = document.createDocumentFragment();
    const span = document.createElement("span");
    span.textContent = "Fragment";
    fragment.appendChild(span);
    expect(modal.setContent(fragment)).toBe(modal);
    expect(modal.contentEl.lastElementChild).toBe(span);
  });

  it("does not reopen a modal already attached to the document", () => {
    const app = new App(document.createElement("div"));
    const modal = new RecordingModal(app);

    modal.open();
    modal.open();

    expect(modal.openedCount).toBe(1);
    expect(document.body.querySelectorAll(".modal-container")).toHaveLength(1);
  });

  it("tracks open modals and closes them from the top", () => {
    const app = new App(document.createElement("div"));
    const first = new Modal(app);
    const second = new Modal(app);

    first.open();
    second.open();
    expect(Modal.getOpenModals()).toEqual([first, second]);

    Modal.closeAll();

    expect(Modal.getOpenModals()).toEqual([]);
    expect(document.body.querySelector(".modal-container")).toBeNull();
  });

  it("runs onClose and close callbacks exactly once per open", () => {
    const app = new App(document.createElement("div"));
    const modal = new RecordingModal(app);
    const callback = vi.fn(() => "ignored");

    expect(modal.setCloseCallback(callback)).toBe(modal);
    modal.open();
    modal.close();
    modal.close();

    expect(modal.closedCount).toBe(1);
    expect(modal.sawSelfInOpenStackOnClose).toBe(true);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(Modal.getOpenModals()).not.toContain(modal);
  });

  it("closes from the close button, unprevented backdrop clicks, and history back", () => {
    const app = new App(document.createElement("div"));
    const closeButtonModal = new Modal(app);
    closeButtonModal.open();
    closeButtonModal.closeButtonEl.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(closeButtonModal.containerEl.parentElement).toBeNull();

    const preventedBackdropModal = new Modal(app);
    preventedBackdropModal.open();
    const prevented = new MouseEvent("click", { bubbles: true, cancelable: true });
    prevented.preventDefault();
    preventedBackdropModal.bgEl.dispatchEvent(prevented);
    expect(preventedBackdropModal.containerEl.parentElement).toBe(document.body);
    preventedBackdropModal.bgEl.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(preventedBackdropModal.containerEl.parentElement).toBeNull();

    const historyModal = new Modal(app);
    historyModal.open();
    historyModal.onHistoryBack();
    expect(historyModal.containerEl.parentElement).toBeNull();
  });

  it("builds ConfirmationModal button rows with Obsidian button semantics", async () => {
    const app = new App(document.createElement("div"));
    const modal = new ConfirmationModal(app).setTitle("Confirm").setContent("Delete this?");
    const confirm = vi.fn();
    const stayOpen = vi.fn().mockResolvedValue(true);
    const checkbox = vi.fn();

    modal
      .addClass("mod-danger")
      .addCheckbox("Also delete attachments", checkbox)
      .addButton((button) => {
        expect(button).toBeInstanceOf(ConfirmationButton);
        button
          .setButtonText("Details")
          .setSecondary()
          .onClick(stayOpen);
      })
      .addButton((button) => {
        button
          .setButtonText("Delete")
          .setDestructive()
          .setInitialFocus()
          .onClick(confirm);
      })
      .addCancelButton();

    modal.open();

    expect(modal.containerEl.classList.contains("mod-confirmation")).toBe(true);
    expect(modal.modalEl.classList.contains("mod-confirmation")).toBe(false);
    expect(modal.modalEl.classList.contains("mod-danger")).toBe(true);
    expect(modal.buttonContainerEl).toBe(modal.buttonEl);
    expect(document.activeElement).toBe([...modal.buttonContainerEl.querySelectorAll("button")][1]);

    const input = modal.buttonContainerEl.querySelector<HTMLInputElement>(".mod-checkbox input");
    input?.click();
    expect(input?.tabIndex).toBe(-1);
    expect(checkbox).toHaveBeenCalledTimes(1);
    expect(checkbox.mock.calls[0]?.[0]).toBeInstanceOf(MouseEvent);
    expect(checkbox.mock.calls[0]?.[0].target).toBe(input);

    const [detailsButton, deleteButton, cancelButton] = [...modal.buttonContainerEl.querySelectorAll<HTMLButtonElement>("button")];
    expect(detailsButton.classList.contains("mod-secondary")).toBe(true);
    expect(deleteButton.classList.contains("mod-destructive")).toBe(true);
    expect(cancelButton.classList.contains("mod-cancel")).toBe(true);

    detailsButton.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(stayOpen).toHaveBeenCalledTimes(1);
    expect(modal.containerEl.parentElement).toBe(document.body);

    deleteButton.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(modal.containerEl.parentElement).toBeNull();
  });

  it("keeps ConfirmationModal string buttons open only when callbacks return truthy", async () => {
    const app = new App(document.createElement("div"));
    const modal = new ConfirmationModal(app);
    const keepOpen = vi.fn().mockResolvedValue(true);
    const close = vi.fn().mockResolvedValue(undefined);

    modal
      .addButton(["mod-secondary"], "Details", keepOpen)
      .addButton("mod-cta", "Accept", close);
    modal.open();

    const [detailsButton, acceptButton] = [...modal.buttonContainerEl.querySelectorAll<HTMLButtonElement>("button")];
    expect(detailsButton.className).toBe("mod-secondary");

    detailsButton.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(keepOpen).toHaveBeenCalledTimes(1);
    expect(modal.containerEl.parentElement).toBe(document.body);

    acceptButton.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(close).toHaveBeenCalledTimes(1);
    expect(modal.containerEl.parentElement).toBeNull();
  });
});
