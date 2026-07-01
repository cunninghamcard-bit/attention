import type { App } from "../app/App";
import { ConfirmationModal } from "../ui/Modal";

export interface PropertyTypeMismatchModalOptions {
  expectedType: string;
  inferredType: string;
  onUpdate: () => void;
}

export class PropertyTypeMismatchModal extends ConfirmationModal {
  constructor(app: App, options: PropertyTypeMismatchModalOptions) {
    super(app);
    this.setTitle(`Change property type to ${options.expectedType}`);
    this.setContent(`This property currently looks like ${options.inferredType}.`);
    this.addButton("mod-cta", "Update", () => {
      options.onUpdate();
      this.close();
    });
    this.addCancelButton();
  }
}
