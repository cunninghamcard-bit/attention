import { createDiv, createEl, createSpan } from "../dom/dom";
import { MarkdownRenderer } from "../markdown/MarkdownRenderer";
import { setIcon } from "./Icon";

export interface ComposerAction {
  label: string;
  /** Extra button classes; the one carrying `mod-cta` gets the send glyph. */
  cls?: string;
  /** Disabled until the editor holds text. */
  requireBody?: boolean;
  run(body: string): void;
}

/** The OMG conversation composer, shared by the issue and PR pages exactly as
 * OMG shares its `conversation-comment-composer`: one bordered card holding an
 * editor pane beside a live preview, actions on a footer row. The preview is
 * the host's own MarkdownRenderer — the same renderer the timeline cards use,
 * so the preview shows precisely what the posted comment will look like.
 * Re-entry guards stay with the operations in the owning view; the composer
 * only decides whether an empty body can reach a body-requiring action. */
export function composer(
  parent: HTMLElement,
  opts: {
    placeholder: string;
    initial?: string;
    onInput?: (body: string) => void;
    actions: ComposerAction[];
  },
): { textarea: HTMLTextAreaElement } {
  const root = createDiv("gh-composer", parent);
  const panes = createDiv("gh-composer-panes", root);
  const textarea = createEl("textarea", { placeholder: opts.placeholder }, panes);
  textarea.value = opts.initial ?? "";
  const preview = createDiv("gh-composer-preview", panes);

  // Renders are async and typing outruns them: the token drops any render
  // that resolves after a newer keystroke already started the next one.
  let renderToken = 0;
  const renderPreview = (): void => {
    const token = ++renderToken;
    const body = textarea.value.trim();
    if (!body) {
      preview.empty();
      createDiv({ cls: "gh-muted", text: "Nothing to preview" }, preview);
      return;
    }
    const next = createDiv("markdown-rendered gh-markdown");
    void MarkdownRenderer.renderMarkdown(body, next, "").then(() => {
      if (token !== renderToken) return;
      preview.empty();
      preview.appendChild(next);
    });
  };
  renderPreview();

  const foot = createDiv("gh-composer-foot", root);
  createSpan({ cls: "gh-muted", text: "Markdown is supported" }, foot);
  const actionsEl = createDiv("gh-composer-actions", foot);
  const gated: HTMLButtonElement[] = [];
  for (const action of opts.actions) {
    const button = createEl(
      "button",
      { cls: `gh-composer-action ${action.cls ?? ""}`.trim(), attr: { type: "button" } },
      actionsEl,
    );
    if (action.cls?.includes("mod-cta"))
      setIcon(createSpan("gh-composer-send", button), "lucide-send");
    createSpan({ text: action.label }, button);
    if (action.requireBody) {
      button.disabled = !textarea.value.trim();
      gated.push(button);
    }
    button.addEventListener("click", () => action.run(textarea.value.trim()));
  }

  textarea.addEventListener("input", () => {
    opts.onInput?.(textarea.value);
    for (const button of gated) button.disabled = !textarea.value.trim();
    renderPreview();
  });
  return { textarea };
}
