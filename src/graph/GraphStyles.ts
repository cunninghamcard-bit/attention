let installed = false;

export function ensureGraphStyles(): void {
  if (installed || document.getElementById("obsidian-reconstructed-graph-styles")) {
    installed = true;
    return;
  }

  const styleEl = document.createElement("style");
  styleEl.id = "obsidian-reconstructed-graph-styles";
  styleEl.textContent = `
:root {
  --graph-controls-width: 240px;
  --graph-node: var(--interactive-accent, #7f6df2);
  --graph-node-focused: var(--text-accent, #2f8cff);
  --graph-node-tag: #3ca370;
  --graph-node-attachment: #d9822b;
  --graph-node-unresolved: var(--text-muted, #8a8a8a);
  --graph-line: color-mix(in srgb, var(--text-muted, #8a8a8a) 70%, transparent);
  --graph-text: var(--text-normal, #222);
}

.workspace-leaf-content[data-type="graph"],
.workspace-leaf-content[data-type="localgraph"] {
  overflow: hidden;
}

.graph-view {
  position: relative;
  height: 100%;
  min-height: 360px;
  background: var(--background-primary, #fff);
}

.graph-view-outer,
.graph-view-container {
  position: absolute;
  inset: 0;
}

.graph-view-container {
  overflow: hidden;
}

.graph-view-svg {
  display: block;
  width: 100%;
  height: 100%;
}

.graph-view.color-fill,
.graph-view .color-fill {
  color: var(--graph-node);
  fill: var(--graph-node);
}

.graph-view.color-fill-focused,
.graph-view .color-fill-focused {
  color: var(--graph-node-focused);
  fill: var(--graph-node-focused);
}

.graph-view.color-fill-tag,
.graph-view .color-fill-tag {
  color: var(--graph-node-tag);
  fill: var(--graph-node-tag);
}

.graph-view.color-fill-attachment,
.graph-view .color-fill-attachment {
  color: var(--graph-node-attachment);
  fill: var(--graph-node-attachment);
}

.graph-view.color-fill-unresolved,
.graph-view .color-fill-unresolved {
  color: var(--graph-node-unresolved);
  fill: var(--graph-node-unresolved);
  opacity: 0.55;
}

.graph-view.color-fill-1,
.graph-view .color-fill-1 { color: #d65d0e; fill: #d65d0e; }
.graph-view.color-fill-2,
.graph-view .color-fill-2 { color: #b57614; fill: #b57614; }
.graph-view.color-fill-3,
.graph-view .color-fill-3 { color: #98971a; fill: #98971a; }
.graph-view.color-fill-4,
.graph-view .color-fill-4 { color: #458588; fill: #458588; }
.graph-view.color-fill-5,
.graph-view .color-fill-5 { color: #665cbe; fill: #665cbe; }
.graph-view.color-fill-6,
.graph-view .color-fill-6 { color: #b16286; fill: #b16286; }

.graph-view.color-arrow,
.graph-view .color-arrow {
  color: var(--graph-line);
  fill: var(--graph-line);
}

.graph-view.color-line,
.graph-view .color-line {
  color: var(--graph-line);
  stroke: var(--graph-line);
}

.graph-view.color-text,
.graph-view .color-text {
  color: var(--graph-text);
  fill: var(--graph-text);
}

.graph-link {
  vector-effect: non-scaling-stroke;
}

.graph-node {
  cursor: pointer;
}

.graph-node-circle {
  stroke: var(--background-primary, #fff);
  stroke-width: 1.5;
}

.graph-node.is-focused .graph-node-circle {
  stroke: var(--text-accent, #2f8cff);
  stroke-width: 2.5;
}

.graph-node-label {
  font-size: 12px;
  paint-order: stroke;
  stroke: var(--background-primary, #fff);
  stroke-width: 3px;
  stroke-linejoin: round;
}

.graph-controls {
  position: absolute;
  z-index: 5;
  top: 12px;
  left: 12px;
  width: var(--graph-controls-width);
  max-height: calc(100% - 24px);
  display: flex;
  flex-direction: column;
  border: 1px solid var(--background-modifier-border, #ddd);
  border-radius: 8px;
  background: color-mix(in srgb, var(--background-primary, #fff) 94%, transparent);
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.12);
  backdrop-filter: blur(10px);
}

.graph-controls.is-close {
  width: auto;
}

.graph-controls-header {
  display: flex;
  gap: 4px;
  padding: 6px;
  border-bottom: 1px solid var(--background-modifier-border, #ddd);
}

.graph-controls.is-close .graph-controls-header {
  border-bottom: 0;
}

.graph-controls-body {
  overflow: auto;
  padding: 8px;
}

.graph-controls-button {
  border: 0;
  border-radius: 5px;
  padding: 4px 8px;
  background: var(--background-secondary, #f6f6f6);
  color: var(--text-normal, #222);
  font-size: 11px;
  cursor: pointer;
}

.graph-controls-button:hover {
  background: var(--background-modifier-hover, #ececec);
}

.graph-controls-button.mod-animate {
  margin-left: auto;
}

.graph-control-section {
  margin-bottom: 12px;
}

.graph-control-section-header {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 6px;
  border: 0;
  padding: 0;
  background: transparent;
  color: var(--text-muted, #666);
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  text-align: left;
  cursor: pointer;
}

.graph-control-section.is-collapsed {
  margin-bottom: 6px;
}

.graph-control-section.is-collapsed .graph-control-section-header {
  margin-bottom: 0;
}

.graph-control-section-body {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.graph-search-input,
.graph-color-group-query {
  box-sizing: border-box;
  width: 100%;
  border: 1px solid var(--background-modifier-border, #ddd);
  border-radius: 5px;
  padding: 5px 7px;
  background: var(--background-primary, #fff);
  color: var(--text-normal, #222);
}

.graph-control-row {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  gap: 8px;
  min-height: 28px;
  font-size: 12px;
}

.graph-control-row.mod-slider {
  grid-template-columns: 76px 1fr 34px;
}

.graph-control-value {
  color: var(--text-muted, #666);
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.graph-color-groups-container {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.graph-color-group {
  display: grid;
  grid-template-columns: 1fr 32px 32px;
  align-items: center;
  gap: 4px;
}

.graph-color-group.is-being-dragged {
  opacity: 0.45;
}

.graph-color-group-color {
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  background: transparent;
}
`;
  document.head.appendChild(styleEl);
  installed = true;
}
