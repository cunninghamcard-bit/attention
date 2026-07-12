import { Plugin } from "../../../../src/apps/web/src";

export default class BasesPlugin extends Plugin {
  async onload(): Promise<void> {
    this.app.propertyRegistry.register({ id: "status", name: "Status", type: "text" });
    this.addCommand({
      id: "open-status-base",
      name: "Open status base",
      callback: () =>
        void this.app.workspace.getLeaf("tab").setViewState({
          type: "bases",
          state: {
            name: "Status Base",
            columns: [
              { id: "file", property: "path", title: "File" },
              { id: "status", property: "status", title: "Status" },
            ],
            query: { filters: [{ property: "status", operator: "exists" }] },
          },
        }),
    });
  }
}
