import { ViewerModel } from "./model.js";
import { builtinRenderers, type ArtistRenderer, type RenderContext } from "./renderers.js";
import { createScale, formatTick, type Scale } from "./scales.js";
import { resolveTheme } from "./theme.js";
import type { Artist, ArrayResolver, Axis, Figure, MPlotDocument, MPlotSelectionEventDetail, PointSelection, ResolvedData, Theme, ThemeName, Viewport } from "./types.js";
import { cssColor, pairs, SVG_NS, svg } from "./svg.js";

export interface ViewerOptions {
  theme?: ThemeName | Partial<Theme>;
  arrayResolver?: ArrayResolver;
  interactive?: boolean;
  toolbar?: boolean;
  liveUrl?: string;
}

export type ExportScope = "axis" | "figure" | "artifact";
interface Margins { left: number; right: number; top: number; bottom: number; }
interface AxisView { axis: Axis; figureId: string; host: HTMLElement; svg: SVGSVGElement; plot: SVGGElement; overlay: SVGGElement; readout: HTMLElement; width: number; height: number; margin: Margins; x: Scale; y: Scale; mounted: boolean; }
interface FigureView { figure: Figure; element: HTMLElement; canvas: HTMLElement; axisIds: string[]; plotAxisIds: string[]; }
type Mode = "pan" | "zoom" | "select";

export class MPlotViewer extends EventTarget {
  readonly element: HTMLElement;
  readonly model: ViewerModel;
  private options: ViewerOptions;
  private theme: Theme;
  private renderers = new Map<string, ArtistRenderer>();
  private views = new Map<string, AxisView>();
  private figures = new Map<string, FigureView>();
  private resolvedData = new Map<string, ResolvedData>();
  private mode: Mode = "pan";
  private exportScope: ExportScope | "figures" = "figure";
  private activeAxisId: string | undefined;
  private activeFigureIdValue: string | undefined;
  private source?: EventSource;
  private resize?: ResizeObserver;
  private intersection?: IntersectionObserver;
  private documentToken = 0;
  private axisTokens = new Map<string, number>();
  private axisRenders = new Map<string, Promise<void>>();
  private dirtyAxes = new Set<string>();

  constructor(target: HTMLElement, document: MPlotDocument, options: ViewerOptions = {}) {
    super();
    this.element = target;
    this.options = options;
    this.theme = resolveTheme(options.theme);
    this.model = new ViewerModel(document, options.arrayResolver);
    Object.entries(builtinRenderers).forEach(([type, renderer]) => this.renderers.set(type, renderer));
    this.element.classList.add("mplot-viewer");
    this.element.setAttribute("role", "region");
    this.element.setAttribute("aria-label", document.title ?? "Interactive scientific plot collection");
    this.applyTheme();
    this.model.addEventListener("viewport", (event) => {
      const detail = (event as CustomEvent<{ axisId: string; affected?: string[] }>).detail;
      for (const axisId of detail.affected ?? [detail.axisId]) void this.renderAxis(axisId);
    });
    this.model.addEventListener("selection", (event) => {
      const detail = (event as CustomEvent<{ points: PointSelection[] }>).detail;
      for (const axisId of new Set(detail.points.map((point) => this.model.document.artists.find((artist) => artist.id === point.artistId)?.axes_id).filter((id): id is string => Boolean(id)))) void this.renderAxis(axisId);
    });
    this.model.addEventListener("change", () => { void this.render(); });
    if (typeof ResizeObserver !== "undefined") {
      this.resize = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const axisId = (entry.target as HTMLElement).dataset.axesId;
          const view = axisId ? this.views.get(axisId) : undefined;
          const width = Math.max(180, entry.contentRect.width), height = Math.max(150, entry.contentRect.height);
          if (view?.mounted && view.figureId === this.activeFigureIdValue && entry.contentRect.width > 0 && entry.contentRect.height > 0 && (Math.abs(width - view.width) > 1 || Math.abs(height - view.height) > 1)) void this.renderAxis(axisId!);
        }
      });
    }
    if (typeof IntersectionObserver !== "undefined") {
      this.intersection = new IntersectionObserver((entries) => {
        for (const entry of entries) if (entry.isIntersecting) {
          const axisId = (entry.target as HTMLElement).dataset.axesId;
          if (axisId) void this.mountAxis(axisId);
        }
      }, { rootMargin: "600px 0px" });
    }
    if (options.liveUrl) this.connectLive(options.liveUrl);
    void this.render();
  }

  update(document: MPlotDocument): void { this.model.setDocument(document); }

  setTheme(theme: ThemeName | Partial<Theme>): void {
    this.options.theme = theme;
    this.theme = resolveTheme(theme);
    this.applyTheme();
    void this.renderMounted();
  }

  reset(axisId?: string): void {
    if (axisId) { void this.refitAxis(axisId); return; }
    for (const view of this.views.values()) if (view.mounted) void this.refitAxis(view.axis.id);
  }

  destroy(): void {
    this.source?.close();
    this.resize?.disconnect();
    this.intersection?.disconnect();
    this.element.replaceChildren();
    this.element.classList.remove("mplot-viewer");
  }

  async render(): Promise<void> {
    const token = ++this.documentToken;
    this.resize?.disconnect();
    this.intersection?.disconnect();
    this.views.clear();
    this.figures.clear();
    this.resolvedData.clear();
    this.axisTokens.clear();
    this.axisRenders.clear();
    this.dirtyAxes.clear();
    this.element.replaceChildren();

    const header = document.createElement("header");
    header.className = "mplot-header";
    const title = document.createElement("div");
    title.className = "mplot-title";
    title.textContent = this.model.document.title ?? "MPlot";
    header.append(title);
    if (this.options.toolbar !== false) header.append(this.createToolbar());
    this.element.append(header);

    const shell = document.createElement("div");
    shell.className = "mplot-shell";
    if (!this.model.document.figures.some((figure) => figure.id === this.activeFigureIdValue)) this.activeFigureIdValue = this.model.document.figures[0]?.id;
    if (this.model.document.figures.length > 1) shell.append(this.createNavigator());
    const figuresElement = document.createElement("main");
    figuresElement.className = "mplot-figures";
    shell.append(figuresElement);
    this.element.append(shell);

    const immediateMounts: Promise<void>[] = [];
    for (const [figureIndex, figure] of this.model.document.figures.entries()) {
      const figureView = this.createFigure(figure, figureIndex);
      this.figures.set(figure.id, figureView);
      figureView.element.hidden = figure.id !== this.activeFigureIdValue;
      figuresElement.append(figureView.element);
      for (const [axisIndex, axisId] of figureView.axisIds.entries()) {
        const axis = this.model.document.axes.find((item) => item.id === axisId);
        if (!axis) continue;
        if (axis.role === "colorbar") {
          const colorbar = this.createColorbar(axis);
          this.positionAxis(colorbar, axis, axisIndex, figureView.axisIds.length);
          figureView.canvas.append(colorbar);
          continue;
        }
        const view = this.createAxis(axis, figure.id);
        this.positionAxis(view.host, axis, figureView.plotAxisIds.indexOf(axisId), figureView.plotAxisIds.length);
        figureView.canvas.append(view.host);
        this.views.set(axis.id, view);
        this.resize?.observe(view.host);
        if (this.intersection) this.intersection.observe(view.host);
        else immediateMounts.push(this.mountAxis(axis.id));
      }
    }
    if (token !== this.documentToken) return;
    await Promise.all(immediateMounts);
    if (this.activeFigureIdValue) await this.mountFigure(this.activeFigureIdValue);
  }

  private createFigure(figure: Figure, index: number): FigureView {
    const element = document.createElement("section");
    element.className = "mplot-figure";
    element.id = `mplot-figure-${safeId(figure.id)}`;
    element.dataset.figureId = figure.id;
    const heading = document.createElement("header");
    heading.className = "mplot-figure-header";
    const title = document.createElement("h2");
    title.className = "mplot-figure-title";
    title.textContent = figure.title ?? `Figure ${index + 1}`;
    const axisIds = this.figureAxisIds(figure);
    const plotAxisIds = axisIds.filter((axisId) => this.model.document.axes.find((axis) => axis.id === axisId)?.role !== "colorbar");
    const count = document.createElement("span");
    count.className = "mplot-figure-count";
    count.textContent = `${plotAxisIds.length} ${plotAxisIds.length === 1 ? "plot" : "plots"}`;
    heading.append(title, count);
    const canvas = document.createElement("div");
    canvas.className = "mplot-figure-canvas";
    const [width, height] = figure.size ?? [640, 480];
    canvas.style.setProperty("--mplot-figure-ratio", String(width / Math.max(1, height)));
    element.append(heading, canvas);
    return { figure, element, canvas, axisIds, plotAxisIds };
  }

  private createColorbar(axis: Axis): HTMLElement {
    const colorbar = document.createElement("aside");
    colorbar.className = `mplot-colorbar mplot-colorbar--${axis.colorbar?.orientation ?? "vertical"}`;
    colorbar.dataset.axesId = axis.id;
    colorbar.setAttribute("aria-label", axis.colorbar?.label ? `Colorbar: ${axis.colorbar.label}` : "Colorbar");
    const gradient = document.createElement("div");
    gradient.className = "mplot-colorbar-gradient";
    const colors = (axis.colorbar?.colors ?? []).map((color) => Array.isArray(color) && color.length >= 3 ? `rgba(${Math.round(Number(color[0]) * 255)}, ${Math.round(Number(color[1]) * 255)}, ${Math.round(Number(color[2]) * 255)}, ${color[3] === undefined ? 1 : Number(color[3])})` : cssColor(color, "")).filter(Boolean);
    gradient.style.background = `linear-gradient(${axis.colorbar?.orientation === "horizontal" ? "to right" : "to top"}, ${colors.length > 1 ? colors.join(", ") : "#440154, #21918c, #fde725"})`;
    const ticks = document.createElement("div");
    ticks.className = "mplot-colorbar-ticks";
    const values = axis.colorbar?.ticks ?? [], labels = axis.colorbar?.ticklabels ?? [];
    const [lower, upper] = axis.colorbar?.limits ?? [values[0] ?? 0, values.at(-1) ?? 1];
    values.forEach((value, index) => {
      const tick = document.createElement("span");
      tick.className = "mplot-colorbar-tick";
      const fraction = (value - lower) / (upper - lower || 1);
      tick.style.setProperty("--mplot-colorbar-position", `${Math.max(0, Math.min(1, fraction)) * 100}%`);
      tick.textContent = labels[index] ?? formatTick(value, "linear");
      ticks.append(tick);
    });
    colorbar.append(gradient, ticks);
    if (axis.colorbar?.label) {
      const label = document.createElement("div");
      label.className = "mplot-colorbar-label";
      label.textContent = axis.colorbar.label;
      colorbar.append(label);
    }
    return colorbar;
  }

  private createAxis(axis: Axis, figureId: string): AxisView {
    const host = document.createElement("article");
    host.className = "mplot-axis mplot-axis--pending";
    host.dataset.axesId = axis.id;
    host.setAttribute("aria-label", axis.title ?? `Plot ${axis.id}`);
    host.onclick = () => { this.activeAxisId = axis.id; this.markActiveAxis(); };
    const placeholder = document.createElement("div");
    placeholder.className = "mplot-axis-placeholder";
    placeholder.textContent = axis.title ?? "Plot";
    host.append(placeholder);
    const chart = svg("svg", { role: "img", viewBox: "0 0 640 360", "aria-label": axis.title ?? "Scientific plot" });
    const plot = svg("g"), overlay = svg("g");
    chart.append(plot, overlay);
    const readout = document.createElement("output");
    readout.className = "mplot-coordinates";
    readout.setAttribute("aria-live", "polite");
    readout.textContent = "x — · y —";
    const viewport = this.model.viewports.get(axis.id) ?? { x: [0, 1] as [number, number], y: [0, 1] as [number, number] };
    return { axis, figureId, host, svg: chart, plot, overlay, readout, width: 640, height: 360, margin: { left: 64, right: 18, top: 28, bottom: 58 }, x: createScale(axis.xscale, viewport.x, [64, 622]), y: createScale(axis.yscale, viewport.y, [302, 28]), mounted: false };
  }

  private positionAxis(host: HTMLElement, axis: Axis, index: number, count: number): void {
    const position = axis.position ?? inferredPosition(index, count);
    host.style.left = `${position[0] * 100}%`;
    host.style.top = `${(1 - position[1] - position[3]) * 100}%`;
    host.style.width = `${position[2] * 100}%`;
    host.style.height = `${position[3] * 100}%`;
  }

  private async mountAxis(axisId: string, force = false): Promise<void> {
    const view = this.views.get(axisId);
    if (!view || view.mounted || (!force && view.figureId !== this.activeFigureIdValue)) return;
    view.mounted = true;
    view.host.classList.remove("mplot-axis--pending");
    view.host.replaceChildren(view.svg, view.readout);
    if (this.options.interactive !== false) this.bindInteractions(view);
    if (!view.axis.xlim || !view.axis.ylim) await this.model.fitViewport(axisId);
    if (!this.activeAxisId) { this.activeAxisId = axisId; this.markActiveAxis(); }
    await this.renderAxis(axisId);
  }

  private async refitAxis(axisId: string): Promise<void> {
    await this.model.fitViewport(axisId);
    await this.renderAxis(axisId);
  }

  private createNavigator(): HTMLElement {
    const navigation = document.createElement("nav");
    navigation.className = "mplot-navigator";
    navigation.setAttribute("aria-label", "Figures");
    const previous = document.createElement("button");
    previous.type = "button"; previous.className = "mplot-page-button"; previous.textContent = "Previous"; previous.setAttribute("aria-label", "Previous figure");
    const pages = document.createElement("div");
    pages.className = "mplot-page-list";
    this.model.document.figures.forEach((figure, index) => {
      const button = document.createElement("button");
      button.type = "button"; button.className = "mplot-page-button"; button.dataset.figureId = figure.id; button.textContent = String(index + 1);
      button.title = figure.title ?? `Figure ${index + 1}`; button.setAttribute("aria-label", `Show ${button.title}`);
      button.onclick = () => void this.showFigure(figure.id);
      pages.append(button);
    });
    const next = document.createElement("button");
    next.type = "button"; next.className = "mplot-page-button"; next.textContent = "Next"; next.setAttribute("aria-label", "Next figure");
    previous.onclick = () => void this.stepFigure(-1); next.onclick = () => void this.stepFigure(1);
    navigation.append(previous, pages, next);
    queueMicrotask(() => this.updateNavigator());
    return navigation;
  }

  private async showFigure(figureId: string): Promise<void> {
    if (!this.figures.has(figureId)) return;
    this.activeFigureIdValue = figureId;
    for (const [id, figure] of this.figures) figure.element.hidden = id !== figureId;
    const firstAxis = this.figures.get(figureId)?.axisIds[0];
    if (firstAxis) { this.activeAxisId = firstAxis; this.markActiveAxis(); }
    this.updateNavigator();
    await this.mountFigure(figureId);
  }

  private stepFigure(offset: number): void {
    const figures = this.model.document.figures, current = Math.max(0, figures.findIndex((figure) => figure.id === this.activeFigureIdValue));
    const next = figures[current + offset]; if (next) void this.showFigure(next.id);
  }

  private updateNavigator(): void {
    const figures = this.model.document.figures, index = figures.findIndex((figure) => figure.id === this.activeFigureIdValue);
    this.element.querySelectorAll<HTMLButtonElement>(".mplot-page-list [data-figure-id]").forEach((button) => button.setAttribute("aria-current", button.dataset.figureId === this.activeFigureIdValue ? "page" : "false"));
    const previous = this.element.querySelector<HTMLButtonElement>('[aria-label="Previous figure"]'), next = this.element.querySelector<HTMLButtonElement>('[aria-label="Next figure"]');
    if (previous) previous.disabled = index <= 0;
    if (next) next.disabled = index < 0 || index >= figures.length - 1;
  }

  private createToolbar(): HTMLElement {
    const toolbar = document.createElement("nav");
    toolbar.className = "mplot-toolbar";
    toolbar.setAttribute("aria-label", "Plot tools");
    const actions: Array<[string, string, () => void]> = [["Pan", "pan", () => this.setMode("pan")], ["Zoom", "zoom", () => this.setMode("zoom")], ["Select", "select", () => this.setMode("select")], ["Reset", "reset", () => this.reset()]];
    for (const [label, name, action] of actions) {
      const button = document.createElement("button"); button.type = "button"; button.className = "mplot-button"; button.textContent = label; button.dataset.action = name; button.title = label; button.onclick = action;
      if (["pan", "zoom", "select"].includes(name)) button.setAttribute("aria-pressed", String(this.mode === name));
      toolbar.append(button);
    }
    const select = document.createElement("select");
    select.className = "mplot-export-scope";
    select.setAttribute("aria-label", "Export scope");
    for (const [value, label] of [["axis", "Current plot"], ["figure", "Current figure"], ["artifact", "Entire artifact"], ["figures", "Each figure"]] as const) {
      const option = document.createElement("option"); option.value = value; option.textContent = label; option.selected = value === this.exportScope; select.append(option);
    }
    select.onchange = () => { this.exportScope = select.value as ExportScope | "figures"; };
    toolbar.append(select);
    for (const format of ["SVG", "PNG"] as const) {
      const button = document.createElement("button"); button.type = "button"; button.className = "mplot-button"; button.textContent = format;
      button.onclick = () => void this.downloadExport(format.toLowerCase() as "svg" | "png"); toolbar.append(button);
    }
    return toolbar;
  }

  private setMode(mode: Mode): void {
    this.mode = mode;
    this.element.querySelectorAll<HTMLElement>("[data-action]").forEach((button) => {
      if (["pan", "zoom", "select"].includes(button.dataset.action ?? "")) button.setAttribute("aria-pressed", String(button.dataset.action === mode));
    });
  }

  private async renderMounted(): Promise<void> { await Promise.all(Array.from(this.views.values()).filter((view) => view.mounted).map((view) => this.renderAxis(view.axis.id))); }

  private async renderAxis(axisId: string): Promise<void> {
    const pending = this.axisRenders.get(axisId);
    if (pending) { this.dirtyAxes.add(axisId); return pending; }
    const operation = (async () => {
      try {
        this.dirtyAxes.delete(axisId);
        await this.renderAxisNow(axisId);
        this.dirtyAxes.delete(axisId);
      } finally { this.axisRenders.delete(axisId); }
    })();
    this.axisRenders.set(axisId, operation);
    return operation;
  }

  private async renderAxisNow(axisId: string): Promise<void> {
    const view = this.views.get(axisId);
    if (!view?.mounted || view.figureId !== this.activeFigureIdValue) return;
    const token = (this.axisTokens.get(axisId) ?? 0) + 1, documentToken = this.documentToken;
    this.axisTokens.set(axisId, token);
    view.width = Math.max(180, view.host.clientWidth || 640);
    view.height = Math.max(150, view.host.clientHeight || 360);
    view.margin = compactMargins(view.width, view.height);
    const viewport = this.model.viewports.get(axisId) ?? this.model.defaultViewport(view.axis);
    const right = view.width - view.margin.right, bottom = view.height - view.margin.bottom;
    view.x = createScale(view.axis.xscale, viewport.x, [view.margin.left, right]);
    view.y = createScale(view.axis.yscale, viewport.y, [bottom, view.margin.top]);
    const plot = svg("g"), overlay = svg("g"), working = { ...view, plot, overlay };
    this.drawAxes(working);
    const clipId = `mplot-clip-${safeId(view.axis.id)}`, defs = svg("defs"), clip = svg("clipPath", { id: clipId });
    clip.append(svg("rect", { x: view.margin.left, y: view.margin.top, width: right - view.margin.left, height: bottom - view.margin.top })); defs.append(clip); plot.prepend(defs);
    const artists = this.model.document.artists.filter((artist) => artist.axes_id === axisId && artist.props.visible !== false);
    for (const artist of artists) {
      const group = svg("g", { "data-artist-id": artist.id, "clip-path": `url(#${clipId})` }); plot.append(group);
      const renderer = this.renderers.get(artist.type);
      if (!renderer) { this.drawUnknown(group, artist, working); continue; }
      try {
        const data = this.resolvedData.get(artist.id) ?? await this.model.resolveData(artist.data, artist);
        if (documentToken !== this.documentToken || this.views.get(axisId) !== view || view.figureId !== this.activeFigureIdValue) return;
        this.resolvedData.set(artist.id, data);
        const selected = this.selectedIndices(artist.id);
        await renderer({ ...working, group, artist, data, theme: this.theme, selected, pointBudget: Math.max(500, Math.round(view.width * 4)), project3d: (x, y, z) => this.project3d(view, x, y, z) } as RenderContext);
      } catch (error) { this.drawUnknown(group, artist, working, error instanceof Error ? error.message : "render failed"); }
    }
    if (documentToken !== this.documentToken || this.views.get(axisId) !== view || view.figureId !== this.activeFigureIdValue || this.axisTokens.get(axisId) !== token) return;
    this.drawHitArea(working);
    view.svg.setAttribute("viewBox", `0 0 ${view.width} ${view.height}`);
    view.plot.replaceChildren(...plot.childNodes);
    view.overlay.replaceChildren(...overlay.childNodes);
  }

  private drawAxes(view: AxisView): void {
    const { left, top, bottom, right } = view.margin, b = view.height - bottom, r = view.width - right;
    const tickCount = Math.max(3, Math.floor((r - left) / 90));
    for (const tick of view.x.ticks(tickCount)) { const px = view.x(tick); view.plot.append(svg("line", { x1: px, x2: px, y1: top, y2: b, class: "mplot-grid-line" })); const text = svg("text", { x: px, y: b + 15, "text-anchor": "middle", class: "mplot-tick" }); text.textContent = formatTick(tick, view.axis.xscale); view.plot.append(text); }
    for (const tick of view.y.ticks(Math.max(3, Math.floor((b - top) / 65)))) { const py = view.y(tick); view.plot.append(svg("line", { x1: left, x2: r, y1: py, y2: py, class: "mplot-grid-line" })); const text = svg("text", { x: left - 7, y: py + 4, "text-anchor": "end", class: "mplot-tick" }); text.textContent = formatTick(tick, view.axis.yscale); view.plot.append(text); }
    view.plot.append(svg("path", { d: `M${left},${top}H${r}V${b}H${left}Z`, fill: "none", class: "mplot-axis-frame" }));
    if (view.axis.title) { const text = svg("text", { x: (left + r) / 2, y: Math.max(14, top - 9), "text-anchor": "middle", class: "mplot-axis-title" }); text.textContent = view.axis.title; view.plot.append(text); }
    if (view.axis.xlabel && view.height > 180) { const text = svg("text", { x: (left + r) / 2, y: b + 38, "text-anchor": "middle", class: "mplot-label" }); text.textContent = view.axis.xlabel; view.plot.append(text); }
    if (view.axis.ylabel && view.width > 230) { const text = svg("text", { x: 14, y: (top + b) / 2, "text-anchor": "middle", class: "mplot-label", transform: `rotate(-90 14 ${(top + b) / 2})` }); text.textContent = view.axis.ylabel; view.plot.append(text); }
  }

  private drawUnknown(group: SVGGElement, artist: Artist, view: AxisView, reason = "Renderer not installed"): void { const box = svg("g", { class: "mplot-unknown" }); box.append(svg("rect", { x: view.margin.left + 8, y: view.margin.top + 8, width: Math.min(220, view.width - view.margin.left - 20), height: 40, rx: 2 })); const text = svg("text", { x: view.margin.left + 16, y: view.margin.top + 25 }); text.textContent = `Unknown: ${artist.type}`; const detail = svg("text", { x: view.margin.left + 16, y: view.margin.top + 40 }); detail.textContent = reason; box.append(text, detail); group.append(box); }
  private drawHitArea(view: AxisView): void { const { left, top, bottom, right } = view.margin; view.overlay.append(svg("rect", { x: left, y: top, width: view.width - right - left, height: view.height - bottom - top, class: "mplot-hit" })); }

  private bindInteractions(view: AxisView): void {
    let start: { x: number; y: number; viewport: Viewport } | undefined; let brush: SVGRectElement | undefined;
    const finish = (event: PointerEvent, cancel = false) => { if (!start) return; const pointer = this.pointer(view, event), p = this.boundToPlot(view, pointer.x, pointer.y); if (!cancel && this.mode === "zoom" && Math.hypot(p.x - start.x, p.y - start.y) > 4) this.model.setViewport(view.axis.id, { ...start.viewport, x: [view.x.invert(Math.min(start.x, p.x)), view.x.invert(Math.max(start.x, p.x))], y: [view.y.invert(Math.max(start.y, p.y)), view.y.invert(Math.min(start.y, p.y))] }); else if (!cancel && this.mode === "select") this.selectRect(view, start.x, start.y, p.x, p.y); start = undefined; brush?.remove(); brush = undefined; };
    view.svg.addEventListener("pointerdown", (event) => { this.activeAxisId = view.axis.id; this.markActiveAxis(); const p = this.pointer(view, event); if (!this.inPlot(view, p.x, p.y)) return; start = { ...p, viewport: structuredClone(this.model.viewports.get(view.axis.id)!) }; view.svg.setPointerCapture(event.pointerId); if (this.mode === "select" || this.mode === "zoom") { brush = svg("rect", { x: p.x, y: p.y, width: 0, height: 0, class: `mplot-brush mplot-brush--${this.mode}` }); view.overlay.append(brush); } });
    view.svg.addEventListener("pointermove", (event) => { const p = this.pointer(view, event); this.updateCoordinates(view, p.x, p.y); if (!start) { this.showTooltip(view, p.x, p.y); return; } if (this.mode === "pan") { const next = structuredClone(start.viewport), dx = view.x.invert(start.x) - view.x.invert(p.x), dy = view.y.invert(start.y) - view.y.invert(p.y); next.x = [start.viewport.x[0] + dx, start.viewport.x[1] + dx]; next.y = [start.viewport.y[0] + dy, start.viewport.y[1] + dy]; this.model.setViewport(view.axis.id, next); } else if (brush) { const bounded = this.boundToPlot(view, p.x, p.y); brush.setAttribute("x", String(Math.min(start.x, bounded.x))); brush.setAttribute("y", String(Math.min(start.y, bounded.y))); brush.setAttribute("width", String(Math.abs(bounded.x - start.x))); brush.setAttribute("height", String(Math.abs(bounded.y - start.y))); } });
    view.svg.addEventListener("pointerup", (event) => finish(event));
    view.svg.addEventListener("pointercancel", (event) => finish(event, true));
    view.svg.addEventListener("pointerleave", () => { if (!start) this.clearHover(view); });
    view.svg.addEventListener("wheel", (event) => { event.preventDefault(); const p = this.pointer(view, event); if (!this.inPlot(view, p.x, p.y)) return; const factor = Math.exp(event.deltaY * .001), current = this.model.viewports.get(view.axis.id)!, cx = view.x.invert(p.x), cy = view.y.invert(p.y); this.model.setViewport(view.axis.id, { ...current, x: [cx + (current.x[0] - cx) * factor, cx + (current.x[1] - cx) * factor], y: [cy + (current.y[0] - cy) * factor, cy + (current.y[1] - cy) * factor] }); }, { passive: false });
    view.svg.addEventListener("dblclick", () => this.reset(view.axis.id));
  }

  private pointer(view: AxisView, event: PointerEvent | WheelEvent): { x: number; y: number } { const rect = view.svg.getBoundingClientRect(); return { x: (event.clientX - rect.left) * view.width / (rect.width || view.width), y: (event.clientY - rect.top) * view.height / (rect.height || view.height) }; }
  private plotBounds(view: AxisView): { left: number; right: number; top: number; bottom: number } { return { left: view.margin.left, right: view.width - view.margin.right, top: view.margin.top, bottom: view.height - view.margin.bottom }; }
  private inPlot(view: AxisView, x: number, y: number): boolean { const bounds = this.plotBounds(view); return x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom; }
  private boundToPlot(view: AxisView, x: number, y: number): { x: number; y: number } { const bounds = this.plotBounds(view); return { x: Math.max(bounds.left, Math.min(bounds.right, x)), y: Math.max(bounds.top, Math.min(bounds.bottom, y)) }; }
  private updateCoordinates(view: AxisView, px: number, py: number): void { view.readout.textContent = this.inPlot(view, px, py) ? `x ${formatTick(view.x.invert(px), view.axis.xscale)} · y ${formatTick(view.y.invert(py), view.axis.yscale)}` : "x — · y —"; }
  private clearHover(view: AxisView): void { view.host.querySelector<HTMLElement>(".mplot-tooltip")?.remove(); view.readout.textContent = "x — · y —"; }

  private selectRect(view: AxisView, x0: number, y0: number, x1: number, y1: number): void { const left = Math.min(x0, x1), right = Math.max(x0, x1), top = Math.min(y0, y1), bottom = Math.max(y0, y1), points: PointSelection[] = []; for (const artist of this.model.document.artists.filter((item) => item.axes_id === view.axis.id)) { const data = this.resolvedData.get(artist.id) ?? artist.data; const selected = pairs(data.x, data.y).filter(([x, y]) => { const px = view.x(x), py = view.y(y); return px >= left && px <= right && py >= top && py <= bottom; }).map(([, , index]) => index); if (selected.length) points.push({ artistId: artist.id, indices: selected }); } const id = this.model.document.selections?.[0]?.id ?? "selection"; this.model.setSelection(id, points); const detail: MPlotSelectionEventDetail = { selectionId: id, axesId: view.axis.id, points }, event = new CustomEvent<MPlotSelectionEventDetail>("mplot:selection", { detail }); this.element.dispatchEvent(event); this.dispatchEvent(event); }
  private selectedIndices(artistId: string): Set<number> { const values = new Set<number>(); for (const selection of this.model.selections.values()) for (const point of selection) if (point.artistId === artistId) point.indices.forEach((index) => values.add(index)); return values; }

  private showTooltip(view: AxisView, px: number, py: number): void { let best: { artist: Artist; index: number; x: number; y: number; distance: number } | undefined; for (const artist of this.model.document.artists.filter((item) => item.axes_id === view.axis.id)) { const data = this.resolvedData.get(artist.id) ?? artist.data, values = pairs(data.x, data.y), stride = Math.max(1, Math.floor(values.length / 5000)); for (let offset = 0; offset < values.length; offset += stride) { const [x, y, index] = values[offset]!, distance = Math.hypot(view.x(x) - px, view.y(y) - py); if (distance < 18 && (!best || distance < best.distance)) best = { artist, index, x, y, distance }; } } let tooltip = view.host.querySelector<HTMLElement>(".mplot-tooltip"); if (!best) { tooltip?.remove(); return; } if (!tooltip) { tooltip = document.createElement("div"); tooltip.className = "mplot-tooltip"; view.host.append(tooltip); } tooltip.style.left = `${px / view.width * 100}%`; tooltip.style.top = `${py / view.height * 100}%`; tooltip.textContent = `${best.artist.props.label ?? best.artist.id} [${best.index}]  x ${formatTick(best.x, view.axis.xscale)} · y ${formatTick(best.y, view.axis.yscale)}`; }
  private project3d(view: AxisView, x: number, y: number, z: number): [number, number] {
    const viewport = this.model.viewports.get(view.axis.id)!, zlim = viewport.z ?? [0, 1];
    const normalize = (value: number, limits: [number, number]) => (value - limits[0]) / (limits[1] - limits[0] || 1) - 0.5;
    const xn = normalize(x, viewport.x), yn = normalize(y, viewport.y), zn = normalize(z, zlim);
    const settings = view.axis.props?.view as { elev?: number; azim?: number; roll?: number } | undefined;
    const azimuth = (settings?.azim ?? -60) * Math.PI / 180, elevation = (settings?.elev ?? 30) * Math.PI / 180, roll = (settings?.roll ?? 0) * Math.PI / 180;
    const horizontal = -Math.sin(azimuth) * xn + Math.cos(azimuth) * yn;
    const depth = Math.cos(azimuth) * xn + Math.sin(azimuth) * yn;
    const vertical = Math.cos(elevation) * zn - Math.sin(elevation) * depth;
    const rolledX = Math.cos(roll) * horizontal - Math.sin(roll) * vertical;
    const rolledY = Math.sin(roll) * horizontal + Math.cos(roll) * vertical;
    const left = view.margin.left, right = view.width - view.margin.right, top = view.margin.top, bottom = view.height - view.margin.bottom;
    const scale = Math.min(right - left, bottom - top) * 0.82;
    return [(left + right) / 2 + rolledX * scale, (top + bottom) / 2 - rolledY * scale];
  }
  private markActiveAxis(): void { for (const view of this.views.values()) view.host.classList.toggle("mplot-axis--active", view.axis.id === this.activeAxisId); }

  exportSVG(scope: ExportScope = "artifact", id?: string): string {
    if (scope === "axis") { const view = this.views.get(id ?? this.activeAxisId ?? ""); return view?.mounted ? serializeSvg(view.svg) : emptySvg(); }
    if (scope === "figure") { const figureId = id ?? this.activeFigureId(); return figureId ? this.composeFigureSVG(figureId) : emptySvg(); }
    const figureIds = this.model.document.figures.map((figure) => figure.id), documents = figureIds.map((figureId) => this.composeFigureSVGElement(figureId));
    const width = Math.max(1, ...documents.map((item) => item.width)), height = documents.reduce((sum, item) => sum + item.height, 0), root = svg("svg", { xmlns: SVG_NS, width, height, viewBox: `0 0 ${width} ${height}` });
    let y = 0; for (const document of documents) { const group = svg("g", { transform: `translate(0 ${y})` }); group.append(...Array.from(document.svg.childNodes).map((node) => node.cloneNode(true))); root.append(group); y += document.height; }
    return serializeSvg(root);
  }

  private composeFigureSVG(figureId: string): string { return serializeSvg(this.composeFigureSVGElement(figureId).svg); }
  private composeFigureSVGElement(figureId: string): { svg: SVGSVGElement; width: number; height: number } {
    const figure = this.figures.get(figureId), width = figure?.canvas.clientWidth || 960;
    const [sourceWidth, sourceHeight] = figure?.figure.size ?? [640, 480], height = Math.round(width * sourceHeight / Math.max(1, sourceWidth));
    const root = svg("svg", { xmlns: SVG_NS, width, height, viewBox: `0 0 ${width} ${height}` });
    for (const axisId of figure?.axisIds ?? []) { const view = this.views.get(axisId); if (!view?.mounted) continue; const position = view.axis.position ?? inferredPosition((figure?.axisIds.indexOf(axisId) ?? 0), figure?.axisIds.length ?? 1), group = svg("g", { transform: `translate(${position[0] * width} ${(1 - position[1] - position[3]) * height}) scale(${position[2] * width / view.width} ${position[3] * height / view.height})` }); group.append(...Array.from(view.svg.childNodes).map((node) => node.cloneNode(true))); root.append(group); }
    return { svg: root, width, height };
  }

  async exportPNG(scale = 2, scope: ExportScope = "artifact", id?: string): Promise<Blob> { const content = this.exportSVG(scope, id), blob = new Blob([content], { type: "image/svg+xml" }), url = URL.createObjectURL(blob); try { const image = new Image(); await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error("Unable to rasterize SVG")); image.src = url; }); const canvas = document.createElement("canvas"); canvas.width = image.width * scale; canvas.height = image.height * scale; const context = canvas.getContext("2d"); if (!context) throw new Error("Canvas unavailable"); context.scale(scale, scale); context.drawImage(image, 0, 0); return await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("PNG encoding failed")), "image/png")); } finally { URL.revokeObjectURL(url); } }

  private async downloadExport(format: "svg" | "png"): Promise<void> {
    const scope = this.exportScope;
    if (scope === "figures") { for (const [index, figure] of this.model.document.figures.entries()) { await this.mountFigure(figure.id, true); const filename = `mplot-figure-${index + 1}.${format}`; this.download(format === "svg" ? new Blob([this.exportSVG("figure", figure.id)], { type: "image/svg+xml;charset=utf-8" }) : await this.exportPNG(2, "figure", figure.id), filename); } return; }
    if (scope === "figure") { const figureId = this.activeFigureId(); if (figureId) await this.mountFigure(figureId); }
    else if (scope === "artifact") for (const figure of this.model.document.figures) await this.mountFigure(figure.id, true);
    else if (this.activeAxisId) await this.mountAxis(this.activeAxisId);
    const filename = `mplot-${scope}.${format}`;
    this.download(format === "svg" ? new Blob([this.exportSVG(scope)], { type: "image/svg+xml;charset=utf-8" }) : await this.exportPNG(2, scope), filename);
  }

  private async mountFigure(figureId: string, force = false): Promise<void> { await Promise.all((this.figures.get(figureId)?.axisIds ?? []).map((axisId) => this.mountAxis(axisId, force))); }
  private activeFigureId(): string | undefined { return this.activeFigureIdValue ?? (this.activeAxisId ? this.views.get(this.activeAxisId)?.figureId : this.model.document.figures[0]?.id); }
  private download(blob: Blob, filename: string): void { const link = document.createElement("a"), url = URL.createObjectURL(blob); link.href = url; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 0); }

  connectLive(url: string): void { this.source?.close(); if (typeof EventSource === "undefined") return; this.source = new EventSource(url); const update = (event: MessageEvent) => { try { const payload = JSON.parse(String(event.data)) as MPlotDocument | { document: MPlotDocument }; this.update("document" in payload ? payload.document : payload); } catch (error) { this.dispatchEvent(new CustomEvent("mplot:error", { detail: error })); } }; this.source.addEventListener("document", update as EventListener); this.source.onmessage = update; this.source.onerror = () => this.dispatchEvent(new Event("mplot:disconnect")); }
  private figureAxisIds(figure: Figure): string[] { return (figure.axes ?? this.model.document.axes.filter((axis) => !axis.figure_id || axis.figure_id === figure.id)).map((axis) => typeof axis === "string" ? axis : axis.id); }
  private applyTheme(): void { const values: Record<string, string> = { "--mplot-bg": this.theme.background, "--mplot-panel": this.theme.panel, "--mplot-fg": this.theme.foreground, "--mplot-muted": this.theme.muted, "--mplot-grid": this.theme.grid, "--mplot-accent": this.theme.accent, "--mplot-selection": this.theme.selection, "font-family": this.theme.fontFamily }; for (const [key, value] of Object.entries(values)) this.element.style.setProperty(key, value); }
}

const safeId = (value: string): string => value.replace(/[^a-zA-Z0-9_-]/g, "-");
const serializeSvg = (element: SVGSVGElement): string => new XMLSerializer().serializeToString(element);
const emptySvg = (): string => `<svg xmlns="${SVG_NS}"/>`;
function inferredPosition(index: number, count: number): [number, number, number, number] { const columns = Math.ceil(Math.sqrt(count)), rows = Math.ceil(count / columns), gap = .04, width = (1 - gap * (columns + 1)) / columns, height = (1 - gap * (rows + 1)) / rows, column = index % columns, row = Math.floor(index / columns); return [gap + column * (width + gap), gap + (rows - row - 1) * (height + gap), width, height]; }
function compactMargins(width: number, height: number): Margins { const compact = width < 300 || height < 210; return compact ? { left: 48, right: 12, top: 25, bottom: 42 } : { left: 64, right: 18, top: 30, bottom: 62 }; }
