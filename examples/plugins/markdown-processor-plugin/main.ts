import { Plugin } from "../../src";

export default class MarkdownProcessorPlugin extends Plugin {
  async onload(): Promise<void> {
    this.registerMarkdownCodeBlockProcessor("hello", async (source, el) => {
      el.textContent = `Hello code block says: ${source}`;
    });

    this.registerMarkdownPostProcessor((root) => {
      for (const strong of root.querySelectorAll("strong")) strong.classList.add("plugin-enhanced-strong");
    });
  }
}
