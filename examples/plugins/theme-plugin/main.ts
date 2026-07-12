import { Plugin } from "../../../src/apps/web/src";

export default class ThemePlugin extends Plugin {
  async onload(): Promise<void> {
    this.registerTheme({
      id: "warm-paper",
      name: "Warm Paper",
      variables: {
        "--background-primary": "#fbf2df",
        "--background-secondary": "#f0e0c3",
        "--text-normal": "#2a2118",
        "--interactive-accent": "#a45f2b",
      },
    });
    this.registerCss(".workspace-leaf-content { border-radius: 10px; }");
  }
}
