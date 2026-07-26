/**
 * Input: ../core/Component
 * Output: MarkdownRenderChild
 * Pos: Application code
 *
 * 🔄 Self-reference: When this file changes, update this header
 */

import { Component } from "../core/Component";

export class MarkdownRenderChild extends Component {
  constructor(readonly containerEl: HTMLElement) {
    super();
  }
}
