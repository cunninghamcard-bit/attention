import { describe, expect, it, vi } from "vitest";
import { installDomExtensions } from "@web/dom/dom";
import { ConfirmationModal } from "@web/ui/Modal";
import type { App } from "@web/app/App";

installDomExtensions(window);

function fakeApp(): App {
  return { keymap: { pushScope: vi.fn(), popScope: vi.fn() } } as unknown as App;
}

describe("Modal audit fixes", () => {
  it("addCancelButton takes the button text and closes the modal on click", async () => {
    const modal = new ConfirmationModal(fakeApp());
    const close = vi.spyOn(modal, "close").mockImplementation(() => {});
    modal.addCancelButton("Keep editing");
    const cancelEl = modal.containerEl.querySelector<HTMLButtonElement>("button.mod-cancel");
    expect(cancelEl).not.toBeNull();
    expect(cancelEl!.textContent).toBe("Keep editing");
    cancelEl!.click();
    await vi.waitFor(() => expect(close).toHaveBeenCalledTimes(1));
  });

  it("addCancelButton() with no argument still renders a cancel button", () => {
    const modal = new ConfirmationModal(fakeApp());
    modal.addCancelButton();
    expect(modal.containerEl.querySelector("button.mod-cancel")).not.toBeNull();
  });
});
