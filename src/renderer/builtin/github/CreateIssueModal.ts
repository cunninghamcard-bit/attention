import type { App } from "../../app/App";
import { createDiv, createEl } from "../../dom/dom";
import { Modal } from "../../ui/Modal";
import { Notice } from "../../ui/Notice";
import { openGitHubDetail } from "./open";
import type { GitHubRepositoryRef } from "./types";

/** Minimal create-issue dialog for the repository Issues section. */
export class CreateIssueModal extends Modal {
  private title = "";
  private body = "";
  private submitting = false;

  constructor(
    app: App,
    private readonly repo: GitHubRepositoryRef,
  ) {
    super(app);
    this.setTitle(`New issue · ${repo.owner}/${repo.repo}`);
  }

  override onOpen(): void {
    const form = createDiv("github-create-issue", this.contentEl);
    const titleField = createDiv("github-create-issue-field", form);
    createEl("label", { text: "Title", attr: { for: "github-issue-title" } }, titleField);
    const titleInput = createEl(
      "input",
      {
        cls: "github-create-issue-title",
        attr: { id: "github-issue-title", type: "text", placeholder: "Issue title" },
      },
      titleField,
    );
    titleInput.addEventListener("input", () => {
      this.title = titleInput.value;
      submit.disabled = !this.title.trim() || this.submitting;
    });

    const bodyField = createDiv("github-create-issue-field", form);
    createEl("label", { text: "Description", attr: { for: "github-issue-body" } }, bodyField);
    const bodyInput = createEl(
      "textarea",
      {
        cls: "github-create-issue-body",
        attr: { id: "github-issue-body", rows: "6", placeholder: "Optional description" },
      },
      bodyField,
    );
    bodyInput.addEventListener("input", () => {
      this.body = bodyInput.value;
    });

    const actions = createDiv("github-create-issue-actions", form);
    const cancel = createEl(
      "button",
      { cls: "clickable-icon", text: "Cancel", attr: { type: "button" } },
      actions,
    );
    cancel.addEventListener("click", () => this.close());
    const submit = createEl(
      "button",
      { cls: "mod-cta", text: "Create issue", attr: { type: "button" } },
      actions,
    );
    submit.disabled = true;
    submit.addEventListener("click", () => void this.submit());
    titleInput.focus();
  }

  private async submit(): Promise<void> {
    const title = this.title.trim();
    if (!title || this.submitting) return;
    this.submitting = true;
    const result = await this.app.github.createIssue(
      { title, body: this.body.trim() || undefined },
      this.repo,
    );
    this.submitting = false;
    if (typeof result === "string") {
      new Notice(result);
      return;
    }
    this.close();
    new Notice(`Created issue #${result.number}`);
    await openGitHubDetail(this.app, {
      kind: "issue",
      number: result.number,
      owner: this.repo.owner,
      repo: this.repo.repo,
    });
  }
}
