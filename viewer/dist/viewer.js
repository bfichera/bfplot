import { ViewerModel } from "./model.js";
import { builtinRenderers } from "./renderers.js";
import { createScale, formatTick } from "./scales.js";
import { resolveTheme } from "./theme.js";
import { pairs, SVG_NS, svg } from "./svg.js";
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
    source;
    resize;
    intersection;
    documentToken = 0;
    axisTokens = new Map();
    constructor(target, document, options = {}) {
        super();
        this.element = target;
        this.options = options;
        this.theme = resolveTheme(options.theme);
        this.model = new ViewerModel(document, options.arrayResolver);
        Object.entries(builtinRenderers).forEach(([type, renderer]) => this.renderers.set(type, renderer));
        Object.entries(options.renderers ?? {}).forEach(([type, renderer]) => this.renderers.set(type, renderer));
        this.element.classList.add("mplot-viewer");
        this.element.setAttribute("role", "region");
        this.element.setAttribute("aria-label", document.title ?? "Interactive scientific plot collection");
        this.applyTheme();
        this.model.addEventListener("viewport", (event) => {
            const detail = event.detail;
            for (const axisId of detail.affected ?? [detail.axisId])
                void this.renderAxis(axisId);
        });
        this.model.addEventListener("selection", (event) => {
            const detail = event.detail;
            for (const axisId of new Set(detail.points.map((point) => this.model.document.artists.find((artist) => artist.id === point.artistId)?.axes_id).filter((id) => Boolean(id))))
                void this.renderAxis(axisId);
        });
        this.model.addEventListener("change", () => { void this.render(); });
        if (typeof ResizeObserver !== "undefined") {
            this.resize = new ResizeObserver((entries) => {
                for (const entry of entries) {
                    const axisId = entry.target.dataset.axesId;
                    if (axisId && this.views.get(axisId)?.mounted)
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
    registerRenderer(type, renderer) { this.renderers.set(type, renderer); void this.renderMounted(); return this; }
    unregisterRenderer(type) { const removed = this.renderers.delete(type); if (removed)
        void this.renderMounted(); return removed; }
    update(document) { this.model.setDocument(document); }
    setTheme(theme) {
        this.options.theme = theme;
        this.theme = resolveTheme(theme);
        this.applyTheme();
        void this.renderMounted();
    }
    reset(axisId) {
        if (axisId) {
            void this.refitAxis(axisId);
            return;
        }
        for (const view of this.views.values())
            if (view.mounted)
                void this.refitAxis(view.axis.id);
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
        this.element.replaceChildren();
        const header = document.createElement("header");
        header.className = "mplot-header";
        const title = document.createElement("div");
        title.className = "mplot-title";
        title.textContent = this.model.document.title ?? "MPlot";
        header.append(title);
        if (this.options.toolbar !== false)
            header.append(this.createToolbar());
        this.element.append(header);
        const shell = document.createElement("div");
        shell.className = "mplot-shell";
        if (this.model.document.figures.length > 1)
            shell.append(this.createNavigator());
        const figuresElement = document.createElement("main");
        figuresElement.className = "mplot-figures";
        shell.append(figuresElement);
        this.element.append(shell);
        const immediateMounts = [];
        for (const [figureIndex, figure] of this.model.document.figures.entries()) {
            const figureView = this.createFigure(figure, figureIndex);
            this.figures.set(figure.id, figureView);
            figuresElement.append(figureView.element);
            for (const [axisIndex, axisId] of figureView.axisIds.entries()) {
                const axis = this.model.document.axes.find((item) => item.id === axisId);
                if (!axis)
                    continue;
                const view = this.createAxis(axis, figure.id);
                this.positionAxis(view.host, axis, axisIndex, figureView.axisIds.length);
                figureView.canvas.append(view.host);
                this.views.set(axis.id, view);
                this.resize?.observe(view.host);
                if (this.intersection)
                    this.intersection.observe(view.host);
                else
                    immediateMounts.push(this.mountAxis(axis.id));
            }
        }
        if (token !== this.documentToken)
            return;
        await Promise.all(immediateMounts);
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
        const count = document.createElement("span");
        count.className = "mplot-figure-count";
        count.textContent = `${axisIds.length} ${axisIds.length === 1 ? "plot" : "plots"}`;
        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "mplot-figure-toggle";
        toggle.textContent = "Collapse";
        toggle.setAttribute("aria-expanded", "true");
        heading.append(title, count, toggle);
        const canvas = document.createElement("div");
        canvas.className = "mplot-figure-canvas";
        const [width, height] = figure.size ?? [640, 480];
        canvas.style.setProperty("--mplot-figure-ratio", String(width / Math.max(1, height)));
        toggle.onclick = () => {
            const collapsed = !element.classList.contains("mplot-figure--collapsed");
            element.classList.toggle("mplot-figure--collapsed", collapsed);
            toggle.textContent = collapsed ? "Expand" : "Collapse";
            toggle.setAttribute("aria-expanded", String(!collapsed));
            const stored = this.figures.get(figure.id);
            if (stored)
                stored.collapsed = collapsed;
        };
        element.append(heading, canvas);
        return { figure, element, canvas, axisIds, collapsed: false };
    }
    createAxis(axis, figureId) {
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
        const viewport = this.model.viewports.get(axis.id) ?? { x: [0, 1], y: [0, 1] };
        return { axis, figureId, host, svg: chart, plot, overlay, readout, width: 640, height: 360, margin: { left: 64, right: 18, top: 28, bottom: 58 }, x: createScale(axis.xscale, viewport.x, [64, 622]), y: createScale(axis.yscale, viewport.y, [302, 28]), mounted: false };
    }
    positionAxis(host, axis, index, count) {
        const position = axis.position ?? inferredPosition(index, count);
        host.style.left = `${position[0] * 100}%`;
        host.style.top = `${(1 - position[1] - position[3]) * 100}%`;
        host.style.width = `${position[2] * 100}%`;
        host.style.height = `${position[3] * 100}%`;
    }
    async mountAxis(axisId) {
        const view = this.views.get(axisId);
        if (!view || view.mounted)
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
    }
    createNavigator() {
        const navigation = document.createElement("nav");
        navigation.className = "mplot-navigator";
        navigation.setAttribute("aria-label", "Figures");
        const heading = document.createElement("strong");
        heading.textContent = "Figures";
        const controls = document.createElement("div");
        controls.className = "mplot-navigator-controls";
        for (const [label, collapsed] of [["Expand all", false], ["Collapse all", true]]) {
            const button = document.createElement("button");
            button.type = "button";
            button.textContent = label;
            button.onclick = () => this.setAllFiguresCollapsed(collapsed);
            controls.append(button);
        }
        const list = document.createElement("ol");
        this.model.document.figures.forEach((figure, index) => {
            const item = document.createElement("li"), link = document.createElement("a");
            link.href = `#mplot-figure-${safeId(figure.id)}`;
            const count = this.figureAxisIds(figure).length;
            link.textContent = `${figure.title ?? `Figure ${index + 1}`} (${count})`;
            item.append(link);
            list.append(item);
        });
        navigation.append(heading, controls, list);
        return navigation;
    }
    setAllFiguresCollapsed(collapsed) {
        for (const figure of this.figures.values()) {
            figure.collapsed = collapsed;
            figure.element.classList.toggle("mplot-figure--collapsed", collapsed);
            const toggle = figure.element.querySelector(".mplot-figure-toggle");
            if (toggle) {
                toggle.textContent = collapsed ? "Expand" : "Collapse";
                toggle.setAttribute("aria-expanded", String(!collapsed));
            }
        }
    }
    createToolbar() {
        const toolbar = document.createElement("nav");
        toolbar.className = "mplot-toolbar";
        toolbar.setAttribute("aria-label", "Plot tools");
        const actions = [["Pan", "pan", () => this.setMode("pan")], ["Zoom", "zoom", () => this.setMode("zoom")], ["Select", "select", () => this.setMode("select")], ["Reset", "reset", () => this.reset()]];
        for (const [label, name, action] of actions) {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "mplot-button";
            button.textContent = label;
            button.dataset.action = name;
            button.title = label;
            button.onclick = action;
            if (["pan", "zoom", "select"].includes(name))
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
            if (["pan", "zoom", "select"].includes(button.dataset.action ?? ""))
                button.setAttribute("aria-pressed", String(button.dataset.action === mode));
        });
    }
    async renderMounted() { await Promise.all(Array.from(this.views.values()).filter((view) => view.mounted).map((view) => this.renderAxis(view.axis.id))); }
    async renderAxis(axisId) {
        const view = this.views.get(axisId);
        if (!view?.mounted)
            return;
        const token = (this.axisTokens.get(axisId) ?? 0) + 1;
        this.axisTokens.set(axisId, token);
        const rect = view.host.getBoundingClientRect();
        view.width = Math.max(180, rect.width || 640);
        view.height = Math.max(150, rect.height || 360);
        view.margin = compactMargins(view.width, view.height);
        view.svg.setAttribute("viewBox", `0 0 ${view.width} ${view.height}`);
        const viewport = this.model.viewports.get(axisId) ?? this.model.defaultViewport(view.axis);
        const right = view.width - view.margin.right, bottom = view.height - view.margin.bottom;
        view.x = createScale(view.axis.xscale, viewport.x, [view.margin.left, right]);
        view.y = createScale(view.axis.yscale, viewport.y, [bottom, view.margin.top]);
        view.plot.replaceChildren();
        view.overlay.replaceChildren();
        this.drawAxes(view);
        const clipId = `mplot-clip-${safeId(view.axis.id)}`, defs = svg("defs"), clip = svg("clipPath", { id: clipId });
        clip.append(svg("rect", { x: view.margin.left, y: view.margin.top, width: right - view.margin.left, height: bottom - view.margin.top }));
        defs.append(clip);
        view.plot.prepend(defs);
        const artists = this.model.document.artists.filter((artist) => artist.axes_id === axisId && artist.props.visible !== false);
        for (const artist of artists) {
            const group = svg("g", { "data-artist-id": artist.id, "clip-path": `url(#${clipId})` });
            view.plot.append(group);
            const renderer = this.renderers.get(artist.type);
            if (!renderer) {
                this.drawUnknown(group, artist, view);
                continue;
            }
            try {
                const data = await this.model.resolveData(artist.data, artist);
                if (this.axisTokens.get(axisId) !== token || !view.mounted)
                    return;
                this.resolvedData.set(artist.id, data);
                const selected = this.selectedIndices(artist.id);
                await renderer({ ...view, group, artist, data, theme: this.theme, selected, pointBudget: Math.max(500, Math.round(view.width * 4)), project3d: (x, y, z) => this.project3d(view, x, y, z) });
            }
            catch (error) {
                this.drawUnknown(group, artist, view, error instanceof Error ? error.message : "render failed");
            }
        }
        if (this.axisTokens.get(axisId) === token)
            this.drawHitArea(view);
    }
    drawAxes(view) {
        const { left, top, bottom, right } = view.margin, b = view.height - bottom, r = view.width - right;
        const tickCount = Math.max(3, Math.floor((r - left) / 90));
        for (const tick of view.x.ticks(tickCount)) {
            const px = view.x(tick);
            view.plot.append(svg("line", { x1: px, x2: px, y1: top, y2: b, class: "mplot-grid-line" }));
            const text = svg("text", { x: px, y: b + 15, "text-anchor": "middle", class: "mplot-tick" });
            text.textContent = formatTick(tick, view.axis.xscale);
            view.plot.append(text);
        }
        for (const tick of view.y.ticks(Math.max(3, Math.floor((b - top) / 65)))) {
            const py = view.y(tick);
            view.plot.append(svg("line", { x1: left, x2: r, y1: py, y2: py, class: "mplot-grid-line" }));
            const text = svg("text", { x: left - 7, y: py + 4, "text-anchor": "end", class: "mplot-tick" });
            text.textContent = formatTick(tick, view.axis.yscale);
            view.plot.append(text);
        }
        view.plot.append(svg("path", { d: `M${left},${top}H${r}V${b}H${left}Z`, fill: "none", class: "mplot-axis-frame" }));
        if (view.axis.title) {
            const text = svg("text", { x: (left + r) / 2, y: Math.max(14, top - 9), "text-anchor": "middle", class: "mplot-axis-title" });
            text.textContent = view.axis.title;
            view.plot.append(text);
        }
        if (view.axis.xlabel && view.height > 180) {
            const text = svg("text", { x: (left + r) / 2, y: b + 38, "text-anchor": "middle", class: "mplot-label" });
            text.textContent = view.axis.xlabel;
            view.plot.append(text);
        }
        if (view.axis.ylabel && view.width > 230) {
            const text = svg("text", { x: 14, y: (top + b) / 2, "text-anchor": "middle", class: "mplot-label", transform: `rotate(-90 14 ${(top + b) / 2})` });
            text.textContent = view.axis.ylabel;
            view.plot.append(text);
        }
    }
    drawUnknown(group, artist, view, reason = "Renderer not installed") { const box = svg("g", { class: "mplot-unknown" }); box.append(svg("rect", { x: view.margin.left + 8, y: view.margin.top + 8, width: Math.min(220, view.width - view.margin.left - 20), height: 40, rx: 2 })); const text = svg("text", { x: view.margin.left + 16, y: view.margin.top + 25 }); text.textContent = `Unknown: ${artist.type}`; const detail = svg("text", { x: view.margin.left + 16, y: view.margin.top + 40 }); detail.textContent = reason; box.append(text, detail); group.append(box); }
    drawHitArea(view) { const { left, top, bottom, right } = view.margin; view.overlay.append(svg("rect", { x: left, y: top, width: view.width - right - left, height: view.height - bottom - top, class: "mplot-hit" })); }
    bindInteractions(view) {
        let start;
        let brush;
        const finish = (event, cancel = false) => { if (!start)
            return; const pointer = this.pointer(view, event), p = this.boundToPlot(view, pointer.x, pointer.y); if (!cancel && this.mode === "zoom" && Math.hypot(p.x - start.x, p.y - start.y) > 4)
            this.model.setViewport(view.axis.id, { ...start.viewport, x: [view.x.invert(Math.min(start.x, p.x)), view.x.invert(Math.max(start.x, p.x))], y: [view.y.invert(Math.max(start.y, p.y)), view.y.invert(Math.min(start.y, p.y))] });
        else if (!cancel && this.mode === "select")
            this.selectRect(view, start.x, start.y, p.x, p.y); start = undefined; brush?.remove(); brush = undefined; };
        view.svg.addEventListener("pointerdown", (event) => { this.activeAxisId = view.axis.id; this.markActiveAxis(); const p = this.pointer(view, event); if (!this.inPlot(view, p.x, p.y))
            return; start = { ...p, viewport: structuredClone(this.model.viewports.get(view.axis.id)) }; view.svg.setPointerCapture(event.pointerId); if (this.mode === "select" || this.mode === "zoom") {
            brush = svg("rect", { x: p.x, y: p.y, width: 0, height: 0, class: `mplot-brush mplot-brush--${this.mode}` });
            view.overlay.append(brush);
        } });
        view.svg.addEventListener("pointermove", (event) => { const p = this.pointer(view, event); this.updateCoordinates(view, p.x, p.y); if (!start) {
            this.showTooltip(view, p.x, p.y);
            return;
        } if (this.mode === "pan") {
            const next = structuredClone(start.viewport), dx = view.x.invert(start.x) - view.x.invert(p.x), dy = view.y.invert(start.y) - view.y.invert(p.y);
            next.x = [start.viewport.x[0] + dx, start.viewport.x[1] + dx];
            next.y = [start.viewport.y[0] + dy, start.viewport.y[1] + dy];
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
            return; const factor = Math.exp(event.deltaY * .001), current = this.model.viewports.get(view.axis.id), cx = view.x.invert(p.x), cy = view.y.invert(p.y); this.model.setViewport(view.axis.id, { ...current, x: [cx + (current.x[0] - cx) * factor, cx + (current.x[1] - cx) * factor], y: [cy + (current.y[0] - cy) * factor, cy + (current.y[1] - cy) * factor] }); }, { passive: false });
        view.svg.addEventListener("dblclick", () => this.reset(view.axis.id));
    }
    pointer(view, event) { const rect = view.svg.getBoundingClientRect(); return { x: (event.clientX - rect.left) * view.width / (rect.width || view.width), y: (event.clientY - rect.top) * view.height / (rect.height || view.height) }; }
    plotBounds(view) { return { left: view.margin.left, right: view.width - view.margin.right, top: view.margin.top, bottom: view.height - view.margin.bottom }; }
    inPlot(view, x, y) { const bounds = this.plotBounds(view); return x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom; }
    boundToPlot(view, x, y) { const bounds = this.plotBounds(view); return { x: Math.max(bounds.left, Math.min(bounds.right, x)), y: Math.max(bounds.top, Math.min(bounds.bottom, y)) }; }
    updateCoordinates(view, px, py) { view.readout.textContent = this.inPlot(view, px, py) ? `x ${formatTick(view.x.invert(px), view.axis.xscale)} · y ${formatTick(view.y.invert(py), view.axis.yscale)}` : "x — · y —"; }
    clearHover(view) { view.host.querySelector(".mplot-tooltip")?.remove(); view.readout.textContent = "x — · y —"; }
    selectRect(view, x0, y0, x1, y1) { const left = Math.min(x0, x1), right = Math.max(x0, x1), top = Math.min(y0, y1), bottom = Math.max(y0, y1), points = []; for (const artist of this.model.document.artists.filter((item) => item.axes_id === view.axis.id)) {
        const data = this.resolvedData.get(artist.id) ?? artist.data;
        const selected = pairs(data.x, data.y).filter(([x, y]) => { const px = view.x(x), py = view.y(y); return px >= left && px <= right && py >= top && py <= bottom; }).map(([, , index]) => index);
        if (selected.length)
            points.push({ artistId: artist.id, indices: selected });
    } const id = this.model.document.selections?.[0]?.id ?? "selection"; this.model.setSelection(id, points); const detail = { selectionId: id, axesId: view.axis.id, points }, event = new CustomEvent("mplot:selection", { detail }); this.element.dispatchEvent(event); this.dispatchEvent(event); }
    selectedIndices(artistId) { const values = new Set(); for (const selection of this.model.selections.values())
        for (const point of selection)
            if (point.artistId === artistId)
                point.indices.forEach((index) => values.add(index)); return values; }
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
    } tooltip.style.left = `${px / view.width * 100}%`; tooltip.style.top = `${py / view.height * 100}%`; tooltip.textContent = `${best.artist.props.label ?? best.artist.id} [${best.index}]  x ${formatTick(best.x, view.axis.xscale)} · y ${formatTick(best.y, view.axis.yscale)}`; }
    project3d(view, x, y, z) { const viewport = this.model.viewports.get(view.axis.id), zlim = viewport.z ?? [0, 1], zn = (z - zlim[0]) / (zlim[1] - zlim[0] || 1) - .5; return [view.x(x) + zn * 32, view.y(y) - zn * 24]; }
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
            const position = view.axis.position ?? inferredPosition((figure?.axisIds.indexOf(axisId) ?? 0), figure?.axisIds.length ?? 1), group = svg("g", { transform: `translate(${position[0] * width} ${(1 - position[1] - position[3]) * height}) scale(${position[2] * width / view.width} ${position[3] * height / view.height})` });
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
                await this.mountFigure(figure.id);
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
                await this.mountFigure(figure.id);
        else if (this.activeAxisId)
            await this.mountAxis(this.activeAxisId);
        const filename = `mplot-${scope}.${format}`;
        this.download(format === "svg" ? new Blob([this.exportSVG(scope)], { type: "image/svg+xml;charset=utf-8" }) : await this.exportPNG(2, scope), filename);
    }
    async mountFigure(figureId) { await Promise.all((this.figures.get(figureId)?.axisIds ?? []).map((axisId) => this.mountAxis(axisId))); }
    activeFigureId() { return this.activeAxisId ? this.views.get(this.activeAxisId)?.figureId : this.model.document.figures[0]?.id; }
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
    applyTheme() { const values = { "--mplot-bg": this.theme.background, "--mplot-panel": this.theme.panel, "--mplot-fg": this.theme.foreground, "--mplot-muted": this.theme.muted, "--mplot-grid": this.theme.grid, "--mplot-accent": this.theme.accent, "--mplot-selection": this.theme.selection, "font-family": this.theme.fontFamily }; for (const [key, value] of Object.entries(values))
        this.element.style.setProperty(key, value); }
}
const safeId = (value) => value.replace(/[^a-zA-Z0-9_-]/g, "-");
const serializeSvg = (element) => new XMLSerializer().serializeToString(element);
const emptySvg = () => `<svg xmlns="${SVG_NS}"/>`;
function inferredPosition(index, count) { const columns = Math.ceil(Math.sqrt(count)), rows = Math.ceil(count / columns), gap = .04, width = (1 - gap * (columns + 1)) / columns, height = (1 - gap * (rows + 1)) / rows, column = index % columns, row = Math.floor(index / columns); return [gap + column * (width + gap), gap + (rows - row - 1) * (height + gap), width, height]; }
function compactMargins(width, height) { const compact = width < 300 || height < 210; return compact ? { left: 48, right: 12, top: 25, bottom: 42 } : { left: 64, right: 18, top: 30, bottom: 62 }; }
//# sourceMappingURL=viewer.js.map