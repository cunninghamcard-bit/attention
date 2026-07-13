import type { InternalPluginWrapper } from "../../../plugin/InternalPluginWrapper";
import type { WorkspacesController } from "../../../builtin/Workspaces";

/**
 * Workspaces-plugin CLI batch (carried by the workspaces core plugin).
 * Command ids, descriptions, flags, output shapes, and error strings are
 * verbatim from real Obsidian.
 */
export function registerWorkspacesCliHandlers(
  plugin: InternalPluginWrapper,
  controller: WorkspacesController,
): void {
  plugin.registerCliHandler(
    "workspaces",
    "List saved workspaces",
    { total: { description: "Return workspace count" } },
    (params) => {
      // Insertion order of the map, faithful — NOT listWorkspaces() (sorted).
      const names = Object.keys(controller.options.workspaces);
      if (params.total) return String(names.length);
      if (names.length === 0) return "No workspaces saved.";
      return names
        .map((name) => (name === controller.activeWorkspace ? `${name} (active)` : name))
        .join("\n");
    },
  );

  plugin.registerCliHandler(
    "workspace:save",
    "Save current layout as workspace",
    { name: { value: "<name>", description: "Workspace name" } },
    async (params) => {
      // name is deliberately NOT required: omitted, the handler re-saves the
      // active workspace; with neither, the error string is RETURNED, not thrown.
      const name = params.name ? String(params.name) : controller.activeWorkspace;
      if (!name) return "Missing required parameter: name\nUsage: workspace:save name=<name>";
      // Active is set before the save so one persist covers both (real shape:
      // setActiveWorkspace + fire-and-forget saveData).
      controller.setActiveWorkspace(name);
      await controller.saveCurrentWorkspace(name);
      return `Saved workspace: ${name}`;
    },
  );

  plugin.registerCliHandler(
    "workspace:load",
    "Load a saved workspace",
    { name: { value: "<name>", description: "Workspace name", required: true } },
    async (params) => {
      // Redundant with required:true, but the real handler guards manually too.
      if (!params.name) throw "Missing required parameter: name\nUsage: workspace:load name=<name>";
      const name = String(params.name);
      if (!Object.hasOwn(controller.options.workspaces, name))
        throw `Workspace "${name}" not found.`;
      // controller.loadWorkspace sets and persists the active name (real shape).
      await controller.loadWorkspace(name);
      return `Loaded workspace: ${name}`;
    },
  );

  plugin.registerCliHandler(
    "workspace:delete",
    "Delete a saved workspace",
    { name: { value: "<name>", description: "Workspace name", required: true } },
    async (params) => {
      if (!params.name)
        throw "Missing required parameter: name\nUsage: workspace:delete name=<name>";
      const name = String(params.name);
      if (!Object.hasOwn(controller.options.workspaces, name))
        throw `Workspace "${name}" not found.`;
      // Faithful: deleting the active workspace leaves `active` dangling.
      await controller.deleteWorkspace(name);
      return `Deleted workspace: ${name}`;
    },
  );
}
