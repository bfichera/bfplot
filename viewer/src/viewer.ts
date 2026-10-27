import { fitLineViewport, LineComparison } from "./comparison.js";
import { hasMath, plotText } from "./math.js";
import { ViewerModel } from "./model.js";
import { builtinRenderers, PLOT_TEXT_SIZE, type ArtistRenderer, type RenderContext } from "./renderers.js";
import { createScale, formatTick, type Scale } from "./scales.js";
import { resolveTheme } from "./theme.js";
import { TimelinePlayer } from "./timeline.js";
import type { Artist, ArrayResolver, Axis, Figure, MPlotDocument, ResolvedData, Theme, ThemeName, Viewport } from "./types.js";
import { cssColor, pairs, SVG_NS, svg } from "./svg.js";

export interface ViewerOptions {
  theme?: ThemeName | Partial<Theme>;
  arrayResolver?: ArrayResolver;
  interactive?: boolean;
  toolbar?: boolean;
}

export type ExportScope = "axis" | "figure" | "artifact";
interface Margins { left: number; right: number; top: number; bottom: number; }
interface AxisView { axis: Axis; figureId: string; host: HTMLElement; svg: SVGSVGElement; plot: SVGGElement; overlay: SVGGElement; readout: HTMLElement; width: number; height: number; margin: Margins; x: Scale; y: Scale; mounted: boolean; }
interface FigureView { figure: Figure; element: HTMLElement; canvas: HTMLElement; axisIds: string[]; plotAxisIds: string[]; }
type Mode = "pan" | "zoom";

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
  private resize?: ResizeObserver;
  private intersection?: IntersectionObserver;
  private documentToken = 0;
  private axisTokens = new Map<string, number>();
  private axisRenders = new Map<string, Promise<void>>();
  private dirtyAxes = new Set<string>();
  private cameras = new Map<string, { elev: number; azim: number; roll: number; zoom: number }>();
  private contrastLimits = new Map<string, [number, number]>();
  private readonly metadataPageId = "__metadata__";
  private readonly comparisonPageId = "__comparison__";
  private readonly comparisonAxisId = "__comparison-axis__";
  private readonly comparison = new LineComparison();
  private compareMode = false;
  private comparisonElement: HTMLElement | undefined;
  private readonly timeline: TimelinePlayer;

  constructor(target: HTMLElement, document: MPlotDocument, options: ViewerOptions = {}) {
    super();
    this.element = target;
    this.options = options;
    this.theme = resolveTheme(options.theme);
    this.model = new ViewerModel(document, options.arrayResolver);
    this.timeline = new TimelinePlayer(document, (nextDocument) => this.renderTimelineDocument(nextDocument));
    Object.entries(builtinRenderers).forEach(([type, renderer]) => this.renderers.set(type, renderer));
    this.element.classList.add("mplot-viewer");
    this.element.setAttribute("role", "region");
    this.element.setAttribute("aria-label", document.title ?? "Interactive scientific plot collection");
    this.applyTheme();
    this.model.addEventListener("viewport", (event) => {
      void this.renderAxis((event as CustomEvent<{ axisId: string }>).detail.axisId);
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
    void this.render();
  }

  update(document: MPlotDocument): void {
    this.comparison.clear();
    this.compareMode = false;
    this.activeFigureIdValue = undefined;
    this.timeline.setDocument(document);
    this.model.setDocument(document);
  }

  setTheme(theme: ThemeName | Partial<Theme>): void {
    this.options.theme = theme;
    this.theme = resolveTheme(theme);
    this.applyTheme();
    void this.renderMounted();
  }

  reset(axisId?: string): void {
    const resetView = (view: AxisView) => {
      if (view.axis.id === this.comparisonAxisId) { void this.renderComparison(); return; }
      for (const artist of this.model.document.artists.filter((candidate) => candidate.axes_id === view.axis.id)) this.contrastLimits.delete(artist.id);
      if (view.axis.projection === "3d") { this.cameras.delete(view.axis.id); void this.renderAxis(view.axis.id); }
      else void this.refitAxis(view.axis.id);
    };
    if (axisId) { const view = this.views.get(axisId); if (view) resetView(view); return; }
    for (const view of this.views.values()) if (view.mounted) resetView(view);
  }

  destroy(): void {
    this.timeline.pause();
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
    this.cameras.clear();
    this.contrastLimits.clear();
    this.element.replaceChildren();

    const shell = document.createElement("div");
    shell.className = "mplot-shell";
    const header = document.createElement("header");
    header.className = "mplot-header";
    const title = document.createElement("div");
    title.className = "mplot-title";
    title.textContent = this.model.document.title ?? "MPlot";
    header.append(title);
    if (this.options.toolbar !== false) header.append(this.createToolbar());
    if (
      this.activeFigureIdValue !== this.metadataPageId
      && this.activeFigureIdValue !== this.comparisonPageId
      && !this.model.document.figures.some((figure) => figure.id === this.activeFigureIdValue)
    ) this.activeFigureIdValue = this.model.document.figures[0]?.id;
    if (this.activeFigureIdValue === this.comparisonPageId && !this.comparison.open) {
      this.activeFigureIdValue = this.model.document.figures[0]?.id;
    }
    header.append(this.createNavigator());
    const timelineControls = this.timeline.createControls();
    if (timelineControls) header.append(timelineControls);
    const figuresElement = document.createElement("main");
    figuresElement.className = "mplot-figures";
    shell.append(header, figuresElement);
    this.element.append(shell);

    const immediateMounts: Promise<void>[] = [];
    const metadataPage = this.createMetadataPage();
    metadataPage.hidden = this.activeFigureIdValue !== this.metadataPageId;
    const comparisonPage = this.comparison.open ? this.createComparisonPage() : undefined;
    if (comparisonPage) comparisonPage.hidden = this.activeFigureIdValue !== this.comparisonPageId;
    this.comparisonElement = comparisonPage;
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
    figuresElement.append(metadataPage);
    if (comparisonPage) figuresElement.append(comparisonPage);
    if (token !== this.documentToken) return;
    await Promise.all(immediateMounts);
    if (this.activeFigureIdValue === this.comparisonPageId) await this.renderComparison();
    else if (this.activeFigureIdValue) await this.mountFigure(this.activeFigureIdValue);
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
    title.textContent = figure.title ?? figure.name ?? `Figure ${index + 1}`;
    const axisIds = this.figureAxisIds(figure);
    const plotAxisIds = axisIds.filter((axisId) => this.model.document.axes.find((axis) => axis.id === axisId)?.role !== "colorbar");
    const primaryPlotCount = plotAxisIds.filter((axisId) => this.model.document.axes.find((axis) => axis.id === axisId)?.role !== "inset").length;
    const count = document.createElement("span");
    count.className = "mplot-figure-count";
    count.textContent = `${primaryPlotCount} ${primaryPlotCount === 1 ? "plot" : "plots"}`;
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
    const originalValues = axis.colorbar?.ticks ?? [], originalLabels = axis.colorbar?.ticklabels ?? [];
    const originalLimits = axis.colorbar?.limits ?? [originalValues[0] ?? 0, originalValues.at(-1) ?? 1];
    const mappable = axis.colorbar?.mappable;
    const redraw = () => {
      const limits = mappable ? this.contrastLimits.get(mappable) ?? originalLimits : originalLimits;
      const overridden = Boolean(mappable && this.contrastLimits.has(mappable));
      const values = overridden ? Array.from({ length: 5 }, (_, index) => limits[0] + (limits[1] - limits[0]) * index / 4) : originalValues;
      ticks.replaceChildren();
      values.forEach((value, index) => {
        const fraction = (value - limits[0]) / (limits[1] - limits[0] || 1);
        // Like Matplotlib, hide ticks beyond the colour range instead of piling them on its ends.
        if (fraction < -1e-6 || fraction > 1 + 1e-6) return;
        const tick = document.createElement("span");
        tick.className = "mplot-colorbar-tick";
        tick.style.setProperty("--mplot-colorbar-position", `${Math.max(0, Math.min(1, fraction)) * 100}%`);
        const displayValue = Math.abs(value) < Math.abs(limits[1] - limits[0]) * 1e-12 ? 0 : Number(value.toPrecision(4));
        tick.textContent = overridden ? formatTick(displayValue, "linear") : originalLabels[index] ?? formatTick(value, "linear");
        ticks.append(tick);
      });
      if (overridden) colorbar.dataset.contrastLimits = limits.join(","); else delete colorbar.dataset.contrastLimits;
    };
    if (mappable) {
      colorbar.dataset.mappableId = mappable;
      colorbar.tabIndex = 0;
      colorbar.title = "With Zoom active, drag across the colorbar to select contrast limits; double-click to reset";
      let start: number | undefined, brush: HTMLDivElement | undefined;
      const fraction = (event: PointerEvent): number => {
        const bounds = gradient.getBoundingClientRect();
        return axis.colorbar?.orientation === "horizontal" ? Math.max(0, Math.min(1, (event.clientX - bounds.left) / (bounds.width || 1))) : Math.max(0, Math.min(1, (bounds.bottom - event.clientY) / (bounds.height || 1)));
      };
      const moveBrush = (from: number, to: number) => {
        if (!brush) { brush = document.createElement("div"); brush.className = "mplot-colorbar-brush"; gradient.append(brush); }
        const low = Math.min(from, to), size = Math.abs(to - from);
        if (axis.colorbar?.orientation === "horizontal") { brush.style.left = `${low * 100}%`; brush.style.width = `${size * 100}%`; }
        else { brush.style.bottom = `${low * 100}%`; brush.style.height = `${size * 100}%`; }
      };
      gradient.addEventListener("pointerdown", (event) => {
        if (this.mode !== "zoom") return;
        event.preventDefault(); start = fraction(event); moveBrush(start, start); gradient.setPointerCapture(event.pointerId);
      });
      gradient.addEventListener("pointermove", (event) => { if (start !== undefined) moveBrush(start, fraction(event)); });
      const finish = (event: PointerEvent, cancel = false) => {
        if (start === undefined) return;
        const end = fraction(event), from = start; start = undefined; brush?.remove(); brush = undefined;
        if (cancel || Math.abs(end - from) < .01) return;
        const current = this.contrastLimits.get(mappable) ?? originalLimits;
        const selected = [current[0] + Math.min(from, end) * (current[1] - current[0]), current[0] + Math.max(from, end) * (current[1] - current[0])] as [number, number];
        this.contrastLimits.set(mappable, selected); redraw();
        const artist = this.model.document.artists.find((candidate) => candidate.id === mappable);
        if (artist) void this.renderAxis(artist.axes_id);
      };
      gradient.addEventListener("pointerup", (event) => finish(event));
      gradient.addEventListener("pointercancel", (event) => finish(event, true));
      colorbar.addEventListener("dblclick", () => {
        this.contrastLimits.delete(mappable); redraw();
        const artist = this.model.document.artists.find((candidate) => candidate.id === mappable);
        if (artist) void this.renderAxis(artist.axes_id);
      });
    }
    redraw();
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
    host.className = `mplot-axis mplot-axis--pending${axis.role === "inset" ? " mplot-axis--inset" : ""}`;
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
    if (axis.role === "inset") readout.hidden = true;
    const viewport = this.model.viewports.get(axis.id) ?? { x: [0, 1] as [number, number], y: [0, 1] as [number, number] };
    return { axis, figureId, host, svg: chart, plot, overlay, readout, width: 640, height: 360, margin: { left: 64, right: 18, top: 28, bottom: 58 }, x: createScale(axis.xscale, viewport.x, [64, 622]), y: createScale(axis.yscale, viewport.y, [302, 28]), mounted: false };
  }

  private axisPosition(axis: Axis, index: number, count: number): [number, number, number, number] {
    const position = axis.position ?? inferredPosition(index, count);
    if (axis.role !== "inset" || !axis.parent_axes_id) return position;
    const parent = this.model.document.axes.find((candidate) => candidate.id === axis.parent_axes_id)?.position;
    if (!parent) return position;
    const width = Math.min(position[2], parent[2]), height = Math.min(position[3], parent[3]);
    const left = Math.max(parent[0], Math.min(position[0], parent[0] + parent[2] - width));
    const bottom = Math.max(parent[1], Math.min(position[1], parent[1] + parent[3] - height));
    return [left, bottom, width, height];
  }

  private positionAxis(host: HTMLElement, axis: Axis, index: number, count: number): void {
    const position = this.axisPosition(axis, index, count);
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
    for (const colorbar of this.element.querySelectorAll<HTMLElement>(`.mplot-colorbar[data-mappable-id]`)) {
      const mappable = colorbar.dataset.mappableId;
      if (mappable && this.model.document.artists.find((artist) => artist.id === mappable)?.axes_id === axisId) this.refreshColorbar(colorbar);
    }
  }

  private refreshColorbar(colorbar: HTMLElement): void {
    const mappable = colorbar.dataset.mappableId;
    const axisId = colorbar.dataset.axesId;
    const axis = this.model.document.axes.find((candidate) => candidate.id === axisId);
    if (!mappable || !axis) return;
    const replacement = this.createColorbar(axis);
    replacement.style.cssText = colorbar.style.cssText;
    colorbar.replaceWith(replacement);
  }

  private createNavigator(): HTMLElement {
    const navigation = document.createElement("nav");
    navigation.className = "mplot-navigator";
    navigation.setAttribute("aria-label", "Figures");
    const label = document.createElement("div");
    label.className = "mplot-navigator-label";
    label.textContent = "Figures";
    const previous = document.createElement("button");
    previous.type = "button"; previous.className = "mplot-page-step"; previous.textContent = "← Previous"; previous.setAttribute("aria-label", "Previous figure");
    const pages = document.createElement("div");
    pages.className = "mplot-page-list";
    const pageEntries = [
      ...this.model.document.figures.map((figure, index) => ({ id: figure.id, number: String(index + 1).padStart(2, "0"), name: figure.title ?? figure.name ?? `Figure ${index + 1}` })),
      ...(this.comparison.open ? [{ id: this.comparisonPageId, number: "↔", name: "Comparison" }] : []),
      { id: this.metadataPageId, number: "—", name: "Metadata" },
    ];
    pageEntries.forEach((page) => {
      const button = document.createElement("button");
      const number = document.createElement("span"), name = document.createElement("span");
      number.className = "mplot-page-number"; number.textContent = page.number;
      name.className = "mplot-page-name"; name.textContent = page.name;
      button.type = "button"; button.className = "mplot-page-button"; button.dataset.pageId = page.id; if (!page.id.startsWith("__")) button.dataset.figureId = page.id; button.append(number, name);
      button.title = page.name; button.setAttribute("aria-label", `Show ${page.name}`);
      button.onclick = () => void this.showPage(page.id);
      pages.append(button);
    });
    const next = document.createElement("button");
    next.type = "button"; next.className = "mplot-page-step"; next.textContent = "Next →"; next.setAttribute("aria-label", "Next figure");
    previous.onclick = () => void this.stepFigure(-1); next.onclick = () => void this.stepFigure(1);
    const steps = document.createElement("div"); steps.className = "mplot-page-steps"; steps.append(previous, next);
    navigation.append(label, pages, steps);
    queueMicrotask(() => this.updateNavigator());
    return navigation;
  }

  private async showPage(pageId: string): Promise<void> {
    if (pageId !== this.activeFigureIdValue) this.timeline.pause();
    if (pageId === this.comparisonPageId && !this.comparison.open) return;
    if (![this.metadataPageId, this.comparisonPageId].includes(pageId) && !this.figures.has(pageId)) return;
    this.activeFigureIdValue = pageId;
    for (const [id, figure] of this.figures) figure.element.hidden = id !== pageId;
    const metadata = this.element.querySelector<HTMLElement>(".mplot-metadata-page");
    if (metadata) metadata.hidden = pageId !== this.metadataPageId;
    if (this.comparisonElement) this.comparisonElement.hidden = pageId !== this.comparisonPageId;
    if (pageId === this.comparisonPageId) {
      this.activeAxisId = this.comparisonAxisId;
      await this.renderComparison();
    } else if (pageId !== this.metadataPageId) {
      const firstAxis = this.figures.get(pageId)?.axisIds[0];
      if (firstAxis) { this.activeAxisId = firstAxis; this.markActiveAxis(); }
    }
    this.updateNavigator();
    if (![this.metadataPageId, this.comparisonPageId].includes(pageId)) await this.mountFigure(pageId);
  }

  private async showFigure(figureId: string): Promise<void> { await this.showPage(figureId); }

  private stepFigure(offset: number): void {
    const pages = this.pageIds();
    const current = Math.max(0, pages.indexOf(this.activeFigureIdValue ?? ""));
    const next = pages[current + offset]; if (next) void this.showPage(next);
  }

  private updateNavigator(): void {
    const pages = this.pageIds(), index = pages.indexOf(this.activeFigureIdValue ?? "");
    this.element.querySelectorAll<HTMLButtonElement>(".mplot-page-list [data-page-id]").forEach((button) => button.setAttribute("aria-current", button.dataset.pageId === this.activeFigureIdValue ? "page" : "false"));
    const previous = this.element.querySelector<HTMLButtonElement>('[aria-label="Previous figure"]'), next = this.element.querySelector<HTMLButtonElement>('[aria-label="Next figure"]');
    if (previous) previous.disabled = index <= 0;
    if (next) next.disabled = index < 0 || index >= pages.length - 1;
  }

  private pageIds(): string[] {
    return [
      ...this.model.document.figures.map((figure) => figure.id),
      ...(this.comparison.open ? [this.comparisonPageId] : []),
      this.metadataPageId,
    ];
  }

  private createComparisonPage(): HTMLElement {
    const page = document.createElement("section");
    page.className = "mplot-comparison-page";
    page.dataset.figureId = this.comparisonPageId;

    const heading = document.createElement("header");
    heading.className = "mplot-figure-header";
    const title = document.createElement("h2");
    title.className = "mplot-figure-title";
    title.textContent = "Line comparison";
    const close = document.createElement("button");
    close.type = "button";
    close.className = "mplot-button mplot-comparison-close";
    close.textContent = "Close comparison";
    close.onclick = () => this.closeComparison();
    heading.append(title, close);

    const canvas = document.createElement("div");
    canvas.className = "mplot-figure-canvas mplot-comparison-canvas";
    canvas.style.setProperty("--mplot-figure-ratio", "1.6");
    page.append(heading, canvas);
    return page;
  }

  private async renderComparison(): Promise<void> {
    if (!this.comparison.open || !this.comparisonElement) return;
    const artists = this.comparison.artists(this.model.document);
    const sourceAxis = this.comparison.sourceAxis(this.model.document);
    if (!artists.length || !sourceAxis) return;

    let view = this.views.get(this.comparisonAxisId);
    if (!view) {
      const axis: Axis = {
        id: this.comparisonAxisId,
        title: "Selected lines",
        ...(sourceAxis.xlabel ? { xlabel: sourceAxis.xlabel } : {}),
        ...(sourceAxis.ylabel ? { ylabel: sourceAxis.ylabel } : {}),
        xscale: sourceAxis.xscale ?? "linear",
        yscale: sourceAxis.yscale ?? "linear",
      };
      view = this.createAxis(axis, this.comparisonPageId);
      view.host.classList.add("mplot-comparison-axis");
      view.host.style.inset = "0";
      view.host.style.width = "100%";
      view.host.style.height = "100%";
      this.comparisonElement.querySelector(".mplot-comparison-canvas")?.append(view.host);
      this.views.set(this.comparisonAxisId, view);
      view.mounted = true;
      view.host.classList.remove("mplot-axis--pending");
      view.host.replaceChildren(view.svg, view.readout);
      if (this.options.interactive !== false) this.bindInteractions(view);
    }

    const data = await Promise.all(artists.map(async (artist) => {
      const resolved = this.resolvedData.get(artist.id) ?? await this.model.resolveData(artist.data, artist);
      this.resolvedData.set(artist.id, resolved);
      return resolved;
    }));
    this.model.viewports.set(
      this.comparisonAxisId,
      fitLineViewport(data, view.axis.xscale, view.axis.yscale),
    );
    await this.renderAxis(this.comparisonAxisId);
    this.markActiveAxis();
  }

  private closeComparison(): void {
    this.comparison.clear();
    this.compareMode = false;
    this.element.classList.remove("mplot-compare-mode");
    this.views.delete(this.comparisonAxisId);
    this.model.viewports.delete(this.comparisonAxisId);
    this.activeAxisId = undefined;
    this.activeFigureIdValue = this.model.document.figures[0]?.id;
    void this.render();
  }

  private createMetadataPage(): HTMLElement {
    const page = document.createElement("section");
    page.className = "mplot-metadata-page";
    const heading = document.createElement("header"), title = document.createElement("h2"), subtitle = document.createElement("span");
    heading.className = "mplot-figure-header"; title.className = "mplot-figure-title"; title.textContent = "Result metadata"; subtitle.className = "mplot-figure-count"; subtitle.textContent = "provenance and document";
    heading.append(title, subtitle);
    const body = document.createElement("div"); body.className = "mplot-metadata-body";
    body.append(this.metadataTree(this.model.document.metadata ?? {}, "Metadata"));
    page.append(heading, body);
    return page;
  }

  private metadataTree(value: unknown, label: string): HTMLElement {
    const section = document.createElement("section"), heading = document.createElement(label === "Metadata" ? "h3" : "h4");
    section.className = "mplot-metadata-section"; heading.textContent = label; section.append(heading);
    if (!value || typeof value !== "object") {
      const output = document.createElement("p"); output.textContent = value === null ? "null" : String(value); section.append(output); return section;
    }
    const list = document.createElement("dl"), nested: HTMLElement[] = [];
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (item && typeof item === "object") {
        if (!Object.keys(item).length) continue;
        nested.push(this.metadataTree(item, key)); continue;
      }
      const term = document.createElement("dt"), definition = document.createElement("dd");
      term.textContent = key; definition.textContent = item === null ? "null" : String(item); list.append(term, definition);
    }
    if (list.childElementCount) section.append(list);
    section.append(...nested);
    return section;
  }

  private async renderTimelineDocument(document: MPlotDocument): Promise<void> {
    this.model.document = document;
    for (const [axesId, view] of this.views) {
      const axis = document.axes.find((candidate) => candidate.id === axesId);
      if (axis) view.axis = axis;
    }
    for (const [figureId, view] of this.figures) {
      const figure = document.figures.find((candidate) => candidate.id === figureId);
      if (figure) view.figure = figure;
    }
    this.resolvedData.clear();
    this.axisTokens.clear();
    await this.renderMounted();
  }

  private createToolbar(): HTMLElement {
    const toolbar = document.createElement("nav");
    toolbar.className = "mplot-toolbar";
    toolbar.setAttribute("aria-label", "Plot tools");
    const actions: Array<[string, string, () => void]> = [["Pan", "pan", () => this.setMode("pan")], ["Zoom", "zoom", () => this.setMode("zoom")], ["Reset", "reset", () => this.reset()], ["Compare lines", "compare", () => this.toggleCompareMode()]];
    for (const [label, name, action] of actions) {
      const button = document.createElement("button"); button.type = "button"; button.className = "mplot-button"; button.textContent = label; button.dataset.action = name; button.title = label; button.onclick = action;
      if (["pan", "zoom"].includes(name)) button.setAttribute("aria-pressed", String(this.mode === name));
      if (name === "compare") button.setAttribute("aria-pressed", String(this.compareMode));
      toolbar.append(button);
    }
    const comparisonStatus = document.createElement("output");
    comparisonStatus.className = "mplot-comparison-status";
    comparisonStatus.setAttribute("aria-live", "polite");
    comparisonStatus.textContent = this.comparison.message;
    const openComparison = document.createElement("button");
    openComparison.type = "button";
    openComparison.className = "mplot-button mplot-open-comparison";
    openComparison.dataset.action = "open-comparison";
    openComparison.textContent = "Open comparison";
    openComparison.disabled = !this.comparison.active;
    openComparison.onclick = () => void this.openComparison();
    toolbar.append(comparisonStatus, openComparison);
    const select = document.createElement("select");
    select.className = "mplot-export-scope";
    select.setAttribute("aria-label", "Export scope");
    for (const [value, label] of [["axis", "Current plot"], ["figure", "Current figure"], ["artifact", "Entire result"], ["figures", "Each figure"]] as const) {
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
      if (["pan", "zoom"].includes(button.dataset.action ?? "")) button.setAttribute("aria-pressed", String(button.dataset.action === mode));
    });
  }

  private toggleCompareMode(): void {
    this.compareMode = !this.compareMode;
    this.element.classList.toggle("mplot-compare-mode", this.compareMode);
    this.element.querySelector<HTMLElement>('[data-action="compare"]')
      ?.setAttribute("aria-pressed", String(this.compareMode));
    this.refreshComparisonControls();
  }

  private configureComparisonTarget(group: SVGGElement, artist: Artist): void {
    group.classList.add("mplot-comparable-line");
    group.classList.toggle("mplot-line-selected", this.comparison.selectedIds.has(artist.id));
    group.setAttribute("role", "button");
    group.setAttribute("tabindex", "0");
    group.setAttribute("aria-pressed", String(this.comparison.selectedIds.has(artist.id)));
    group.setAttribute("aria-label", `Compare ${String(artist.props.label ?? artist.id)}`);
    const select = (event: Event) => {
      if (!this.compareMode || this.activeFigureIdValue === this.comparisonPageId) return;
      event.preventDefault();
      event.stopPropagation();
      this.selectComparisonArtist(artist.id);
    };
    group.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") select(event);
    });
  }

  private selectComparisonArtist(artistId: string): void {
    const result = this.comparison.toggle(this.model.document, artistId);
    this.element.querySelectorAll<SVGGElement>("[data-artist-id]")
      .forEach((group) => {
        if (group.dataset.artistId !== artistId) return;
        group.classList.toggle("mplot-line-selected", result.selected);
        group.setAttribute("aria-pressed", String(result.selected));
      });
    this.refreshComparisonControls();
  }

  private refreshComparisonControls(): void {
    const status = this.element.querySelector<HTMLOutputElement>(".mplot-comparison-status");
    if (status) status.textContent = this.comparison.message;
    const open = this.element.querySelector<HTMLButtonElement>(".mplot-open-comparison");
    if (open) open.disabled = !this.comparison.active;
  }

  private async openComparison(): Promise<void> {
    if (!this.comparison.active) return;
    this.comparison.open = true;
    this.exportScope = "axis";
    this.compareMode = false;
    this.element.classList.remove("mplot-compare-mode");
    await this.render();
    await this.showPage(this.comparisonPageId);
  }

  private async renderMounted(): Promise<void> { await Promise.all(Array.from(this.views.values()).filter((view) => view.mounted).map((view) => this.renderAxis(view.axis.id))); }

  private async renderAxis(axisId: string): Promise<void> {
    const pending = this.axisRenders.get(axisId);
    if (pending) { this.dirtyAxes.add(axisId); return pending; }
    const operation = (async () => {
      try {
        // Requests that arrive mid-render mark the axis dirty; draw again until it is current.
        do {
          this.dirtyAxes.delete(axisId);
          await this.renderAxisNow(axisId);
        } while (this.dirtyAxes.has(axisId));
      } finally { this.axisRenders.delete(axisId); }
    })();
    this.axisRenders.set(axisId, operation);
    return operation;
  }

  private async renderAxisNow(axisId: string): Promise<void> {
    const view = this.views.get(axisId);
    if (!view?.mounted || view.figureId !== this.activeFigureIdValue) return;
    const token = (this.axisTokens.get(axisId) ?? 0) + 1, documentToken = this.documentToken, source = this.model.document;
    this.axisTokens.set(axisId, token);
    view.width = Math.max(180, view.host.clientWidth || 640);
    view.height = Math.max(150, view.host.clientHeight || 360);
    const is3d = view.axis.projection === "3d";
    view.margin = view.axis.role === "inset" ? insetMargins(view.axis, view.width, view.height) : is3d ? margins3d(view.width, view.height) : compactMargins(view.width, view.height);
    const viewport = this.model.viewports.get(axisId) ?? this.model.defaultViewport(view.axis);
    const right = view.width - view.margin.right;
    if (!is3d && view.axis.role !== "inset") {
      // Make room for the widest y tick label, plus the y label beside it.
      view.y = createScale(view.axis.yscale, viewport.y, [view.height - view.margin.bottom, view.margin.top]);
      view.margin.left = Math.max(view.margin.left, Math.ceil(this.yTickWidth(view) + (this.showsYLabel(view) ? 34 : 14)));
    }
    view.x = createScale(view.axis.xscale, viewport.x, [view.margin.left, right]);
    if (!is3d) view.margin.bottom += this.xTickLayout(view).extra;
    const bottom = view.height - view.margin.bottom;
    view.y = createScale(view.axis.yscale, viewport.y, [bottom, view.margin.top]);
    const plot = svg("g"), overlay = svg("g"), working = { ...view, plot, overlay };
    this.drawAxes(working);
    const clipId = `mplot-clip-${safeId(view.axis.id)}`, defs = svg("defs"), clip = svg("clipPath", { id: clipId });
    clip.append(svg("rect", { x: view.margin.left, y: view.margin.top, width: right - view.margin.left, height: bottom - view.margin.top })); defs.append(clip); plot.prepend(defs);
    const artists = axisId === this.comparisonAxisId
      ? this.comparison.artists(this.model.document).filter((artist) => artist.props.visible !== false)
      : this.model.document.artists.filter((artist) => artist.axes_id === axisId && artist.props.visible !== false);
    for (const artist of artists) {
      const group = svg("g", is3d ? { "data-artist-id": artist.id } : { "data-artist-id": artist.id, "clip-path": `url(#${clipId})` });
      if (artist.type === "mplot.line") this.configureComparisonTarget(group, artist);
      plot.append(group);
      const renderer = this.renderers.get(artist.type);
      if (!renderer) { this.drawUnknown(group, artist, working); continue; }
      try {
        const data = this.resolvedData.get(artist.id) ?? await this.model.resolveData(artist.data, artist);
        if (documentToken !== this.documentToken || source !== this.model.document || this.views.get(axisId) !== view || view.figureId !== this.activeFigureIdValue) return;
        this.resolvedData.set(artist.id, data);
        const contrast = this.contrastLimits.get(artist.id);
        const effectiveArtist = contrast ? { ...artist, props: { ...artist.props, clim: contrast } } : artist;
        await renderer({ ...working, group, artist: effectiveArtist, data, theme: this.theme, pointBudget: Math.max(500, Math.round(view.width * 4)), project3d: (x, y, z) => this.project3d(view, x, y, z), depth3d: (x, y, z) => this.depth3d(view, x, y, z) } as RenderContext);
        if (artist.type === "mplot.line" && axisId !== this.comparisonAxisId) {
          const path = group.querySelector("path");
          if (path) {
            const hitTarget = path.cloneNode(false) as SVGPathElement;
            hitTarget.classList.add("mplot-line-hit");
            hitTarget.removeAttribute("stroke-dasharray");
            hitTarget.setAttribute("stroke", "transparent");
            hitTarget.setAttribute("stroke-width", "14");
            hitTarget.setAttribute("pointer-events", "stroke");
            group.prepend(hitTarget);
          }
        }
      } catch (error) { this.drawUnknown(group, artist, working, error instanceof Error ? error.message : "render failed"); }
    }
    if (documentToken !== this.documentToken || source !== this.model.document || this.views.get(axisId) !== view || view.figureId !== this.activeFigureIdValue || this.axisTokens.get(axisId) !== token) return;
    this.drawHitArea(working);
    view.svg.setAttribute("viewBox", `0 0 ${view.width} ${view.height}`);
    view.plot.replaceChildren(...plot.childNodes);
    view.overlay.replaceChildren(...overlay.childNodes);
  }

  private drawAxes(view: AxisView): void {
    const { left, top, bottom, right } = view.margin, b = view.height - bottom, r = view.width - right;
    if (view.axis.title) view.plot.append(plotText({ x: (left + r) / 2, y: Math.max(PLOT_TEXT_SIZE, top - 16), "text-anchor": "middle", "font-size": PLOT_TEXT_SIZE }, view.axis.title, "mplot-axis-title"));
    if (view.axis.projection === "3d") { this.draw3dAxes(view); return; }
    const xTicks = this.xTickLayout(view);
    for (const [tick, label] of xTicks.ticks) {
      const px = view.x(tick), py = b + PLOT_TEXT_SIZE + 5;
      view.plot.append(svg("line", { x1: px, x2: px, y1: top, y2: b, class: "mplot-grid-line" }));
      view.plot.append(xTicks.rotated
        ? plotText({ x: px, y: py - 4, "text-anchor": "end", "font-size": PLOT_TEXT_SIZE, transform: `rotate(${-TICK_ROTATION} ${px} ${b + 6})` }, label, "mplot-tick")
        : plotText({ x: px, y: py, "text-anchor": "middle", "font-size": PLOT_TEXT_SIZE }, label, "mplot-tick"));
    }
    const yTicks = this.yTicks(view);
    for (const { tick, label } of yTicks) { const py = view.y(tick); view.plot.append(svg("line", { x1: left, x2: r, y1: py, y2: py, class: "mplot-grid-line" })); view.plot.append(plotText({ x: left - 9, y: py + PLOT_TEXT_SIZE * .34, "text-anchor": "end", "font-size": PLOT_TEXT_SIZE }, label, "mplot-tick")); }
    view.plot.append(svg("path", { d: `M${left},${top}H${r}V${b}H${left}Z`, fill: "none", class: "mplot-axis-frame" }));
    if (view.axis.xlabel && view.height > 180) view.plot.append(plotText({ x: (left + r) / 2, y: b + 46 + xTicks.extra, "text-anchor": "middle", "font-size": PLOT_TEXT_SIZE }, view.axis.xlabel, "mplot-label"));
    if (view.axis.ylabel && this.showsYLabel(view)) {
      // Rotated glyphs reach about 11px left of the baseline and 4px right of it.
      const x = Math.max(13, left - 19 - this.yTickWidth(view)), y = (top + b) / 2;
      view.plot.append(plotText({ x, y, "text-anchor": "middle", "font-size": PLOT_TEXT_SIZE, transform: `rotate(-90 ${x} ${y})` }, view.axis.ylabel, "mplot-label"));
    }
  }

  private showsYLabel(view: AxisView): boolean { return Boolean(view.axis.ylabel) && view.width > 230; }
  private yTicks(view: AxisView): Array<{ tick: number; label: string }> {
    const candidates = this.axisTicks(view, "y", Math.max(3, Math.floor((view.height - view.margin.bottom - view.margin.top) / 80)));
    return thinTicks(candidates.map(([tick, label]) => ({ tick, label, position: view.y(tick), extent: PLOT_TEXT_SIZE * (hasMath(label) ? 1.3 : 1) })), 3);
  }
  private yTickWidth(view: AxisView): number { return Math.max(0, ...this.yTicks(view).map(({ label }) => labelWidth(label))); }

  /** X ticks that fit side by side; long text labels are rotated rather than dropped where possible. */
  private xTickLayout(view: AxisView): { ticks: Array<[number, string]>; rotated: boolean; extra: number } {
    const candidates = this.axisTicks(view, "x", Math.max(3, Math.floor((view.width - view.margin.right - view.margin.left) / 110)));
    const items = candidates.map(([tick, label]) => ({ tick, label, position: view.x(tick), extent: labelWidth(label) }));
    const level = thinTicks(items, TICK_GAP);
    const textual = items.some(({ label }) => /\p{L}/u.test(label)) && !items.some(({ label }) => hasMath(label));
    if (level.length === items.length || !textual) return { ticks: level.map(({ tick, label }) => [tick, label]), rotated: false, extra: 0 };
    // Rotated labels only need their baselines to be a line height apart.
    const angle = TICK_ROTATION * Math.PI / 180;
    const rotated = thinTicks(items.map((item) => ({ ...item, extent: PLOT_TEXT_SIZE / Math.sin(angle) })), 0);
    const height = Math.max(...rotated.map(({ label }) => labelWidth(label) * Math.sin(angle) + PLOT_TEXT_SIZE * Math.cos(angle)));
    return { ticks: rotated.map(({ tick, label }) => [tick, label]), rotated: true, extra: Math.max(0, Math.ceil(height - PLOT_TEXT_SIZE)) };
  }

  private axisTicks(view: AxisView, dimension: "x" | "y" | "z", count: number): Array<[number, string]> {
    const metadata = view.axis.props?.[`${dimension}axis`] as { ticks?: number[]; ticklabels?: string[]; provided?: boolean; date_format?: string } | undefined;
    const viewport = this.model.viewports.get(view.axis.id), domain = viewport?.[dimension];
    const scaleType = dimension === "x" ? view.axis.xscale : dimension === "y" ? view.axis.yscale : "linear";
    const scale = dimension === "x" ? view.x : dimension === "y" ? view.y : createScale("linear", domain ?? [0, 1], [0, 1]);
    if (metadata?.provided && metadata.ticks?.length === 0) return [];
    if (metadata?.ticks?.length && metadata.ticklabels?.some((label) => label)) {
      const lower = Math.min(...domain ?? [-Infinity, Infinity]), upper = Math.max(...domain ?? [-Infinity, Infinity]);
      return metadata.ticks.map((tick, index) => [tick, metadata.ticklabels?.[index] || formatTick(tick, scaleType, metadata.date_format)] as [number, string]).filter(([tick]) => tick >= lower && tick <= upper);
    }
    const ticks = scale.ticks(count);
    const visibleTicks = scaleType === "symlog" && ticks.length > count && ticks.includes(0) ? [ticks[0]!, 0, ticks.at(-1)!] : ticks;
    return visibleTicks.map((tick) => [tick, formatTick(tick, scaleType)]);
  }

  private dateFormat(view: AxisView, dimension: "x" | "y"): string | undefined { return (view.axis.props?.[`${dimension}axis`] as { date_format?: string } | undefined)?.date_format; }

  private drawUnknown(group: SVGGElement, artist: Artist, view: AxisView, reason = "Renderer not installed"): void { const box = svg("g", { class: "mplot-unknown" }); box.append(svg("rect", { x: view.margin.left + 8, y: view.margin.top + 8, width: Math.min(220, view.width - view.margin.left - 20), height: 40, rx: 2 })); const text = svg("text", { x: view.margin.left + 16, y: view.margin.top + 25 }); text.textContent = `Unknown: ${artist.type}`; const detail = svg("text", { x: view.margin.left + 16, y: view.margin.top + 40 }); detail.textContent = reason; box.append(text, detail); group.append(box); }
  private drawHitArea(view: AxisView): void { const { left, top, bottom, right } = view.margin; view.overlay.append(svg("rect", { x: left, y: top, width: view.width - right - left, height: view.height - bottom - top, class: "mplot-hit" })); }

  private bindInteractions(view: AxisView): void {
    if (view.axis.projection === "3d") { this.bind3dInteractions(view); return; }
    let start: { x: number; y: number; viewport: Viewport; xScale: Scale; yScale: Scale } | undefined; let brush: SVGRectElement | undefined;
    const finish = (event: PointerEvent, cancel = false) => { if (!start) return; const pointer = this.pointer(view, event), p = this.boundToPlot(view, pointer.x, pointer.y); if (!cancel && this.mode === "zoom" && Math.hypot(p.x - start.x, p.y - start.y) > 4) this.model.setViewport(view.axis.id, { ...start.viewport, x: [view.x.invert(Math.min(start.x, p.x)), view.x.invert(Math.max(start.x, p.x))], y: [view.y.invert(Math.max(start.y, p.y)), view.y.invert(Math.min(start.y, p.y))] }); start = undefined; brush?.remove(); brush = undefined; };
    view.svg.addEventListener("pointerdown", (event) => {
      this.activeAxisId = view.axis.id;
      this.markActiveAxis();
      const p = this.pointer(view, event);
      if (!this.inPlot(view, p.x, p.y)) return;
      if (this.compareMode) {
        const artistId = this.nearestLine(view, p.x, p.y, 12);
        if (artistId) this.selectComparisonArtist(artistId);
        return;
      }
      start = { ...p, viewport: structuredClone(this.model.viewports.get(view.axis.id)!), xScale: view.x, yScale: view.y };
      view.svg.setPointerCapture(event.pointerId);
      if (this.mode === "zoom") { brush = svg("rect", { x: p.x, y: p.y, width: 0, height: 0, class: "mplot-brush mplot-brush--zoom" }); view.overlay.append(brush); }
    });
    view.svg.addEventListener("pointermove", (event) => { const p = this.pointer(view, event); this.updateCoordinates(view, p.x, p.y); if (!start) { this.showTooltip(view, p.x, p.y); return; } if (this.mode === "pan") { const next = structuredClone(start.viewport), dx = start.x - p.x, dy = start.y - p.y, bounds = this.plotBounds(view); next.x = [start.xScale.invert(bounds.left + dx), start.xScale.invert(bounds.right + dx)]; next.y = [start.yScale.invert(bounds.bottom + dy), start.yScale.invert(bounds.top + dy)]; this.model.setViewport(view.axis.id, next); } else if (brush) { const bounded = this.boundToPlot(view, p.x, p.y); brush.setAttribute("x", String(Math.min(start.x, bounded.x))); brush.setAttribute("y", String(Math.min(start.y, bounded.y))); brush.setAttribute("width", String(Math.abs(bounded.x - start.x))); brush.setAttribute("height", String(Math.abs(bounded.y - start.y))); } });
    view.svg.addEventListener("pointerup", (event) => finish(event));
    view.svg.addEventListener("pointercancel", (event) => finish(event, true));
    view.svg.addEventListener("pointerleave", () => { if (!start) this.clearHover(view); });
    view.svg.addEventListener("wheel", (event) => { event.preventDefault(); const p = this.pointer(view, event); if (!this.inPlot(view, p.x, p.y)) return; const factor = Math.exp(event.deltaY * .001), current = this.model.viewports.get(view.axis.id)!, bounds = this.plotBounds(view); const zoomPixel = (edge: number, center: number) => center + (edge - center) * factor; this.model.setViewport(view.axis.id, { ...current, x: [view.x.invert(zoomPixel(bounds.left, p.x)), view.x.invert(zoomPixel(bounds.right, p.x))], y: [view.y.invert(zoomPixel(bounds.bottom, p.y)), view.y.invert(zoomPixel(bounds.top, p.y))] }); }, { passive: false });
    view.svg.addEventListener("dblclick", () => this.reset(view.axis.id));
  }

  private bind3dInteractions(view: AxisView): void {
    let start: { x: number; y: number; elev: number; azim: number } | undefined;
    const camera = () => this.camera(view);
    view.svg.classList.add("mplot-3d-view");
    view.svg.addEventListener("pointerdown", (event) => { const p = this.pointer(view, event), current = camera(); start = { ...p, elev: current.elev, azim: current.azim }; view.svg.setPointerCapture(event.pointerId); });
    view.svg.addEventListener("pointermove", (event) => { const p = this.pointer(view, event); this.updateCoordinates(view, p.x, p.y); if (!start) return; const current = camera(); current.azim = start.azim + (p.x - start.x) * .45; current.elev = Math.max(-89, Math.min(89, start.elev - (p.y - start.y) * .45)); void this.renderAxis(view.axis.id); });
    const finish = () => { start = undefined; }; view.svg.addEventListener("pointerup", finish); view.svg.addEventListener("pointercancel", finish);
    view.svg.addEventListener("wheel", (event) => { event.preventDefault(); const current = camera(); current.zoom = Math.max(.4, Math.min(3, current.zoom * Math.exp(-event.deltaY * .001))); void this.renderAxis(view.axis.id); }, { passive: false });
    view.svg.addEventListener("dblclick", () => { this.cameras.delete(view.axis.id); void this.renderAxis(view.axis.id); });
  }

  private camera(view: AxisView): { elev: number; azim: number; roll: number; zoom: number } {
    let camera = this.cameras.get(view.axis.id);
    if (!camera) { const settings = view.axis.props?.view as { elev?: number; azim?: number; roll?: number } | undefined; camera = { elev: settings?.elev ?? 30, azim: settings?.azim ?? -60, roll: settings?.roll ?? 0, zoom: 1 }; this.cameras.set(view.axis.id, camera); }
    return camera;
  }

  private pointer(view: AxisView, event: PointerEvent | WheelEvent): { x: number; y: number } { const rect = view.svg.getBoundingClientRect(); return { x: (event.clientX - rect.left) * view.width / (rect.width || view.width), y: (event.clientY - rect.top) * view.height / (rect.height || view.height) }; }
  private plotBounds(view: AxisView): { left: number; right: number; top: number; bottom: number } { return { left: view.margin.left, right: view.width - view.margin.right, top: view.margin.top, bottom: view.height - view.margin.bottom }; }
  private inPlot(view: AxisView, x: number, y: number): boolean { const bounds = this.plotBounds(view); return x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom; }
  private boundToPlot(view: AxisView, x: number, y: number): { x: number; y: number } { const bounds = this.plotBounds(view); return { x: Math.max(bounds.left, Math.min(bounds.right, x)), y: Math.max(bounds.top, Math.min(bounds.bottom, y)) }; }
  private updateCoordinates(view: AxisView, px: number, py: number): void { view.readout.textContent = this.inPlot(view, px, py) ? `x = ${formatTick(view.x.invert(px), view.axis.xscale, this.dateFormat(view, "x"))} · y = ${formatTick(view.y.invert(py), view.axis.yscale, this.dateFormat(view, "y"))}` : "x — · y —"; }
  private clearHover(view: AxisView): void { view.host.querySelector<HTMLElement>(".mplot-tooltip")?.remove(); view.readout.textContent = "x — · y —"; }

  private nearestLine(view: AxisView, px: number, py: number, maximumDistance: number): string | undefined {
    let nearest: { id: string; distance: number } | undefined;
    for (const artist of this.model.document.artists.filter(
      (candidate) => candidate.axes_id === view.axis.id && candidate.type === "mplot.line" && candidate.props.visible !== false,
    )) {
      const data = this.resolvedData.get(artist.id) ?? artist.data;
      const points = pairs(data.x, data.y).map(([x, y]) => [view.x(x), view.y(y)] as [number, number]);
      for (let index = 1; index < points.length; index++) {
        const distance = pointSegmentDistance(px, py, points[index - 1]!, points[index]!);
        if (distance <= maximumDistance && (!nearest || distance < nearest.distance)) {
          nearest = { id: artist.id, distance };
        }
      }
      if (points.length === 1) {
        const distance = Math.hypot(points[0]![0] - px, points[0]![1] - py);
        if (distance <= maximumDistance && (!nearest || distance < nearest.distance)) {
          nearest = { id: artist.id, distance };
        }
      }
    }
    return nearest?.id;
  }

  private showTooltip(view: AxisView, px: number, py: number): void { let best: { artist: Artist; index: number; x: number; y: number; distance: number } | undefined; for (const artist of this.model.document.artists.filter((item) => item.axes_id === view.axis.id)) { const data = this.resolvedData.get(artist.id) ?? artist.data, values = pairs(data.x, data.y), stride = Math.max(1, Math.floor(values.length / 5000)); for (let offset = 0; offset < values.length; offset += stride) { const [x, y, index] = values[offset]!, distance = Math.hypot(view.x(x) - px, view.y(y) - py); if (distance < 18 && (!best || distance < best.distance)) best = { artist, index, x, y, distance }; } } let tooltip = view.host.querySelector<HTMLElement>(".mplot-tooltip"); if (!best) { tooltip?.remove(); return; } if (!tooltip) { tooltip = document.createElement("div"); tooltip.className = "mplot-tooltip"; view.host.append(tooltip); } tooltip.style.left = `${px / view.width * 100}%`; tooltip.style.top = `${py / view.height * 100}%`; const rawLabel = best.artist.props.label; const label = typeof rawLabel === "string" && rawLabel && !rawLabel.startsWith("_") ? `${rawLabel} · ` : ""; tooltip.textContent = `${label}x = ${formatTick(best.x, view.axis.xscale, this.dateFormat(view, "x"))} · y = ${formatTick(best.y, view.axis.yscale, this.dateFormat(view, "y"))}`; }
  /** Maps data coordinates into the unit box centred on the origin. */
  private normalize3d(view: AxisView, x: number, y: number, z: number): Point3 {
    const viewport = this.model.viewports.get(view.axis.id)!, zlim = viewport.z ?? [0, 1];
    const normalize = (value: number, limits: [number, number]) => (value - limits[0]) / (limits[1] - limits[0] || 1) - 0.5;
    return [normalize(x, viewport.x), normalize(y, viewport.y), normalize(z, zlim)];
  }
  private project3d(view: AxisView, x: number, y: number, z: number): [number, number] { return this.projectUnit(view, this.normalize3d(view, x, y, z)); }
  private depth3d(view: AxisView, x: number, y: number, z: number): number { return unitDepth(this.camera(view), this.normalize3d(view, x, y, z)); }
  private projectUnit(view: AxisView, point: Point3): [number, number] {
    const camera = this.camera(view), [horizontal, vertical] = unitScreen(camera, point);
    const left = view.margin.left, right = view.width - view.margin.right, top = view.margin.top, bottom = view.height - view.margin.bottom;
    // Fit the box as seen from the document's own view, so the size stays put while rotating.
    const settings = view.axis.props?.view as { elev?: number; azim?: number; roll?: number } | undefined;
    const initial = { elev: settings?.elev ?? 30, azim: settings?.azim ?? -60, roll: settings?.roll ?? 0 };
    const corners = BOX_CORNERS.map((corner) => unitScreen(initial, corner));
    const halfWidth = Math.max(...corners.map(([h]) => Math.abs(h))), halfHeight = Math.max(...corners.map(([, v]) => Math.abs(v)));
    const scale = Math.min((right - left) / 2 / halfWidth, (bottom - top) / 2 / halfHeight) * 0.9 * camera.zoom;
    return [(left + right) / 2 + horizontal * scale, (top + bottom) / 2 - vertical * scale];
  }

  /** Draws Matplotlib-style back panes with grids, and ticks along the outer edges of the box. */
  private draw3dAxes(view: AxisView): void {
    const camera = this.camera(view), project = (point: Point3) => this.projectUnit(view, point);
    const viewport = this.model.viewports.get(view.axis.id) ?? this.model.defaultViewport(view.axis);
    const limits = [viewport.x, viewport.y, viewport.z ?? [0, 1]] as const;
    const dimensions = ["x", "y", "z"] as const;
    const point = (dimension: number, value: number, others: [number, number]): Point3 => { const result: number[] = [...others]; result.splice(dimension, 0, value); return result as Point3; };
    // The pane farther from the viewer on each axis.
    const back = [0, 1, 2].map((dimension) => unitDepth(camera, point(dimension, .5, [0, 0])) < unitDepth(camera, point(dimension, -.5, [0, 0])) ? .5 : -.5);
    const ticks = dimensions.map((dimension, index) => this.axisTicks(view, dimension, 5).map(([tick, label]) => { const [low, high] = limits[index]!; return { tick, label, unit: (tick - low) / (high - low || 1) - .5 }; }).filter(({ unit }) => unit >= -.5 - 1e-9 && unit <= .5 + 1e-9));
    const line = (from: Point3, to: Point3, className: string) => { const [x1, y1] = project(from), [x2, y2] = project(to); view.plot.append(svg("line", { x1, y1, x2, y2, class: className })); };
    for (const dimension of [0, 1, 2]) {
      const [a, b] = [0, 1, 2].filter((other) => other !== dimension) as [number, number];
      const corner = (u: number, v: number): Point3 => { const result: Point3 = [0, 0, 0]; result[dimension] = back[dimension]!; result[a] = u; result[b] = v; return result; };
      view.plot.append(svg("path", { d: `M${[corner(-.5, -.5), corner(.5, -.5), corner(.5, .5), corner(-.5, .5)].map((c) => project(c).map((n) => n.toFixed(2)).join(",")).join("L")}Z`, class: "mplot-3d-pane" }));
      for (const { unit } of ticks[a]!) line(corner(unit, -.5), corner(unit, .5), "mplot-grid-line");
      for (const { unit } of ticks[b]!) line(corner(-.5, unit), corner(.5, unit), "mplot-grid-line");
    }
    const center = project([0, 0, 0]);
    // Edges carrying each axis: x and y run along the floor at the front, z up the outer side.
    const front = back.map((value) => -value);
    const zCandidates: Array<[number, number]> = [[back[0]!, front[1]!], [front[0]!, back[1]!]];
    const zEdge = zCandidates.reduce((best, candidate) => project([...candidate, 0])[0] > project([...best, 0])[0] ? candidate : best);
    const edges: Array<(unit: number) => Point3> = [(unit) => [unit, front[1]!, back[2]!], (unit) => [front[0]!, unit, back[2]!], (unit) => [zEdge[0], zEdge[1], unit]];
    for (const [index, dimension] of dimensions.entries()) {
      const edge = edges[index]!, start = project(edge(-.5)), end = project(edge(.5)), middle = project(edge(0));
      const length = Math.hypot(end[0] - start[0], end[1] - start[1]) || 1, along = [(end[0] - start[0]) / length, (end[1] - start[1]) / length];
      let out = index === 2 ? [Math.sign(middle[0] - center[0]) || 1, 0] : [middle[0] - center[0], middle[1] - center[1]];
      const size = Math.hypot(out[0]!, out[1]!) || 1; out = [out[0]! / size, out[1]! / size];
      const anchor = Math.abs(out[0]!) < .35 ? "middle" : out[0]! > 0 ? "start" : "end";
      const kept = thinTicks(ticks[index]!.map((tick) => { const p = project(edge(tick.unit)); return { ...tick, position: (p[0] - start[0]) * along[0]! + (p[1] - start[1]) * along[1]!, extent: Math.abs(along[0]!) * labelWidth(tick.label) + Math.abs(along[1]!) * PLOT_TEXT_SIZE }; }), 6);
      for (const { unit, label } of kept) {
        const [x, y] = project(edge(unit));
        view.plot.append(svg("line", { x1: x, y1: y, x2: x + out[0]! * 5, y2: y + out[1]! * 5, class: "mplot-axis-frame" }));
        view.plot.append(plotText({ x: x + out[0]! * 10, y: y + out[1]! * 12 + PLOT_TEXT_SIZE * .34, "text-anchor": anchor, "font-size": PLOT_TEXT_SIZE }, label, "mplot-tick"));
      }
      const axisLabel = view.axis[`${dimension}label`];
      const reach = 30 + Math.abs(out[0]!) * Math.max(0, ...kept.map(({ label }) => labelWidth(label)));
      if (axisLabel) view.plot.append(plotText({ x: middle[0] + out[0]! * reach, y: middle[1] + out[1]! * reach + PLOT_TEXT_SIZE * .34, "text-anchor": anchor, "font-size": PLOT_TEXT_SIZE }, axisLabel, "mplot-label"));
    }
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
    for (const axisId of figure?.axisIds ?? []) { const view = this.views.get(axisId); if (!view?.mounted) continue; const position = this.axisPosition(view.axis, figure?.plotAxisIds.indexOf(axisId) ?? 0, figure?.plotAxisIds.length ?? 1), group = svg("g", { transform: `translate(${position[0] * width} ${(1 - position[1] - position[3]) * height}) scale(${position[2] * width / view.width} ${position[3] * height / view.height})` }); group.append(...Array.from(view.svg.childNodes).map((node) => node.cloneNode(true))); root.append(group); }
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

  private figureAxisIds(figure: Figure): string[] { return (figure.axes ?? this.model.document.axes.filter((axis) => !axis.figure_id || axis.figure_id === figure.id)).map((axis) => typeof axis === "string" ? axis : axis.id); }
  private applyTheme(): void { const values: Record<string, string> = { "--mplot-bg": this.theme.background, "--mplot-panel": this.theme.panel, "--mplot-fg": this.theme.foreground, "--mplot-muted": this.theme.muted, "--mplot-grid": this.theme.grid, "--mplot-accent": this.theme.accent, "font-family": this.theme.fontFamily }; for (const [key, value] of Object.entries(values)) this.element.style.setProperty(key, value); }
}

function pointSegmentDistance(
  x: number,
  y: number,
  start: [number, number],
  end: [number, number],
): number {
  const dx = end[0] - start[0], dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy;
  const projection = lengthSquared === 0
    ? 0
    : Math.max(0, Math.min(1, ((x - start[0]) * dx + (y - start[1]) * dy) / lengthSquared));
  return Math.hypot(x - (start[0] + projection * dx), y - (start[1] + projection * dy));
}

const safeId = (value: string): string => value.replace(/[^a-zA-Z0-9_-]/g, "-");
const serializeSvg = (element: SVGSVGElement): string => new XMLSerializer().serializeToString(element);
const emptySvg = (): string => `<svg xmlns="${SVG_NS}"/>`;
function inferredPosition(index: number, count: number): [number, number, number, number] { const columns = Math.ceil(Math.sqrt(count)), rows = Math.ceil(count / columns), gap = .04, width = (1 - gap * (columns + 1)) / columns, height = (1 - gap * (rows + 1)) / rows, column = index % columns, row = Math.floor(index / columns); return [gap + column * (width + gap), gap + (rows - row - 1) * (height + gap), width, height]; }
type Point3 = [number, number, number];
const BOX_CORNERS: Point3[] = [-.5, .5].flatMap((x) => [-.5, .5].flatMap((y) => [-.5, .5].map((z) => [x, y, z] as Point3)));
const TICK_GAP = 8, TICK_ROTATION = 30;
type Camera = { elev: number; azim: number; roll: number };
function unitScreen(camera: Camera, [x, y, z]: Point3): [number, number] {
  const azimuth = camera.azim * Math.PI / 180, elevation = camera.elev * Math.PI / 180, roll = camera.roll * Math.PI / 180;
  const horizontal = -Math.sin(azimuth) * x + Math.cos(azimuth) * y;
  const depth = Math.cos(azimuth) * x + Math.sin(azimuth) * y;
  const vertical = Math.cos(elevation) * z - Math.sin(elevation) * depth;
  return [Math.cos(roll) * horizontal - Math.sin(roll) * vertical, Math.sin(roll) * horizontal + Math.cos(roll) * vertical];
}
/** Distance toward the camera; larger values are nearer. */
function unitDepth(camera: Camera, [x, y, z]: Point3): number {
  const azimuth = camera.azim * Math.PI / 180, elevation = camera.elev * Math.PI / 180;
  return Math.cos(elevation) * (Math.cos(azimuth) * x + Math.sin(azimuth) * y) + Math.sin(elevation) * z;
}
/** Approximate rendered width of a tick label, including simple TeX such as `$10^{3}$`. */
export function labelWidth(label: string): number {
  let scripts = 0;
  const text = label.replace(/\\math(default|rm|it|bf)/g, "").replaceAll("$", "")
    .replace(/\\frac\{([^}]*)\}\{([^}]*)\}/g, (_, top: string, bottom: string) => { scripts += Math.max(top.length, bottom.length); return ""; })
    .replace(/[\^_](\{[^}]*\}|.)/g, (match) => { scripts += match.slice(1).replace(/[{}]/g, "").length; return ""; })
    .replace(/\\[a-zA-Z]+/g, "m").replace(/[{}]/g, "");
  return (text.length + scripts * .7) * PLOT_TEXT_SIZE * .55;
}
/**
 * Keeps every n-th tick for the smallest n whose labels do not collide, aligned so that
 * zero stays when present. `position` and `extent` are in pixels along the axis. For evenly
 * spaced values a slightly larger stride is preferred when it gives a round step
 * (1, 2, 2.5 or 5 × 10ⁿ) and still keeps at least three labels.
 */
export function thinTicks<T extends { tick: number; position: number; extent: number }>(ticks: T[], gap: number): T[] {
  const sorted = [...ticks].sort((a, b) => a.position - b.position), zero = sorted.findIndex(({ tick }) => tick === 0);
  const pick = (stride: number) => { const anchor = zero >= 0 ? zero % stride : 0; return sorted.filter((_, index) => index % stride === anchor); };
  const fits = (kept: T[]) => kept.every((item, index) => index === 0 || Math.abs(item.position - kept[index - 1]!.position) >= (item.extent + kept[index - 1]!.extent) / 2 + gap);
  let minimum = sorted.length;
  for (let stride = 1; stride < sorted.length; stride++) if (fits(pick(stride))) { minimum = stride; break; }
  const step = sorted.length > 2 ? Math.abs(sorted[1]!.tick - sorted[0]!.tick) : 0;
  const even = step > 0 && sorted.every((item, index) => index === 0 || Math.abs(Math.abs(item.tick - sorted[index - 1]!.tick) - step) <= step * 1e-6);
  const round = (value: number) => { const mantissa = value / 10 ** Math.floor(Math.log10(value) + 1e-9); return [1, 2, 2.5, 5, 10].some((nice) => Math.abs(mantissa - nice) < 1e-6); };
  if (minimum > 1 && even && !round(step * minimum)) {
    for (let stride = minimum + 1; stride < sorted.length; stride++) {
      const kept = pick(stride);
      if (kept.length < 3) break;
      if (round(step * stride) && fits(kept)) return kept;
    }
  }
  return minimum < sorted.length ? pick(minimum) : sorted.slice(0, 1);
}
function margins3d(width: number, height: number): Margins { return width < 300 || height < 210 ? { left: 34, right: 34, top: 34, bottom: 22 } : { left: 48, right: 48, top: 40, bottom: 28 }; }
function compactMargins(width: number, height: number): Margins { const compact = width < 300 || height < 210; return compact ? { left: 62, right: 14, top: 34, bottom: 56 } : { left: 78, right: 20, top: 40, bottom: 74 }; }
function insetMargins(axis: Axis, width: number, height: number): Margins {
  const x = axis.props?.xaxis as { ticks?: number[]; provided?: boolean } | undefined, y = axis.props?.yaxis as { ticks?: number[]; provided?: boolean } | undefined;
  const noX = x?.provided && x.ticks?.length === 0 && !axis.xlabel, noY = y?.provided && y.ticks?.length === 0 && !axis.ylabel;
  return { left: noY ? 5 : Math.min(30, width * .2), right: 5, top: axis.title ? 20 : 5, bottom: noX ? 5 : Math.min(26, height * .25) };
}
