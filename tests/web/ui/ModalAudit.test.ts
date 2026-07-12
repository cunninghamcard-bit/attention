import { describe, expect, it, vi } from "vitest";
import { installDomExtensions } from "@web/dom/dom";
import { ConfirmationModal } from "@web/ui/Modal";
import type { App } from "@web/app/App";

installDomExtensions(window);

function fakeApp(): App {
  return { keymap: { pushScope: vi.fn(), popScope: vi.fn() } } as unknown as App;
}

describe("Modal audit fixes", () => {
  it("addCancelButton takes a callback (no string overload) and closes", () => {
    const modal = new ConfirmationModal(fakeApp());
    const cb = vi.fn();
    modal.addCancelButton(cb);
    const cancelEl = modal.containerEl.querySelector<HTMLButtonElement>("button.mod-cancel");
    expect(cancelEl).not.toBeNull();
    expect(cancelEl!.textContent).toBe("Cancel");
    cancelEl!.click();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("addCancelButton() with no argument still renders a cancel button", () => {
    const modal = new ConfirmationModal(fakeApp());
    modal.addCancelButton();
    expect(modal.containerEl.querySelector("button.mod-cancel")).not.toBeNull();
  });
});
