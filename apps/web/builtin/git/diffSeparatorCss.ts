/**
 * Input: (none)
 * Output: DIFF_SEPARATOR_CSS
 * Pos: Application code
 *
 * 🔄 Self-reference: When this file changes, update this header
 */

/**
 * Hunk separator restyle for @pierre/diffs, shared by the changes sidebar and
 * the review surface.
 *
 * The separator lives inside the FileDiff's shadow root, so this cannot sit in
 * a stylesheet with the rest of our CSS — `unsafeCSS` is the library's own hook
 * for it, injected as `@layer unsafe`, its last layer, so no specificity fight.
 * Only Obsidian tokens are consumed; none are redefined.
 *
 * Stock, the separator paints a filled band across the full content width, with
 * a pointer cursor and a hover underline on top of it. That reads as the row's
 * primary button — louder than the file header that actually opens the file.
 * Three things paint that band: the separator element's own background, the
 * expand button, and the content cell. All three drop to a plain caption here;
 * the expand affordance itself stays.
 *
 * Dropping the fill alone is not enough. Stock, the row's chevron sits at the
 * same x as the file header's chevron directly above it, so a bare caption
 * reads as that header's sibling rather than as something inside the file. The
 * indent below pushes the chevron off that column. It is deliberately a rough
 * offset, not gutter alignment: the line-number column grows with digit count,
 * so any fixed value that lined up on a 2-digit file would drift on a 4-digit
 * one, and "clearly indented" survives that where "exactly aligned" does not.
 */
export const DIFF_SEPARATOR_CSS = `
[data-separator="line-info-basic"] {
  height: 24px;
  background-color: transparent;
}
[data-expand-index] [data-separator-wrapper] {
  padding-left: 24px;
  grid-template-columns: 24px max-content;
}
[data-expand-index] [data-separator-wrapper][data-separator-multi-button] {
  grid-template-columns: 24px 24px max-content;
}
[data-expand-button],
[data-separator-content] {
  background: transparent;
}
[data-expand-button] {
  min-width: 24px;
  border-right: none;
  color: var(--text-faint);
}
[data-expand-button]:hover {
  color: var(--text-normal);
}
[data-separator-content] {
  color: var(--text-faint);
  font-size: var(--font-ui-smaller);
}
`;
