import { plotText } from "./math.js";
import { ViewerModel } from "./model.js";
import { builtinRenderers, PLOT_TEXT_SIZE } from "./renderers.js";
import { createScale, formatTick } from "./scales.js";
import { resolveTheme } from "./theme.js";
import { cssColor, pairs, SVG_NS, svg } from "./svg.js";
export class MPlotViewer extends EventTarget {
    element;
    model;
    options;
    theme;
    renderers = new Map();
    views = new Map();
    figures = new Map();
    resolvedData = new Map();
    mode = "pan";
    exportScope = "figure";
    activeAxisId;
    activeFigureIdValue;
    source;
    resize;
    intersection;
    documentToken = 0;
    axisTokens = new Map();
    axisRenders = new Map();
    dirtyAxes = new Set();
    cameras = new Map();
    contrastLimits = new Map();
    metadataPageId = "__metadata__";
    constructor(target, document, options = {}) {
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
            const detail = event.detail;
            for (const axisId of detail.affected ?? [detail.axisId])
                void this.renderAxis(axisId);
        });
        this.model.addEventListener("change", () => { void this.render(); });
        if (typeof ResizeObserver !== "undefined") {
            this.resize = new ResizeObserver((entries) => {
                for (const entry of entries) {
                    const axisId = entry.target.dataset.axesId;
                    const view = axisId ? this.views.get(axisId) : undefined;
                    const width = Math.max(180, entry.contentRect.width), height = Math.max(150, entry.contentRect.height);
                    if (view?.mounted && view.figureId === this.activeFigureIdValue && entry.contentRect.width > 0 && entry.contentRect.height > 0 && (Math.abs(width - view.width) > 1 || Math.abs(height - view.height) > 1))
                        void this.renderAxis(axisId);
                }
            });
        }
        if (typeof IntersectionObserver !== "undefined") {
            this.intersection = new IntersectionObserver((entries) => {
                for (const entry of entries)
                    if (entry.isIntersecting) {
                        const axisId = entry.target.dataset.axesId;
                        if (axisId)
                            void this.mountAxis(axisId);
                    }
            }, { rootMargin: "600px 0px" });
        }
        if (options.liveUrl)
            this.connectLive(options.liveUrl);
        void this.render();
    }
    update(document) { this.model.setDocument(document); }
    setTheme(theme) {
        this.options.theme = theme;
        this.theme = resolveTheme(theme);
        this.applyTheme();
        void this.renderMounted();
    }
    reset(axisId) {
        const resetView = (view) => { for (const artist of this.model.document.artists.filter((candidate) => candidate.axes_id === view.axis.id))
            this.contrastLimits.delete(artist.id); if (view.axis.projection === "3d") {
            this.cameras.delete(view.axis.id);
            void this.renderAxis(view.axis.id);
        }
        else
            void this.refitAxis(view.axis.id); };
        if (axisId) {
            const view = this.views.get(axisId);
            if (view)
                resetView(view);
            return;
        }
        for (const view of this.views.values())
            if (view.mounted)
                resetView(view);
    }
    destroy() {
        this.source?.close();
        this.resize?.disconnect();
        this.intersection?.disconnect();
        this.element.replaceChildren();
        this.element.classList.remove("mplot-viewer");
    }
    async render() {
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
        if (this.options.toolbar !== false)
            header.append(this.createToolbar());
        if (this.activeFigureIdValue !== this.metadataPageId && !this.model.document.figures.some((figure) => figure.id === this.activeFigureIdValue))
            this.activeFigureIdValue = this.model.document.figures[0]?.id;
        header.append(this.createNavigator());
        const figuresElement = document.createElement("main");
        figuresElement.className = "mplot-figures";
        shell.append(header, figuresElement);
        this.element.append(shell);
        const immediateMounts = [];
        const metadataPage = this.createMetadataPage();
        metadataPage.hidden = this.activeFigureIdValue !== this.metadataPageId;
        for (const [figureIndex, figure] of this.model.document.figures.entries()) {
            const figureView = this.createFigure(figure, figureIndex);
            this.figures.set(figure.id, figureView);
            figureView.element.hidden = figure.id !== this.activeFigureIdValue;
            figuresElement.append(figureView.element);
            for (const [axisIndex, axisId] of figureView.axisIds.entries()) {
                const axis = this.model.document.axes.find((item) => item.id === axisId);
                if (!axis)
                    continue;
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
                if (this.intersection)
                    this.intersection.observe(view.host);
                else
                    immediateMounts.push(this.mountAxis(axis.id));
            }
        }
        figuresElement.append(metadataPage);
        if (token !== this.documentToken)
            return;
        await Promise.all(immediateMounts);
        if (this.activeFigureIdValue)
            await this.mountFigure(this.activeFigureIdValue);
    }
    createFigure(figure, index) {
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
    createColorbar(axis) {
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
                const tick = document.createElement("span");
                tick.className = "mplot-colorbar-tick";
                const fraction = (value - limits[0]) / (limits[1] - limits[0] || 1);
                tick.style.setProperty("--mplot-colorbar-position", `${Math.max(0, Math.min(1, fraction)) * 100}%`);
                const displayValue = Math.abs(value) < Math.abs(limits[1] - limits[0]) * 1e-12 ? 0 : Number(value.toPrecision(4));
                tick.textContent = overridden ? formatTick(displayValue, "linear") : originalLabels[index] ?? formatTick(value, "linear");
                ticks.append(tick);
            });
            if (overridden)
                colorbar.dataset.contrastLimits = limits.join(",");
            else
                delete colorbar.dataset.contrastLimits;
        };
        if (mappable) {
            colorbar.dataset.mappableId = mappable;
            colorbar.tabIndex = 0;
            colorbar.title = "With Zoom active, drag across the colorbar to select contrast limits; double-click to reset";
            let start, brush;
            const fraction = (event) => {
                const bounds = gradient.getBoundingClientRect();
                return axis.colorbar?.orientation === "horizontal" ? Math.max(0, Math.min(1, (event.clientX - bounds.left) / (bounds.width || 1))) : Math.max(0, Math.min(1, (bounds.bottom - event.clientY) / (bounds.height || 1)));
            };
            const moveBrush = (from, to) => {
                if (!brush) {
                    brush = document.createElement("div");
                    brush.className = "mplot-colorbar-brush";
                    gradient.append(brush);
                }
                const low = Math.min(from, to), size = Math.abs(to - from);
                if (axis.colorbar?.orientation === "horizontal") {
                    brush.style.left = `${low * 100}%`;
                    brush.style.width = `${size * 100}%`;
                }
                else {
                    brush.style.bottom = `${low * 100}%`;
                    brush.style.height = `${size * 100}%`;
                }
            };
            gradient.addEventListener("pointerdown", (event) => {
                if (this.mode !== "zoom")
                    return;
                event.preventDefault();
                start = fraction(event);
                moveBrush(start, start);
                gradient.setPointerCapture(event.pointerId);
            });
            gradient.addEventListener("pointermove", (event) => { if (start !== undefined)
                moveBrush(start, fraction(event)); });
            const finish = (event, cancel = false) => {
                if (start === undefined)
                    return;
                const end = fraction(event), from = start;
                start = undefined;
                brush?.remove();
                brush = undefined;
                if (cancel || Math.abs(end - from) < .01)
                    return;
                const current = this.contrastLimits.get(mappable) ?? originalLimits;
                const selected = [current[0] + Math.min(from, end) * (current[1] - current[0]), current[0] + Math.max(from, end) * (current[1] - current[0])];
                this.contrastLimits.set(mappable, selected);
                redraw();
                const artist = this.model.document.artists.find((candidate) => candidate.id === mappable);
                if (artist)
                    void this.renderAxis(artist.axes_id);
            };
            gradient.addEventListener("pointerup", (event) => finish(event));
            gradient.addEventListener("pointercancel", (event) => finish(event, true));
            colorbar.addEventListener("dblclick", () => {
                this.contrastLimits.delete(mappable);
                redraw();
                const artist = this.model.document.artists.find((candidate) => candidate.id === mappable);
                if (artist)
                    void this.renderAxis(artist.axes_id);
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
    createAxis(axis, figureId) {
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
        if (axis.role === "inset")
            readout.hidden = true;
        const viewport = this.model.viewports.get(axis.id) ?? { x: [0, 1], y: [0, 1] };
        return { axis, figureId, host, svg: chart, plot, overlay, readout, width: 640, height: 360, margin: { left: 64, right: 18, top: 28, bottom: 58 }, x: createScale(axis.xscale, viewport.x, [64, 622]), y: createScale(axis.yscale, viewport.y, [302, 28]), mounted: false };
    }
    axisPosition(axis, index, count) {
        const position = axis.position ?? inferredPosition(index, count);
        if (axis.role !== "inset" || !axis.parent_axes_id)
            return position;
        const parent = this.model.document.axes.find((candidate) => candidate.id === axis.parent_axes_id)?.position;
        if (!parent)
            return position;
        const width = Math.min(position[2], parent[2]), height = Math.min(position[3], parent[3]);
        const left = Math.max(parent[0], Math.min(position[0], parent[0] + parent[2] - width));
        const bottom = Math.max(parent[1], Math.min(position[1], parent[1] + parent[3] - height));
        return [left, bottom, width, height];
    }
    positionAxis(host, axis, index, count) {
        const position = this.axisPosition(axis, index, count);
        host.style.left = `${position[0] * 100}%`;
        host.style.top = `${(1 - position[1] - position[3]) * 100}%`;
        host.style.width = `${position[2] * 100}%`;
        host.style.height = `${position[3] * 100}%`;
    }
    async mountAxis(axisId, force = false) {
        const view = this.views.get(axisId);
        if (!view || view.mounted || (!force && view.figureId !== this.activeFigureIdValue))
            return;
        view.mounted = true;
        view.host.classList.remove("mplot-axis--pending");
        view.host.replaceChildren(view.svg, view.readout);
        if (this.options.interactive !== false)
            this.bindInteractions(view);
        if (!view.axis.xlim || !view.axis.ylim)
            await this.model.fitViewport(axisId);
        if (!this.activeAxisId) {
            this.activeAxisId = axisId;
            this.markActiveAxis();
        }
        await this.renderAxis(axisId);
    }
    async refitAxis(axisId) {
        await this.model.fitViewport(axisId);
        await this.renderAxis(axisId);
        for (const colorbar of this.element.querySelectorAll(`.mplot-colorbar[data-mappable-id]`)) {
            const mappable = colorbar.dataset.mappableId;
            if (mappable && this.model.document.artists.find((artist) => artist.id === mappable)?.axes_id === axisId)
                this.refreshColorbar(colorbar);
        }
    }
    refreshColorbar(colorbar) {
        const mappable = colorbar.dataset.mappableId;
        const axisId = colorbar.dataset.axesId;
        const axis = this.model.document.axes.find((candidate) => candidate.id === axisId);
        if (!mappable || !axis)
            return;
        const replacement = this.createColorbar(axis);
        replacement.style.cssText = colorbar.style.cssText;
        colorbar.replaceWith(replacement);
    }
    createNavigator() {
        const navigation = document.createElement("nav");
        navigation.className = "mplot-navigator";
        navigation.setAttribute("aria-label", "Figures");
        const label = document.createElement("div");
        label.className = "mplot-navigator-label";
        label.textContent = "Figures";
        const previous = document.createElement("button");
        previous.type = "button";
        previous.className = "mplot-page-step";
        previous.textContent = "← Previous";
        previous.setAttribute("aria-label", "Previous figure");
        const pages = document.createElement("div");
        pages.className = "mplot-page-list";
        const pageEntries = [
            ...this.model.document.figures.map((figure, index) => ({ id: figure.id, number: String(index + 1).padStart(2, "0"), name: figure.title ?? `Figure ${index + 1}` })),
            { id: this.metadataPageId, number: "—", name: "Metadata" },
        ];
        pageEntries.forEach((page) => {
            const button = document.createElement("button");
            const number = document.createElement("span"), name = document.createElement("span");
            number.className = "mplot-page-number";
            number.textContent = page.number;
            name.className = "mplot-page-name";
            name.textContent = page.name;
            button.type = "button";
            button.className = "mplot-page-button";
            button.dataset.pageId = page.id;
            if (page.id !== this.metadataPageId)
                button.dataset.figureId = page.id;
            button.append(number, name);
            button.title = page.name;
            button.setAttribute("aria-label", `Show ${page.name}`);
            button.onclick = () => void this.showPage(page.id);
            pages.append(button);
        });
        const next = document.createElement("button");
        next.type = "button";
        next.className = "mplot-page-step";
        next.textContent = "Next →";
        next.setAttribute("aria-label", "Next figure");
        previous.onclick = () => void this.stepFigure(-1);
        next.onclick = () => void this.stepFigure(1);
        const steps = document.createElement("div");
        steps.className = "mplot-page-steps";
        steps.append(previous, next);
        navigation.append(label, pages, steps);
        queueMicrotask(() => this.updateNavigator());
        return navigation;
    }
    async showPage(pageId) {
        if (pageId !== this.metadataPageId && !this.figures.has(pageId))
            return;
        this.activeFigureIdValue = pageId;
        for (const [id, figure] of this.figures)
            figure.element.hidden = id !== pageId;
        const metadata = this.element.querySelector(".mplot-metadata-page");
        if (metadata)
            metadata.hidden = pageId !== this.metadataPageId;
        if (pageId !== this.metadataPageId) {
            const firstAxis = this.figures.get(pageId)?.axisIds[0];
            if (firstAxis) {
                this.activeAxisId = firstAxis;
                this.markActiveAxis();
            }
        }
        this.updateNavigator();
        if (pageId !== this.metadataPageId)
            await this.mountFigure(pageId);
    }
    async showFigure(figureId) { await this.showPage(figureId); }
    stepFigure(offset) {
        const pages = [...this.model.document.figures.map((figure) => figure.id), this.metadataPageId];
        const current = Math.max(0, pages.indexOf(this.activeFigureIdValue ?? ""));
        const next = pages[current + offset];
        if (next)
            void this.showPage(next);
    }
    updateNavigator() {
        const pages = [...this.model.document.figures.map((figure) => figure.id), this.metadataPageId], index = pages.indexOf(this.activeFigureIdValue ?? "");
        this.element.querySelectorAll(".mplot-page-list [data-page-id]").forEach((button) => button.setAttribute("aria-current", button.dataset.pageId === this.activeFigureIdValue ? "page" : "false"));
        const previous = this.element.querySelector('[aria-label="Previous figure"]'), next = this.element.querySelector('[aria-label="Next figure"]');
        if (previous)
            previous.disabled = index <= 0;
        if (next)
            next.disabled = index < 0 || index >= pages.length - 1;
    }
    createMetadataPage() {
        const page = document.createElement("section");
        page.className = "mplot-metadata-page";
        const heading = document.createElement("header"), title = document.createElement("h2"), subtitle = document.createElement("span");
        heading.className = "mplot-figure-header";
        title.className = "mplot-figure-title";
        title.textContent = "Artifact metadata";
        subtitle.className = "mplot-figure-count";
        subtitle.textContent = "provenance and document";
        heading.append(title, subtitle);
        const body = document.createElement("div");
        body.className = "mplot-metadata-body";
        body.append(this.metadataTree(this.model.document.metadata ?? {}, "Metadata"));
        page.append(heading, body);
        return page;
    }
    metadataTree(value, label) {
        const section = document.createElement("section"), heading = document.createElement(label === "Metadata" ? "h3" : "h4");
        section.className = "mplot-metadata-section";
        heading.textContent = label;
        section.append(heading);
        if (!value || typeof value !== "object") {
            const output = document.createElement("p");
            output.textContent = value === null ? "null" : String(value);
            section.append(output);
            return section;
        }
        const list = document.createElement("dl"), nested = [];
        for (const [key, item] of Object.entries(value)) {
            if (item && typeof item === "object") {
                if (!Object.keys(item).length)
                    continue;
                nested.push(this.metadataTree(item, key));
                continue;
            }
            const term = document.createElement("dt"), definition = document.createElement("dd");
            term.textContent = key;
            definition.textContent = item === null ? "null" : String(item);
            list.append(term, definition);
        }
        if (list.childElementCount)
            section.append(list);
        section.append(...nested);
        return section;
    }
    createToolbar() {
        const toolbar = document.createElement("nav");
        toolbar.className = "mplot-toolbar";
        toolbar.setAttribute("aria-label", "Plot tools");
        const actions = [["Pan", "pan", () => this.setMode("pan")], ["Zoom", "zoom", () => this.setMode("zoom")], ["Reset", "reset", () => this.reset()]];
        for (const [label, name, action] of actions) {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "mplot-button";
            button.textContent = label;
            button.dataset.action = name;
            button.title = label;
            button.onclick = action;
            if (["pan", "zoom"].includes(name))
                button.setAttribute("aria-pressed", String(this.mode === name));
            toolbar.append(button);
        }
        const select = document.createElement("select");
        select.className = "mplot-export-scope";
        select.setAttribute("aria-label", "Export scope");
        for (const [value, label] of [["axis", "Current plot"], ["figure", "Current figure"], ["artifact", "Entire artifact"], ["figures", "Each figure"]]) {
            const option = document.createElement("option");
            option.value = value;
            option.textContent = label;
            option.selected = value === this.exportScope;
            select.append(option);
        }
        select.onchange = () => { this.exportScope = select.value; };
        toolbar.append(select);
        for (const format of ["SVG", "PNG"]) {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "mplot-button";
            button.textContent = format;
            button.onclick = () => void this.downloadExport(format.toLowerCase());
            toolbar.append(button);
        }
        return toolbar;
    }
    setMode(mode) {
        this.mode = mode;
        this.element.querySelectorAll("[data-action]").forEach((button) => {
            if (["pan", "zoom"].includes(button.dataset.action ?? ""))
                button.setAttribute("aria-pressed", String(button.dataset.action === mode));
        });
    }
    async renderMounted() { await Promise.all(Array.from(this.views.values()).filter((view) => view.mounted).map((view) => this.renderAxis(view.axis.id))); }
    async renderAxis(axisId) {
        const pending = this.axisRenders.get(axisId);
        if (pending) {
            this.dirtyAxes.add(axisId);
            return pending;
        }
        const operation = (async () => {
            try {
                this.dirtyAxes.delete(axisId);
                await this.renderAxisNow(axisId);
                this.dirtyAxes.delete(axisId);
            }
            finally {
                this.axisRenders.delete(axisId);
            }
        })();
        this.axisRenders.set(axisId, operation);
        return operation;
    }
    async renderAxisNow(axisId) {
        const view = this.views.get(axisId);
        if (!view?.mounted || view.figureId !== this.activeFigureIdValue)
            return;
        const token = (this.axisTokens.get(axisId) ?? 0) + 1, documentToken = this.documentToken;
        this.axisTokens.set(axisId, token);
        view.width = Math.max(180, view.host.clientWidth || 640);
        view.height = Math.max(150, view.host.clientHeight || 360);
        view.margin = view.axis.role === "inset" ? insetMargins(view.axis, view.width, view.height) : compactMargins(view.width, view.height);
        const viewport = this.model.viewports.get(axisId) ?? this.model.defaultViewport(view.axis);
        const right = view.width - view.margin.right, bottom = view.height - view.margin.bottom;
        view.x = createScale(view.axis.xscale, viewport.x, [view.margin.left, right]);
        view.y = createScale(view.axis.yscale, viewport.y, [bottom, view.margin.top]);
        const plot = svg("g"), overlay = svg("g"), working = { ...view, plot, overlay };
        this.drawAxes(working);
        const clipId = `mplot-clip-${safeId(view.axis.id)}`, defs = svg("defs"), clip = svg("clipPath", { id: clipId });
        clip.append(svg("rect", { x: view.margin.left, y: view.margin.top, width: right - view.margin.left, height: bottom - view.margin.top }));
        defs.append(clip);
        plot.prepend(defs);
        const artists = this.model.document.artists.filter((artist) => artist.axes_id === axisId && artist.props.visible !== false);
        for (const artist of artists) {
            const group = svg("g", { "data-artist-id": artist.id, "clip-path": `url(#${clipId})` });
            plot.append(group);
            const renderer = this.renderers.get(artist.type);
            if (!renderer) {
                this.drawUnknown(group, artist, working);
                continue;
            }
            try {
                const data = this.resolvedData.get(artist.id) ?? await this.model.resolveData(artist.data, artist);
                if (documentToken !== this.documentToken || this.views.get(axisId) !== view || view.figureId !== this.activeFigureIdValue)
                    return;
                this.resolvedData.set(artist.id, data);
                const contrast = this.contrastLimits.get(artist.id);
                const effectiveArtist = contrast ? { ...artist, props: { ...artist.props, clim: contrast } } : artist;
                await renderer({ ...working, group, artist: effectiveArtist, data, theme: this.theme, pointBudget: Math.max(500, Math.round(view.width * 4)), project3d: (x, y, z) => this.project3d(view, x, y, z) });
            }
            catch (error) {
                this.drawUnknown(group, artist, working, error instanceof Error ? error.message : "render failed");
            }
        }
        if (documentToken !== this.documentToken || this.views.get(axisId) !== view || view.figureId !== this.activeFigureIdValue || this.axisTokens.get(axisId) !== token)
            return;
        this.drawHitArea(working);
        view.svg.setAttribute("viewBox", `0 0 ${view.width} ${view.height}`);
        view.plot.replaceChildren(...plot.childNodes);
        view.overlay.replaceChildren(...overlay.childNodes);
    }
    drawAxes(view) {
        const { left, top, bottom, right } = view.margin, b = view.height - bottom, r = view.width - right;
        const tickCount = Math.max(3, Math.floor((r - left) / 110));
        for (const [tick, label] of this.axisTicks(view, "x", tickCount)) {
            const px = view.x(tick);
            view.plot.append(svg("line", { x1: px, x2: px, y1: top, y2: b, class: "mplot-grid-line" }));
            view.plot.append(plotText({ x: px, y: b + PLOT_TEXT_SIZE + 5, "text-anchor": "middle", "font-size": PLOT_TEXT_SIZE }, label, "mplot-tick"));
        }
        for (const [tick, label] of this.axisTicks(view, "y", Math.max(3, Math.floor((b - top) / 80)))) {
            const py = view.y(tick);
            view.plot.append(svg("line", { x1: left, x2: r, y1: py, y2: py, class: "mplot-grid-line" }));
            view.plot.append(plotText({ x: left - 9, y: py + PLOT_TEXT_SIZE * .34, "text-anchor": "end", "font-size": PLOT_TEXT_SIZE }, label, "mplot-tick"));
        }
        view.plot.append(svg("path", { d: `M${left},${top}H${r}V${b}H${left}Z`, fill: "none", class: "mplot-axis-frame" }));
        if (view.axis.title)
            view.plot.append(plotText({ x: (left + r) / 2, y: Math.max(PLOT_TEXT_SIZE, top - 16), "text-anchor": "middle", "font-size": PLOT_TEXT_SIZE }, view.axis.title, "mplot-axis-title"));
        if (view.axis.xlabel && view.height > 180)
            view.plot.append(plotText({ x: (left + r) / 2, y: b + 46, "text-anchor": "middle", "font-size": PLOT_TEXT_SIZE }, view.axis.xlabel, "mplot-label"));
        if (view.axis.ylabel && view.width > 230)
            view.plot.append(plotText({ x: 18, y: (top + b) / 2, "text-anchor": "middle", "font-size": PLOT_TEXT_SIZE, transform: `rotate(-90 18 ${(top + b) / 2})` }, view.axis.ylabel, "mplot-label"));
    }
    axisTicks(view, dimension, count) {
        const metadata = view.axis.props?.[`${dimension}axis`];
        const scaleType = dimension === "x" ? view.axis.xscale : view.axis.yscale;
        const scale = dimension === "x" ? view.x : view.y;
        if (metadata?.provided && metadata.ticks?.length === 0)
            return [];
        if (metadata?.ticks?.length && metadata.ticklabels?.some((label) => label)) {
            const viewport = this.model.viewports.get(view.axis.id), domain = dimension === "x" ? viewport?.x : viewport?.y;
            const lower = Math.min(...domain ?? [-Infinity, Infinity]), upper = Math.max(...domain ?? [-Infinity, Infinity]);
            return metadata.ticks.map((tick, index) => [tick, metadata.ticklabels?.[index] || formatTick(tick, scaleType, metadata.date_format)]).filter(([tick]) => tick >= lower && tick <= upper);
        }
        const ticks = scale.ticks(count);
        const visibleTicks = scaleType === "symlog" && ticks.length > count && ticks.includes(0) ? [ticks[0], 0, ticks.at(-1)] : ticks;
        return visibleTicks.map((tick) => [tick, formatTick(tick, scaleType)]);
    }
    dateFormat(view, dimension) { return view.axis.props?.[`${dimension}axis`]?.date_format; }
    drawUnknown(group, artist, view, reason = "Renderer not installed") { const box = svg("g", { class: "mplot-unknown" }); box.append(svg("rect", { x: view.margin.left + 8, y: view.margin.top + 8, width: Math.min(220, view.width - view.margin.left - 20), height: 40, rx: 2 })); const text = svg("text", { x: view.margin.left + 16, y: view.margin.top + 25 }); text.textContent = `Unknown: ${artist.type}`; const detail = svg("text", { x: view.margin.left + 16, y: view.margin.top + 40 }); detail.textContent = reason; box.append(text, detail); group.append(box); }
    drawHitArea(view) { const { left, top, bottom, right } = view.margin; view.overlay.append(svg("rect", { x: left, y: top, width: view.width - right - left, height: view.height - bottom - top, class: "mplot-hit" })); }
    bindInteractions(view) {
        if (view.axis.projection === "3d") {
            this.bind3dInteractions(view);
            return;
        }
        let start;
        let brush;
        const finish = (event, cancel = false) => { if (!start)
            return; const pointer = this.pointer(view, event), p = this.boundToPlot(view, pointer.x, pointer.y); if (!cancel && this.mode === "zoom" && Math.hypot(p.x - start.x, p.y - start.y) > 4)
            this.model.setViewport(view.axis.id, { ...start.viewport, x: [view.x.invert(Math.min(start.x, p.x)), view.x.invert(Math.max(start.x, p.x))], y: [view.y.invert(Math.max(start.y, p.y)), view.y.invert(Math.min(start.y, p.y))] }); start = undefined; brush?.remove(); brush = undefined; };
        view.svg.addEventListener("pointerdown", (event) => { this.activeAxisId = view.axis.id; this.markActiveAxis(); const p = this.pointer(view, event); if (!this.inPlot(view, p.x, p.y))
            return; start = { ...p, viewport: structuredClone(this.model.viewports.get(view.axis.id)), xScale: view.x, yScale: view.y }; view.svg.setPointerCapture(event.pointerId); if (this.mode === "zoom") {
            brush = svg("rect", { x: p.x, y: p.y, width: 0, height: 0, class: "mplot-brush mplot-brush--zoom" });
            view.overlay.append(brush);
        } });
        view.svg.addEventListener("pointermove", (event) => { const p = this.pointer(view, event); this.updateCoordinates(view, p.x, p.y); if (!start) {
            this.showTooltip(view, p.x, p.y);
            return;
        } if (this.mode === "pan") {
            const next = structuredClone(start.viewport), dx = start.x - p.x, dy = start.y - p.y, bounds = this.plotBounds(view);
            next.x = [start.xScale.invert(bounds.left + dx), start.xScale.invert(bounds.right + dx)];
            next.y = [start.yScale.invert(bounds.bottom + dy), start.yScale.invert(bounds.top + dy)];
            this.model.setViewport(view.axis.id, next);
        }
        else if (brush) {
            const bounded = this.boundToPlot(view, p.x, p.y);
            brush.setAttribute("x", String(Math.min(start.x, bounded.x)));
            brush.setAttribute("y", String(Math.min(start.y, bounded.y)));
            brush.setAttribute("width", String(Math.abs(bounded.x - start.x)));
            brush.setAttribute("height", String(Math.abs(bounded.y - start.y)));
        } });
        view.svg.addEventListener("pointerup", (event) => finish(event));
        view.svg.addEventListener("pointercancel", (event) => finish(event, true));
        view.svg.addEventListener("pointerleave", () => { if (!start)
            this.clearHover(view); });
        view.svg.addEventListener("wheel", (event) => { event.preventDefault(); const p = this.pointer(view, event); if (!this.inPlot(view, p.x, p.y))
            return; const factor = Math.exp(event.deltaY * .001), current = this.model.viewports.get(view.axis.id), bounds = this.plotBounds(view); const zoomPixel = (edge, center) => center + (edge - center) * factor; this.model.setViewport(view.axis.id, { ...current, x: [view.x.invert(zoomPixel(bounds.left, p.x)), view.x.invert(zoomPixel(bounds.right, p.x))], y: [view.y.invert(zoomPixel(bounds.bottom, p.y)), view.y.invert(zoomPixel(bounds.top, p.y))] }); }, { passive: false });
        view.svg.addEventListener("dblclick", () => this.reset(view.axis.id));
    }
    bind3dInteractions(view) {
        let start;
        const camera = () => this.camera(view);
        view.svg.classList.add("mplot-3d-view");
        view.svg.addEventListener("pointerdown", (event) => { const p = this.pointer(view, event), current = camera(); start = { ...p, elev: current.elev, azim: current.azim }; view.svg.setPointerCapture(event.pointerId); });
        view.svg.addEventListener("pointermove", (event) => { const p = this.pointer(view, event); this.updateCoordinates(view, p.x, p.y); if (!start)
            return; const current = camera(); current.azim = start.azim + (p.x - start.x) * .45; current.elev = Math.max(-89, Math.min(89, start.elev - (p.y - start.y) * .45)); void this.renderAxis(view.axis.id); });
        const finish = () => { start = undefined; };
        view.svg.addEventListener("pointerup", finish);
        view.svg.addEventListener("pointercancel", finish);
        view.svg.addEventListener("wheel", (event) => { event.preventDefault(); const current = camera(); current.zoom = Math.max(.4, Math.min(3, current.zoom * Math.exp(-event.deltaY * .001))); void this.renderAxis(view.axis.id); }, { passive: false });
        view.svg.addEventListener("dblclick", () => { this.cameras.delete(view.axis.id); void this.renderAxis(view.axis.id); });
    }
    camera(view) {
        let camera = this.cameras.get(view.axis.id);
        if (!camera) {
            const settings = view.axis.props?.view;
            camera = { elev: settings?.elev ?? 30, azim: settings?.azim ?? -60, roll: settings?.roll ?? 0, zoom: 1 };
            this.cameras.set(view.axis.id, camera);
        }
        return camera;
    }
    pointer(view, event) { const rect = view.svg.getBoundingClientRect(); return { x: (event.clientX - rect.left) * view.width / (rect.width || view.width), y: (event.clientY - rect.top) * view.height / (rect.height || view.height) }; }
    plotBounds(view) { return { left: view.margin.left, right: view.width - view.margin.right, top: view.margin.top, bottom: view.height - view.margin.bottom }; }
    inPlot(view, x, y) { const bounds = this.plotBounds(view); return x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom; }
    boundToPlot(view, x, y) { const bounds = this.plotBounds(view); return { x: Math.max(bounds.left, Math.min(bounds.right, x)), y: Math.max(bounds.top, Math.min(bounds.bottom, y)) }; }
    updateCoordinates(view, px, py) { view.readout.textContent = this.inPlot(view, px, py) ? `x = ${formatTick(view.x.invert(px), view.axis.xscale, this.dateFormat(view, "x"))} · y = ${formatTick(view.y.invert(py), view.axis.yscale, this.dateFormat(view, "y"))}` : "x — · y —"; }
    clearHover(view) { view.host.querySelector(".mplot-tooltip")?.remove(); view.readout.textContent = "x — · y —"; }
    showTooltip(view, px, py) { let best; for (const artist of this.model.document.artists.filter((item) => item.axes_id === view.axis.id)) {
        const data = this.resolvedData.get(artist.id) ?? artist.data, values = pairs(data.x, data.y), stride = Math.max(1, Math.floor(values.length / 5000));
        for (let offset = 0; offset < values.length; offset += stride) {
            const [x, y, index] = values[offset], distance = Math.hypot(view.x(x) - px, view.y(y) - py);
            if (distance < 18 && (!best || distance < best.distance))
                best = { artist, index, x, y, distance };
        }
    } let tooltip = view.host.querySelector(".mplot-tooltip"); if (!best) {
        tooltip?.remove();
        return;
    } if (!tooltip) {
        tooltip = document.createElement("div");
        tooltip.className = "mplot-tooltip";
        view.host.append(tooltip);
    } tooltip.style.left = `${px / view.width * 100}%`; tooltip.style.top = `${py / view.height * 100}%`; const rawLabel = best.artist.props.label; const label = typeof rawLabel === "string" && rawLabel && !rawLabel.startsWith("_") ? `${rawLabel} · ` : ""; tooltip.textContent = `${label}x = ${formatTick(best.x, view.axis.xscale, this.dateFormat(view, "x"))} · y = ${formatTick(best.y, view.axis.yscale, this.dateFormat(view, "y"))}`; }
    project3d(view, x, y, z) {
        const viewport = this.model.viewports.get(view.axis.id), zlim = viewport.z ?? [0, 1];
        const normalize = (value, limits) => (value - limits[0]) / (limits[1] - limits[0] || 1) - 0.5;
        const xn = normalize(x, viewport.x), yn = normalize(y, viewport.y), zn = normalize(z, zlim);
        const camera = this.camera(view);
        const azimuth = camera.azim * Math.PI / 180, elevation = camera.elev * Math.PI / 180, roll = camera.roll * Math.PI / 180;
        const horizontal = -Math.sin(azimuth) * xn + Math.cos(azimuth) * yn;
        const depth = Math.cos(azimuth) * xn + Math.sin(azimuth) * yn;
        const vertical = Math.cos(elevation) * zn - Math.sin(elevation) * depth;
        const rolledX = Math.cos(roll) * horizontal - Math.sin(roll) * vertical;
        const rolledY = Math.sin(roll) * horizontal + Math.cos(roll) * vertical;
        const left = view.margin.left, right = view.width - view.margin.right, top = view.margin.top, bottom = view.height - view.margin.bottom;
        const scale = Math.min(right - left, bottom - top) * 0.82 * camera.zoom;
        return [(left + right) / 2 + rolledX * scale, (top + bottom) / 2 - rolledY * scale];
    }
    markActiveAxis() { for (const view of this.views.values())
        view.host.classList.toggle("mplot-axis--active", view.axis.id === this.activeAxisId); }
    exportSVG(scope = "artifact", id) {
        if (scope === "axis") {
            const view = this.views.get(id ?? this.activeAxisId ?? "");
            return view?.mounted ? serializeSvg(view.svg) : emptySvg();
        }
        if (scope === "figure") {
            const figureId = id ?? this.activeFigureId();
            return figureId ? this.composeFigureSVG(figureId) : emptySvg();
        }
        const figureIds = this.model.document.figures.map((figure) => figure.id), documents = figureIds.map((figureId) => this.composeFigureSVGElement(figureId));
        const width = Math.max(1, ...documents.map((item) => item.width)), height = documents.reduce((sum, item) => sum + item.height, 0), root = svg("svg", { xmlns: SVG_NS, width, height, viewBox: `0 0 ${width} ${height}` });
        let y = 0;
        for (const document of documents) {
            const group = svg("g", { transform: `translate(0 ${y})` });
            group.append(...Array.from(document.svg.childNodes).map((node) => node.cloneNode(true)));
            root.append(group);
            y += document.height;
        }
        return serializeSvg(root);
    }
    composeFigureSVG(figureId) { return serializeSvg(this.composeFigureSVGElement(figureId).svg); }
    composeFigureSVGElement(figureId) {
        const figure = this.figures.get(figureId), width = figure?.canvas.clientWidth || 960;
        const [sourceWidth, sourceHeight] = figure?.figure.size ?? [640, 480], height = Math.round(width * sourceHeight / Math.max(1, sourceWidth));
        const root = svg("svg", { xmlns: SVG_NS, width, height, viewBox: `0 0 ${width} ${height}` });
        for (const axisId of figure?.axisIds ?? []) {
            const view = this.views.get(axisId);
            if (!view?.mounted)
                continue;
            const position = this.axisPosition(view.axis, figure?.plotAxisIds.indexOf(axisId) ?? 0, figure?.plotAxisIds.length ?? 1), group = svg("g", { transform: `translate(${position[0] * width} ${(1 - position[1] - position[3]) * height}) scale(${position[2] * width / view.width} ${position[3] * height / view.height})` });
            group.append(...Array.from(view.svg.childNodes).map((node) => node.cloneNode(true)));
            root.append(group);
        }
        return { svg: root, width, height };
    }
    async exportPNG(scale = 2, scope = "artifact", id) { const content = this.exportSVG(scope, id), blob = new Blob([content], { type: "image/svg+xml" }), url = URL.createObjectURL(blob); try {
        const image = new Image();
        await new Promise((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error("Unable to rasterize SVG")); image.src = url; });
        const canvas = document.createElement("canvas");
        canvas.width = image.width * scale;
        canvas.height = image.height * scale;
        const context = canvas.getContext("2d");
        if (!context)
            throw new Error("Canvas unavailable");
        context.scale(scale, scale);
        context.drawImage(image, 0, 0);
        return await new Promise((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("PNG encoding failed")), "image/png"));
    }
    finally {
        URL.revokeObjectURL(url);
    } }
    async downloadExport(format) {
        const scope = this.exportScope;
        if (scope === "figures") {
            for (const [index, figure] of this.model.document.figures.entries()) {
                await this.mountFigure(figure.id, true);
                const filename = `mplot-figure-${index + 1}.${format}`;
                this.download(format === "svg" ? new Blob([this.exportSVG("figure", figure.id)], { type: "image/svg+xml;charset=utf-8" }) : await this.exportPNG(2, "figure", figure.id), filename);
            }
            return;
        }
        if (scope === "figure") {
            const figureId = this.activeFigureId();
            if (figureId)
                await this.mountFigure(figureId);
        }
        else if (scope === "artifact")
            for (const figure of this.model.document.figures)
                await this.mountFigure(figure.id, true);
        else if (this.activeAxisId)
            await this.mountAxis(this.activeAxisId);
        const filename = `mplot-${scope}.${format}`;
        this.download(format === "svg" ? new Blob([this.exportSVG(scope)], { type: "image/svg+xml;charset=utf-8" }) : await this.exportPNG(2, scope), filename);
    }
    async mountFigure(figureId, force = false) { await Promise.all((this.figures.get(figureId)?.axisIds ?? []).map((axisId) => this.mountAxis(axisId, force))); }
    activeFigureId() { return this.activeFigureIdValue ?? (this.activeAxisId ? this.views.get(this.activeAxisId)?.figureId : this.model.document.figures[0]?.id); }
    download(blob, filename) { const link = document.createElement("a"), url = URL.createObjectURL(blob); link.href = url; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 0); }
    connectLive(url) { this.source?.close(); if (typeof EventSource === "undefined")
        return; this.source = new EventSource(url); const update = (event) => { try {
        const payload = JSON.parse(String(event.data));
        this.update("document" in payload ? payload.document : payload);
    }
    catch (error) {
        this.dispatchEvent(new CustomEvent("mplot:error", { detail: error }));
    } }; this.source.addEventListener("document", update); this.source.onmessage = update; this.source.onerror = () => this.dispatchEvent(new Event("mplot:disconnect")); }
    figureAxisIds(figure) { return (figure.axes ?? this.model.document.axes.filter((axis) => !axis.figure_id || axis.figure_id === figure.id)).map((axis) => typeof axis === "string" ? axis : axis.id); }
    applyTheme() { const values = { "--mplot-bg": this.theme.background, "--mplot-panel": this.theme.panel, "--mplot-fg": this.theme.foreground, "--mplot-muted": this.theme.muted, "--mplot-grid": this.theme.grid, "--mplot-accent": this.theme.accent, "font-family": this.theme.fontFamily }; for (const [key, value] of Object.entries(values))
        this.element.style.setProperty(key, value); }
}
const safeId = (value) => value.replace(/[^a-zA-Z0-9_-]/g, "-");
const serializeSvg = (element) => new XMLSerializer().serializeToString(element);
const emptySvg = () => `<svg xmlns="${SVG_NS}"/>`;
function inferredPosition(index, count) { const columns = Math.ceil(Math.sqrt(count)), rows = Math.ceil(count / columns), gap = .04, width = (1 - gap * (columns + 1)) / columns, height = (1 - gap * (rows + 1)) / rows, column = index % columns, row = Math.floor(index / columns); return [gap + column * (width + gap), gap + (rows - row - 1) * (height + gap), width, height]; }
function compactMargins(width, height) { const compact = width < 300 || height < 210; return compact ? { left: 62, right: 14, top: 34, bottom: 56 } : { left: 78, right: 20, top: 40, bottom: 74 }; }
function insetMargins(axis, width, height) {
    const x = axis.props?.xaxis, y = axis.props?.yaxis;
    const noX = x?.provided && x.ticks?.length === 0 && !axis.xlabel, noY = y?.provided && y.ticks?.length === 0 && !axis.ylabel;
    return { left: noY ? 5 : Math.min(30, width * .2), right: 5, top: axis.title ? 20 : 5, bottom: noX ? 5 : Math.min(26, height * .25) };
}
//# sourceMappingURL=viewer.js.map