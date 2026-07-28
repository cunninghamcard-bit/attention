/**
 * Input: (none)
 * Output: DIFF_CHROME_CSS
 * Pos: Application code
 *
 * 🔄 Self-reference: When this file changes, update this header
 */

/**
 * Chrome restyle for @pierre/diffs — the hunk separators and the line-number
 * gutter, i.e. everything around the code but not the code.
 *
 * It all lives inside the FileDiff's shadow root, so this cannot sit in a
 * stylesheet with the rest of our CSS — `unsafeCSS` is the library's own hook
 * for it, injected as `@layer unsafe`, its last layer, so no specificity fight.
 * Only Obsidian tokens are consumed; none are redefined.
 *
 * ## Separators
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
 *
 * ## Line-number gutter
 *
 * Stock, the number cell is 2ch of left padding + a 3ch minimum for the digits
 * + 1ch of right padding, all at the code's own font size (app's style.js:
 * `[data-column-number]`, `[data-gutter-buffer]`). That is six characters of
 * chrome per side, and a split diff has two sides, so twelve characters of the
 * pane are spent before any code — and because the unit is `ch`, raising the
 * text size widens the chrome in lockstep with the code it is stealing from.
 *
 * Obsidian's own line numbers answer this: `.cm-gutters` (app.css:3533) drops
 * to `--font-ui-smaller` with tabular figures. Matching that is also the whole
 * fix, because `ch` resolves against this element — one smaller font-size
 * shrinks the digits and the padding together. The padding then goes symmetric
 * at 1ch; 2ch on the left only existed to clear the 4px change bar, which is
 * absolutely positioned and takes no space.
 *
 * The line box is unchanged: `--diffs-line-height` is a length, not a unitless
 * multiplier, so the smaller digits still occupy a full code row.
 */
export const DIFF_CHROME_CSS = `
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
[data-column-number],
[data-gutter-buffer] {
  padding-left: 1ch;
  font-size: var(--font-ui-smaller);
  font-variant-numeric: tabular-nums;
}
`;
