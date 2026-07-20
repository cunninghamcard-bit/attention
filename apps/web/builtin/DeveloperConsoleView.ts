import { ItemView } from "../views/ItemView";

export class DeveloperConsoleView extends ItemView {
  getViewType(): string {
    return "developer-console";
  }
  getDisplayText(): string {
    return "Developer console";
  }
  getIcon(): string {
    return "lucide-code";
  }

  async onOpen(): Promise<void> {
    this.contentEl.classList.add("developer-console-view");
    this.render();
    this.registerEvent(this.app.diagnostics.logger.on("log", () => this.render()));
    this.registerEvent(this.app.diagnostics.errors.on("error", () => this.render()));
  }

  render(): void {
    this.contentEl.replaceChildren();
    const logs = document.createElement("section");
    logs.className = "developer-console-section";
    const logsTitle = document.createElement("h3");
    logsTitle.textContent = "Logs";
    logs.appendChild(logsTitle);
    for (const entry of this.app.diagnostics.logger.list()) {
      const row = document.createElement("div");
      row.className = `log-entry log-${entry.level}`;
      row.textContent = `[${entry.level}] ${entry.scope ? `${entry.scope}: ` : ""}${entry.message}`;
      logs.appendChild(row);
    }

    const errors = document.createElement("section");
    errors.className = "developer-console-section";
    const title = document.createElement("h3");
    title.textContent = "Errors";
    errors.appendChild(title);
    for (const report of this.app.diagnostics.errors.list()) {
      const row = document.createElement("div");
      row.className = "error-report";
      row.textContent = `${report.source}: ${report.message}`;
      errors.appendChild(row);
    }

    this.contentEl.append(logs, errors);
  }
}
