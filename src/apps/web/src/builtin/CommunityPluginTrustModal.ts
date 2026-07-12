import type { App } from "../app/App";
import { ConfirmationModal } from "../ui/Modal";

export class CommunityPluginTrustModal extends ConfirmationModal {
  constructor(app: App) {
    super(app);
    this.modalEl.classList.add("mod-lg", "mod-trust-folder");
    this.setTitle("Do you trust the author of this vault?");
  }

  onOpen(): void {
    this.contentEl.replaceChildren();
    const buttonEl = this.buttonContainerEl;
    buttonEl.replaceChildren();

    this.contentEl.append(
      paragraph("You're opening this vault for the first time, and it comes with some plugins."),
      paragraph(
        "If you obtained this vault from someone else, please note that plugins of unknown origin might pose security risks.",
      ),
      paragraph(
        "If you do not fully trust the author of this vault, we recommend staying in Restricted Mode, so the plugins in this vault do not run.",
      ),
    );

    buttonEl.append(
      this.createButton("Trust author and enable plugins", true),
      this.createButton("Browse vault in Restricted Mode", false),
    );
  }

  private createButton(text: string, enabled: boolean): HTMLButtonElement {
    const buttonEl = document.createElement("button");
    buttonEl.type = "button";
    buttonEl.textContent = text;
    buttonEl.addEventListener("click", () => {
      buttonEl.disabled = true;
      this.close();
      void this.app.pluginInstaller.setCommunityPluginsEnabled(enabled).then(() => {
        this.app.setting.open();
        this.app.setting.openTabById("community-plugins");
      });
    });
    return buttonEl;
  }
}

function paragraph(text: string): HTMLParagraphElement {
  const el = document.createElement("p");
  el.textContent = text;
  return el;
}
