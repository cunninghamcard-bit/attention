import { setIcon } from "./Icon";

/** Obsidian's native nav-folder DOM and collapse state in one place. */
export function createNavFolder(parent: HTMLElement, collapsed: boolean) {
  const doc = parent.ownerDocument;
  const folderEl = doc.createElement("div");
  folderEl.className = "tree-item nav-folder";
  const titleEl = doc.createElement("div");
  titleEl.className = "tree-item-self nav-folder-title tappable is-clickable mod-collapsible";
  const collapseEl = doc.createElement("span");
  collapseEl.className = "tree-item-icon collapse-icon nav-folder-collapse-indicator";
  setIcon(collapseEl, "right-triangle");
  const childrenEl = doc.createElement("div");
  childrenEl.className = "tree-item-children nav-folder-children";
  folderEl.append(titleEl, childrenEl);
  parent.appendChild(folderEl);

  const setCollapsed = (value: boolean): void => {
    folderEl.classList.toggle("is-collapsed", value);
    collapseEl.classList.toggle("is-collapsed", value);
    titleEl.setAttribute("aria-expanded", String(!value));
    childrenEl.hidden = value;
  };
  setCollapsed(collapsed);
  titleEl.appendChild(collapseEl);

  return { folderEl, titleEl, childrenEl, setCollapsed };
}
