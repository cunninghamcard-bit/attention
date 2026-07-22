import type { GraphDisplayOptions, GraphForceOptions } from "./GraphOptions";
import { DEFAULT_GRAPH_DISPLAY_OPTIONS, DEFAULT_GRAPH_FORCE_OPTIONS } from "./GraphOptions";
import type { GraphData, GraphLink, GraphNode } from "./GraphDataEngine";

export interface GraphRendererCallbacks {
  onNodeClick?: (node: GraphNode, event: MouseEvent | PointerEvent) => void;
  onNodeRightClick?: (node: GraphNode, event: MouseEvent) => void;
  onNodeHover?: (node: GraphNode | null) => void;
  onScaleChange?: (scale: number) => void;
}

export interface GraphWorkerLike {
  onmessage: ((event: { data: GraphWorkerResult }) => void) | null;
  postMessage(message: GraphWorkerRequest): void;
  terminate(): void;
}

export interface GraphRendererOptions {
  iframeMode?: boolean;
  hidePowerTag?: boolean;
  worker?: GraphWorkerLike;
}

interface GraphWorkerNode {
  id: string;
  type: GraphNode["type"];
  color?: string;
  links: number;
}

interface GraphWorkerRequest {
  nodes?: GraphWorkerNode[];
  links?: Record<string, Record<string, boolean>>;
  forces?: Partial<GraphForceOptions>;
  alpha?: number;
  alphaTarget?: number;
  run?: boolean;
  forceNode?: { id: string; x: number | null; y: number | null };
}

interface GraphWorkerResult {
  ignore?: boolean;
  nodes?: Record<string, { x: number; y: number }>;
}

type TouchGesture =
  | { mode: "pan"; x: number; y: number; panX: number; panY: number }
  | {
      mode: "pinch";
      distance: number;
      center: { x: number; y: number };
      scale: number;
      panX: number;
      panY: number;
    };

export class GraphRenderer {
  private data: GraphData = { nodes: [], links: [], focusedId: null, hasFilter: false };
  private displayOptions: GraphDisplayOptions = { ...DEFAULT_GRAPH_DISPLAY_OPTIONS };
  private forceOptions: GraphForceOptions = { ...DEFAULT_GRAPH_FORCE_OPTIONS };
  private readonly worker: GraphWorkerLike;
  private workerResults: GraphWorkerResult | null = null;
  private svg: SVGSVGElement | null = null;
  private readonly markerId = `graph-arrow-${Math.random().toString(36).slice(2)}`;
  private width = 960;
  private height = 640;
  private viewBox = "0 0 960 640";
  private scale = 1;
  private targetScale = 1;
  private panX = 0;
  private panY = 0;
  private progression = 0;
  private progressionTimer: number | undefined;
  private draggingNodeId: string | null = null;
  private dragMoved = false;
  private panning = false;
  private panVelocityX = 0;
  private panVelocityY = 0;
  private panInertiaTimer: number | undefined;
  private touchGesture: TouchGesture | null = null;

  constructor(
    private readonly containerEl: HTMLElement,
    private readonly callbacks: GraphRendererCallbacks = {},
    options: GraphRendererOptions = {},
  ) {
    this.worker = options.worker ?? createGraphWorker();
    this.worker.onmessage = (event) => {
      if (event.data.ignore) return;
      this.workerResults = event.data;
      this.changed();
    };
    this.containerEl.addEventListener("mousedown", (event) => event.preventDefault());
    this.containerEl.addEventListener("wheel", (event) => this.onWheel(event), { passive: false });
    this.containerEl.addEventListener("pointerdown", (event) => this.startPan(event));
    this.containerEl.addEventListener("touchstart", (event) => this.onTouchStart(event), {
      passive: false,
    });
    this.containerEl.addEventListener("touchmove", (event) => this.onTouchMove(event), {
      passive: false,
    });
    this.containerEl.addEventListener("touchend", () => this.onTouchEnd());
    this.containerEl.addEventListener("touchcancel", () => this.onTouchEnd());
  }

  setData(data: GraphData): void {
    this.data = this.layout(data);
    this.postWorkerData();
    this.changed();
  }

  setRenderOptions(options: GraphDisplayOptions): void {
    if (typeof options.nodeSizeMultiplier === "number")
      this.displayOptions.nodeSizeMultiplier = options.nodeSizeMultiplier;
    if (typeof options.lineSizeMultiplier === "number")
      this.displayOptions.lineSizeMultiplier = options.lineSizeMultiplier;
    if (typeof options.textFadeMultiplier === "number")
      this.displayOptions.textFadeMultiplier = options.textFadeMultiplier;
    if (typeof options.showArrow === "boolean") this.displayOptions.showArrow = options.showArrow;
    this.changed();
  }

  setForces(options: GraphForceOptions): void {
    this.forceOptions = { ...this.forceOptions, ...options };
    this.worker.postMessage({ forces: options, alpha: 0.3, run: true });
    this.data = this.layout(this.data);
    this.changed();
  }

  setAnimating(animate: boolean): void {
    this.containerEl.classList.toggle("is-animating", animate);
    if (animate) this.renderProgression();
    else this.stopProgression();
  }

  renderProgression(): void {
    this.stopProgression();
    this.progression = 1;
    const speed = Math.max(5, Math.min(100, 0.5 * Math.sqrt(Math.max(1, this.data.nodes.length))));
    const tick = () => {
      const start = performance.now();
      const shouldContinue = this.render();
      const elapsed = Math.max(16, performance.now() - start);
      this.progression = Math.max(0, this.progression - (speed * elapsed) / 1000);
      if (this.progression > 0 && shouldContinue) {
        this.progressionTimer = window.requestAnimationFrame(tick);
      } else {
        this.progression = 0;
        this.progressionTimer = undefined;
        this.containerEl.classList.remove("is-animating");
      }
    };
    tick();
  }

  resetPan(): void {
    this.panX = 0;
    this.panY = 0;
    this.setScale(1, true);
  }

  setScale(scale: number, notify = false): void {
    this.targetScale = clamp(scale, 1 / 128, 8);
    this.scale = this.targetScale;
    this.updateViewBox();
    if (notify) this.callbacks.onScaleChange?.(this.scale);
  }

  getScale(): number {
    return this.scale;
  }

  onResize(): void {
    const rect = this.containerEl.getBoundingClientRect();
    if (rect.width > 0) this.width = Math.max(480, rect.width);
    if (rect.height > 0) this.height = Math.max(360, rect.height);
    this.updateViewBox();
    this.data = this.layout(this.data);
    this.render();
  }

  destroy(): void {
    this.stopProgression();
    this.stopPanInertia();
    this.worker.terminate();
    this.containerEl.replaceChildren();
    this.svg = null;
  }

  getTransparentScreenshot(): HTMLCanvasElement {
    return this.renderToCanvas(false);
  }

  getBackgroundScreenshot(): HTMLCanvasElement {
    return this.renderToCanvas(true);
  }

  static async copyToClipboard(canvas: HTMLCanvasElement, type = "image/png"): Promise<void> {
    const clipboard = navigator.clipboard as
      | (Clipboard & { write?: (items: ClipboardItem[]) => Promise<void> })
      | undefined;
    if (clipboard?.write && typeof ClipboardItem !== "undefined") {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type));
      if (blob) {
        await clipboard.write([new ClipboardItem({ [type]: blob })]);
        return;
      }
    }
    await navigator.clipboard?.writeText(canvas.toDataURL(type));
  }

  testCSS(className: string): string {
    const sample = document.createElement("div");
    sample.className = `graph-view ${className}`;
    sample.style.cssText = "position:absolute;left:-9999px;top:-9999px;";
    document.body.appendChild(sample);
    const styles = getComputedStyle(sample);
    const color = styles.color || styles.backgroundColor || "";
    sample.remove();
    return color;
  }

  private changed(): void {
    this.render();
  }

  private render(): boolean {
    const data = this.applyWorkerResults(this.data);
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.classList.add("graph-view-svg");
    svg.setAttribute("viewBox", this.viewBox);
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "Graph view");
    this.svg = svg;

    const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
    const marker = document.createElementNS("http://www.w3.org/2000/svg", "marker");
    marker.setAttribute("id", this.markerId);
    marker.setAttribute("viewBox", "0 0 10 10");
    marker.setAttribute("refX", "9");
    marker.setAttribute("refY", "5");
    marker.setAttribute("markerWidth", "7");
    marker.setAttribute("markerHeight", "7");
    marker.setAttribute("orient", "auto-start-reverse");
    const markerPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
    markerPath.classList.add("color-arrow");
    markerPath.setAttribute("d", "M 0 0 L 10 5 L 0 10 z");
    marker.appendChild(markerPath);
    defs.appendChild(marker);
    svg.appendChild(defs);

    const linkLayer = document.createElementNS("http://www.w3.org/2000/svg", "g");
    linkLayer.classList.add("graph-link-layer");
    const nodeLayer = document.createElementNS("http://www.w3.org/2000/svg", "g");
    nodeLayer.classList.add("graph-node-layer");
    const nodeById = new Map(data.nodes.map((node) => [node.id, node]));

    for (const link of data.links) {
      const from = nodeById.get(link.from);
      const to = nodeById.get(link.to);
      if (!from || !to) continue;
      linkLayer.appendChild(this.renderLink(link, from, to));
    }

    for (const node of data.nodes) nodeLayer.appendChild(this.renderNode(node));

    svg.append(linkLayer, nodeLayer);
    this.containerEl.replaceChildren(svg);
    return this.progression > 0;
  }

  private renderLink(link: GraphLink, from: GraphNode, to: GraphNode): SVGLineElement {
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.classList.add("graph-link", "color-line");
    if (!link.resolved) line.classList.add("is-unresolved");
    line.setAttribute("x1", String(from.x));
    line.setAttribute("y1", String(from.y));
    line.setAttribute("x2", String(to.x));
    line.setAttribute("y2", String(to.y));
    line.setAttribute(
      "stroke-width",
      String(Math.max(0.5, this.displayOptions.lineSizeMultiplier * 1.5)),
    );
    if (this.displayOptions.showArrow) line.setAttribute("marker-end", `url(#${this.markerId})`);
    return line;
  }

  private renderNode(node: GraphNode): SVGGElement {
    const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
    group.classList.add("graph-node", node.colorClass);
    if (node.focused) group.classList.add("is-focused");
    if (!node.resolved) group.classList.add("is-unresolved");
    group.dataset.path = node.id;
    group.setAttribute("transform", `translate(${node.x}, ${node.y})`);
    group.addEventListener("click", (event) => {
      if (this.dragMoved) return;
      this.callbacks.onNodeClick?.(node, event);
    });
    group.addEventListener("pointerdown", (event) => this.startNodeDrag(node, event));
    group.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      this.callbacks.onNodeRightClick?.(node, event);
    });
    group.addEventListener("mouseenter", () => this.callbacks.onNodeHover?.(node));
    group.addEventListener("mouseleave", () => this.callbacks.onNodeHover?.(null));

    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.classList.add("graph-node-circle", node.colorClass);
    circle.setAttribute("r", String(this.nodeRadius(node)));
    if (node.color) circle.setAttribute("fill", node.color);

    const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
    label.classList.add("graph-node-label", "color-text");
    label.setAttribute("x", String(this.nodeRadius(node) + 5));
    label.setAttribute("y", "4");
    label.setAttribute(
      "opacity",
      String(Math.max(0.2, 1 - this.displayOptions.textFadeMultiplier * 0.7)),
    );
    label.textContent = node.label;

    group.append(circle, label);
    return group;
  }

  private layout(data: GraphData): GraphData {
    const nodes = data.nodes.map((node) => ({ ...node }));
    const links = data.links.map((link) => ({ ...link }));
    const focused = data.focusedId
      ? (nodes.find((node) => node.id === data.focusedId) ?? null)
      : null;
    const sorted = [...nodes].sort((a, b) =>
      a.label.localeCompare(b.label, undefined, { sensitivity: "base", numeric: true }),
    );
    const rest = focused ? sorted.filter((node) => node !== focused) : sorted;
    const centerX = this.width / 2;
    const centerY = this.height / 2;
    const baseDistance = Math.max(120, Math.min(310, this.forceOptions.linkDistance));
    const radius = Math.max(
      baseDistance,
      Math.min(340, 56 + rest.length * 11 + this.forceOptions.repelStrength * 2),
    );

    if (focused) {
      focused.x = centerX;
      focused.y = centerY;
    }

    rest.forEach((node, index) => {
      const angle =
        rest.length === 1
          ? -Math.PI / 2
          : (Math.PI * 2 * index) / Math.max(1, rest.length) - Math.PI / 2;
      const connectedToFocus =
        !!focused &&
        links.some(
          (link) =>
            (link.from === focused.id && link.to === node.id) ||
            (link.to === focused.id && link.from === node.id),
        );
      const nodeRadius =
        focused && connectedToFocus
          ? radius * Math.max(0.4, this.forceOptions.linkStrength * 0.72)
          : radius;
      node.x = centerX + Math.cos(angle) * nodeRadius;
      node.y = centerY + Math.sin(angle) * nodeRadius;
    });

    return { ...data, nodes: focused ? [focused, ...rest] : rest, links };
  }

  private applyWorkerResults(data: GraphData): GraphData {
    if (!this.workerResults?.nodes) return data;
    return {
      ...data,
      nodes: data.nodes.map((node) => {
        const workerNode = this.workerResults?.nodes?.[node.id];
        return workerNode ? { ...node, x: workerNode.x, y: workerNode.y } : node;
      }),
    };
  }

  private postWorkerData(): void {
    const links: Record<string, Record<string, boolean>> = {};
    for (const link of this.data.links) {
      if (!links[link.from]) links[link.from] = {};
      links[link.from][link.to] = true;
    }
    this.worker.postMessage({
      nodes: this.data.nodes.map((node) => ({
        id: node.id,
        type: node.type,
        color: node.color,
        links: node.links,
      })),
      links,
      alpha: 0.3,
      run: true,
    });
  }

  private renderToCanvas(background: boolean): HTMLCanvasElement {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(this.width));
    canvas.height = Math.max(1, Math.round(this.height));
    const ctx = canvas.getContext("2d");
    if (!ctx) return canvas;
    if (background) {
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    const view = this.getCurrentViewBox();
    ctx.save();
    ctx.scale(canvas.width / view.width, canvas.height / view.height);
    ctx.translate(-view.x, -view.y);
    const data = this.applyWorkerResults(this.data);
    const nodeById = new Map(data.nodes.map((node) => [node.id, node]));
    ctx.strokeStyle = "rgba(120, 120, 120, 0.65)";
    ctx.lineWidth = Math.max(0.5, this.displayOptions.lineSizeMultiplier * 1.5);
    for (const link of data.links) {
      const from = nodeById.get(link.from);
      const to = nodeById.get(link.to);
      if (!from || !to) continue;
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
    }
    ctx.font = "12px sans-serif";
    ctx.textBaseline = "middle";
    for (const node of data.nodes) {
      const radius = this.nodeRadius(node);
      ctx.fillStyle = node.color ?? canvasNodeColor(node);
      ctx.beginPath();
      ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = background ? "#222222" : "rgba(30, 30, 30, 0.9)";
      ctx.fillText(node.label, node.x + radius + 5, node.y);
    }
    ctx.restore();
    return canvas;
  }

  private startNodeDrag(node: GraphNode, event: PointerEvent): void {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    this.draggingNodeId = node.id;
    this.dragMoved = false;
    const target = event.currentTarget as SVGElement;
    target.setPointerCapture?.(event.pointerId);
    const startPoint = this.getSvgPoint(event);

    const move = (moveEvent: PointerEvent) => {
      if (this.draggingNodeId !== node.id) return;
      const point = this.getSvgPoint(moveEvent);
      const movedDistance = (point.x - startPoint.x) ** 2 + (point.y - startPoint.y) ** 2;
      if (!this.dragMoved && movedDistance <= 25) return;
      this.dragMoved = true;
      this.workerResults = {
        ...(this.workerResults ?? {}),
        nodes: {
          ...(this.workerResults?.nodes ?? {}),
          [node.id]: point,
        },
      };
      this.worker.postMessage({
        alpha: 0.3,
        alphaTarget: 0.3,
        run: true,
        forceNode: { id: node.id, x: point.x, y: point.y },
      });
      this.changed();
    };

    const up = () => {
      if (this.draggingNodeId === node.id) {
        this.worker.postMessage({ alphaTarget: 0, forceNode: { id: node.id, x: null, y: null } });
      }
      this.draggingNodeId = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.setTimeout(() => (this.dragMoved = false));
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
  }

  private getSvgPoint(event: PointerEvent): { x: number; y: number } {
    if (!this.svg) return { x: event.clientX, y: event.clientY };
    const point = this.svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const matrix = this.svg.getScreenCTM();
    if (!matrix) return { x: event.clientX, y: event.clientY };
    const transformed = point.matrixTransform(matrix.inverse());
    return { x: transformed.x, y: transformed.y };
  }

  private onWheel(event: WheelEvent): void {
    event.preventDefault();
    let deltaY = event.deltaY;
    if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) deltaY *= 40;
    if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) deltaY *= 800;
    const nextScale = clamp(this.targetScale * Math.pow(1.5, -deltaY / 120), 1 / 128, 8);
    const rect = this.containerEl.getBoundingClientRect();
    const center =
      deltaY < 0 ? { x: event.clientX - rect.left, y: event.clientY - rect.top } : { x: 0, y: 0 };
    this.zoomTo(nextScale, center);
  }

  private zoomTo(nextScale: number, center: { x: number; y: number }): void {
    const focal =
      center.x === 0 && center.y === 0 ? { x: this.width / 2, y: this.height / 2 } : center;
    const before = this.screenToWorld(focal.x, focal.y);
    this.targetScale = clamp(nextScale, 1 / 128, 8);
    this.scale = this.scale * 0.85 + this.targetScale * 0.15;
    const after = this.screenToWorld(focal.x, focal.y);
    this.panX += after.x - before.x;
    this.panY += after.y - before.y;
    this.updateViewBox();
    this.callbacks.onScaleChange?.(this.scale);
  }

  private startPan(event: PointerEvent): void {
    if (event.pointerType === "touch") return;
    if (event.button !== 0 || event.target !== this.svg) return;
    event.preventDefault();
    this.stopPanInertia();
    this.panning = true;
    document.body.classList.add("is-grabbing");
    const start = {
      x: event.clientX,
      y: event.clientY,
      panX: this.panX,
      panY: this.panY,
      time: performance.now(),
    };
    let last = start;
    let moved = false;
    const move = (moveEvent: PointerEvent) => {
      if (!this.panning) return;
      const totalDistance = (moveEvent.clientX - start.x) ** 2 + (moveEvent.clientY - start.y) ** 2;
      if (!moved && totalDistance <= 9) return;
      moved = true;
      const now = performance.now();
      const elapsed = Math.max(1, now - last.time);
      this.panVelocityX = ((moveEvent.clientX - last.x) / elapsed / this.scale) * 16;
      this.panVelocityY = ((moveEvent.clientY - last.y) / elapsed / this.scale) * 16;
      this.panX = start.panX + (moveEvent.clientX - start.x) / this.scale;
      this.panY = start.panY + (moveEvent.clientY - start.y) / this.scale;
      last = {
        x: moveEvent.clientX,
        y: moveEvent.clientY,
        panX: this.panX,
        panY: this.panY,
        time: now,
      };
      this.updateViewBox();
    };
    const up = () => {
      this.panning = false;
      document.body.classList.remove("is-grabbing");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (moved && performance.now() - start.time < 450) this.startPanInertia();
      else {
        this.panVelocityX = 0;
        this.panVelocityY = 0;
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
  }

  private startPanInertia(): void {
    this.stopPanInertia();
    const tick = () => {
      this.panVelocityX *= 0.92;
      this.panVelocityY *= 0.92;
      if (Math.abs(this.panVelocityX) < 0.05 && Math.abs(this.panVelocityY) < 0.05) {
        this.panVelocityX = 0;
        this.panVelocityY = 0;
        this.panInertiaTimer = undefined;
        return;
      }
      this.panX += this.panVelocityX;
      this.panY += this.panVelocityY;
      this.updateViewBox();
      this.panInertiaTimer = window.requestAnimationFrame(tick);
    };
    tick();
  }

  private stopPanInertia(): void {
    if (this.panInertiaTimer !== undefined) {
      window.cancelAnimationFrame(this.panInertiaTimer);
      this.panInertiaTimer = undefined;
    }
  }

  private onTouchStart(event: TouchEvent): void {
    if (event.touches.length === 1) {
      event.preventDefault();
      this.stopPanInertia();
      const touch = event.touches[0];
      this.touchGesture = {
        mode: "pan",
        x: touch.clientX,
        y: touch.clientY,
        panX: this.panX,
        panY: this.panY,
      };
      return;
    }
    if (event.touches.length >= 2) {
      event.preventDefault();
      this.stopPanInertia();
      const first = event.touches[0];
      const second = event.touches[1];
      this.touchGesture = {
        mode: "pinch",
        distance: touchDistance(first, second),
        center: touchCenter(first, second, this.containerEl),
        scale: this.targetScale,
        panX: this.panX,
        panY: this.panY,
      };
    }
  }

  private onTouchMove(event: TouchEvent): void {
    if (!this.touchGesture) return;
    event.preventDefault();
    if (this.touchGesture.mode === "pan" && event.touches.length === 1) {
      const touch = event.touches[0];
      this.panX = this.touchGesture.panX + (touch.clientX - this.touchGesture.x) / this.scale;
      this.panY = this.touchGesture.panY + (touch.clientY - this.touchGesture.y) / this.scale;
      this.updateViewBox();
      return;
    }
    if (event.touches.length >= 2) {
      const first = event.touches[0];
      const second = event.touches[1];
      const distance = touchDistance(first, second);
      const center = touchCenter(first, second, this.containerEl);
      if (this.touchGesture.mode !== "pinch") {
        this.touchGesture = {
          mode: "pinch",
          distance,
          center,
          scale: this.targetScale,
          panX: this.panX,
          panY: this.panY,
        };
        return;
      }
      const ratio = distance / Math.max(1, this.touchGesture.distance);
      this.panX = this.touchGesture.panX + (center.x - this.touchGesture.center.x) / this.scale;
      this.panY = this.touchGesture.panY + (center.y - this.touchGesture.center.y) / this.scale;
      this.zoomTo(this.touchGesture.scale * ratio, center);
    }
  }

  private onTouchEnd(): void {
    this.touchGesture = null;
  }

  private screenToWorld(x: number, y: number): { x: number; y: number } {
    const viewWidth = this.width / this.scale;
    const viewHeight = this.height / this.scale;
    const viewX = (this.width - viewWidth) / 2 - this.panX;
    const viewY = (this.height - viewHeight) / 2 - this.panY;
    return { x: viewX + x / this.scale, y: viewY + y / this.scale };
  }

  private updateViewBox(): void {
    const view = this.getCurrentViewBox();
    this.viewBox = `${view.x} ${view.y} ${view.width} ${view.height}`;
    this.svg?.setAttribute("viewBox", this.viewBox);
  }

  private getCurrentViewBox(): { x: number; y: number; width: number; height: number } {
    const width = this.width / this.scale;
    const height = this.height / this.scale;
    return {
      x: (this.width - width) / 2 - this.panX,
      y: (this.height - height) / 2 - this.panY,
      width,
      height,
    };
  }

  private stopProgression(): void {
    if (this.progressionTimer !== undefined) {
      window.cancelAnimationFrame(this.progressionTimer);
      this.progressionTimer = undefined;
    }
    this.progression = 0;
  }

  private nodeRadius(node: GraphNode): number {
    const base = node.resolved ? 7 : 5;
    const linkWeight = Math.min(8, Math.sqrt(node.links) * 2);
    return Math.max(4, (base + linkWeight) * this.displayOptions.nodeSizeMultiplier);
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function touchDistance(first: Touch, second: Touch): number {
  return Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY);
}

function touchCenter(
  first: Touch,
  second: Touch,
  containerEl: HTMLElement,
): { x: number; y: number } {
  const rect = containerEl.getBoundingClientRect();
  return {
    x: (first.clientX + second.clientX) / 2 - rect.left,
    y: (first.clientY + second.clientY) / 2 - rect.top,
  };
}

function canvasNodeColor(node: GraphNode): string {
  if (node.focused) return "#2f8cff";
  if (node.type === "tag") return "#3ca370";
  if (node.type === "attachment") return "#d9822b";
  if (!node.resolved) return "#8a8a8a";
  return "#7f6df2";
}

function createGraphWorker(): GraphWorkerLike {
  if (typeof Worker !== "undefined") {
    try {
      return new Worker("/sim.js", { name: "Graph Worker" }) as unknown as GraphWorkerLike;
    } catch {
      return new InlineGraphSimulationWorker();
    }
  }
  return new InlineGraphSimulationWorker();
}

class InlineGraphSimulationWorker implements GraphWorkerLike {
  onmessage: ((event: { data: GraphWorkerResult }) => void) | null = null;
  private nodes: GraphWorkerNode[] = [];
  private links: Record<string, Record<string, boolean>> = {};

  postMessage(message: GraphWorkerRequest): void {
    if (message.nodes) this.nodes = message.nodes;
    if (message.links) this.links = message.links;
    const resultNodes: Record<string, { x: number; y: number }> = {};
    const count = Math.max(1, this.nodes.length);
    const radius = Math.max(120, Math.min(320, 48 + count * 10));
    this.nodes.forEach((node, index) => {
      const angle = count === 1 ? -Math.PI / 2 : (Math.PI * 2 * index) / count - Math.PI / 2;
      const weight = Object.keys(this.links[node.id] ?? {}).length + node.links;
      const weightedRadius = radius - Math.min(90, weight * 6);
      resultNodes[node.id] = {
        x: 480 + Math.cos(angle) * Math.max(80, weightedRadius),
        y: 320 + Math.sin(angle) * Math.max(80, weightedRadius),
      };
    });
    window.setTimeout(() => this.onmessage?.({ data: { nodes: resultNodes } }), 0);
  }

  terminate(): void {
    this.onmessage = null;
  }
}
