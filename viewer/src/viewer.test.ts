// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { labelWidth, BFPlotViewer, thinTicks } from "./viewer.js";
import type { BFPlotDocument } from "./types.js";

const pointer = (type: string, init: PointerEventInit): Event => {
  const EventConstructor = window.PointerEvent || window.MouseEvent;
  const event = new EventConstructor(type, init);
  if (!("pointerId" in event)) Object.defineProperty(event, "pointerId", { value: init.pointerId ?? 1 });
  return event;
};

const document: BFPlotDocument = {
  title: "Experiment",
  figures: [{ id: "f", title: "Results", axes: ["a"] }],
  axes: [{ id: "a", title: "Signal", xlabel: "time", ylabel: "value", xlim: [0, 2], ylim: [0, 4] }],
  artists: [
    { type: "bfplot.line", id: "line", axes_id: "a", props: { color: "red" }, data: { x: [0, 1, 2], y: [0, 2, 4] } },
    { type: "org.example.missing", id: "unknown", axes_id: "a", props: {}, data: {} },
  ],
};

describe("BFPlotViewer", () => {
  it("renders built-ins and visibly degrades unknown artists", async () => {
    const host = window.document.createElement("div");
    window.document.body.append(host);
    const viewer = new BFPlotViewer(host, document);
    await viewer.render();
    expect(host.textContent).toContain("Experiment");
    expect(host.querySelector(".bfplot-shell")?.firstElementChild).toBe(host.querySelector(".bfplot-header"));
    expect(host.querySelector(".bfplot-header")?.nextElementSibling).toBe(host.querySelector(".bfplot-figures"));
    expect(host.querySelector('[data-artist-id="line"] path')).not.toBeNull();
    expect(host.textContent).toContain("Unknown: org.example.missing");
    expect(host.querySelector(".bfplot-coordinates")?.textContent).toBe("x — · y —");
    const xLabel = Array.from(host.querySelectorAll(".bfplot-label")).find((label) => label.textContent === "time");
    expect(Number(xLabel?.getAttribute("y"))).toBeLessThan(360);
    expect(host.querySelector(".bfplot-tick")?.getAttribute("font-size")).toBe("15");
    expect(host.querySelector(".bfplot-label")?.getAttribute("font-size")).toBe("15");
    expect(host.querySelector(".bfplot-axis-title")?.getAttribute("font-size")).toBe("15");
    expect(viewer.exportSVG()).toContain(">Signal</text>");
    viewer.destroy();
  });

  it("selects a line when the plot overlay receives the pointer", async () => {
    const host = window.document.createElement("div");
    window.document.body.append(host);
    const viewer = new BFPlotViewer(host, document);
    await viewer.render();
    const chart = host.querySelector<SVGSVGElement>(".bfplot-axis svg")!;
    Object.defineProperty(chart, "getBoundingClientRect", {
      value: () => ({ left: 0, top: 0, width: 640, height: 360, right: 640, bottom: 360, x: 0, y: 0, toJSON: () => ({}) }),
    });

    host.querySelector<HTMLButtonElement>('[data-action="compare"]')!.click();
    chart.dispatchEvent(pointer("pointerdown", { bubbles: true, clientX: 351, clientY: 165 }));

    expect(host.querySelector('[data-artist-id="line"]')?.getAttribute("aria-pressed")).toBe("true");
    expect(host.querySelector<HTMLButtonElement>(".bfplot-open-comparison")?.disabled).toBe(false);
    viewer.destroy();
  });

  it("renders named figure navigation in the left rail", async () => {
    const host = window.document.createElement("div");
    window.document.body.append(host);
    const viewer = new BFPlotViewer(host, { ...document, figures: [{ id: "f", title: "Results", name: "results", axes: ["a"] }, { id: "g", title: "Appendix", axes: [] }] });
    await viewer.render();
    expect(Array.from(host.querySelectorAll(".bfplot-page-name"), (element) => element.textContent)).toEqual(["Results", "Appendix", "Metadata"]);
    expect(host.querySelector(".bfplot-figure-title")?.textContent).toBe("Results");
    expect(host.querySelector(".bfplot-page-button[aria-current=page] .bfplot-page-number")?.textContent).toBe("01");
    viewer.destroy();
  });

  it("renders colorbars as auxiliary axes excluded from plot counts", async () => {
    const host = window.document.createElement("div");
    window.document.body.append(host);
    const withColorbar: BFPlotDocument = {
      ...document,
      figures: [{ id: "f", title: "Results", axes: ["a", "c"] }],
      axes: [...document.axes, { id: "c", figure_id: "f", role: "colorbar", position: [.82, .1, .03, .8], colorbar: { orientation: "vertical", label: "intensity", limits: [0, 1], ticks: [0, .5, 1], colors: ["#000000", "#ffffff"], mappable: "image" } }],
      artists: [{ type: "bfplot.image", id: "image", axes_id: "a", props: { clim: [0, 1] }, data: { values: [[0, 1], [1, 0]], extent: [0, 2, 0, 4] } }],
    };
    const viewer = new BFPlotViewer(host, withColorbar);
    await viewer.render();
    expect(host.querySelector(".bfplot-figure-count")?.textContent).toBe("1 plot");
    expect(host.querySelectorAll(".bfplot-axis")).toHaveLength(1);
    const colorbar = host.querySelector<HTMLElement>(".bfplot-colorbar")!;
    expect(colorbar.getAttribute("style")).toContain("left: 82%");
    expect(host.querySelector(".bfplot-colorbar-label")?.textContent).toBe("intensity");
    const wheel = new WheelEvent("wheel", { deltaY: -100, cancelable: true });
    colorbar.dispatchEvent(wheel);
    expect(wheel.defaultPrevented).toBe(false);
    expect(colorbar.dataset.contrastLimits).toBeUndefined();
    host.querySelector<HTMLButtonElement>('[data-action="zoom"]')!.click();
    const gradient = colorbar.querySelector<HTMLElement>(".bfplot-colorbar-gradient")!;
    Object.defineProperty(gradient, "getBoundingClientRect", { value: () => ({ left: 0, top: 0, width: 20, height: 100, right: 20, bottom: 100, x: 0, y: 0, toJSON: () => ({}) }) });
    gradient.setPointerCapture = () => undefined;
    gradient.dispatchEvent(pointer("pointerdown", { bubbles: true, pointerId: 1, clientX: 10, clientY: 80 }));
    gradient.dispatchEvent(pointer("pointermove", { bubbles: true, pointerId: 1, clientX: 10, clientY: 20 }));
    expect(gradient.querySelector(".bfplot-colorbar-brush")).not.toBeNull();
    gradient.dispatchEvent(pointer("pointerup", { bubbles: true, pointerId: 1, clientX: 10, clientY: 20 }));
    expect(colorbar.dataset.contrastLimits).toBe("0.2,0.8");
    expect(Array.from(colorbar.querySelectorAll(".bfplot-colorbar-tick"), (tick) => tick.textContent)).toEqual(["0.2", "0.35", "0.5", "0.65", "0.8"]);
    colorbar.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(host.querySelector(".bfplot-colorbar")?.getAttribute("data-contrast-limits")).toBeNull();
    viewer.destroy();
  });

  it("applies reverse colorbar drags to filled contours", async () => {
    const host = window.document.createElement("div");
    window.document.body.append(host);
    const withContour: BFPlotDocument = {
      ...document,
      figures: [{ id: "f", title: "Results", axes: ["a", "c"] }],
      axes: [...document.axes, { id: "c", figure_id: "f", role: "colorbar", position: [.82, .1, .03, .8], colorbar: { orientation: "vertical", limits: [0, 1], ticks: [0, .5, 1], colors: ["#440154", "#fde725"], mappable: "contour" } }],
      artists: [{ type: "bfplot.contourf", id: "contour", axes_id: "a", props: { clim: [0, 1], cmap: "viridis", facecolors: ["#abcdef"] }, data: { paths: [[[0, 0], [2, 0], [1, 4]]], path_values: [.25], levels: [0, 1] } }],
    };
    const viewer = new BFPlotViewer(host, withContour);
    await viewer.render();
    const before = host.querySelector('[data-artist-id="contour"] path')?.getAttribute("fill");
    host.querySelector<HTMLButtonElement>('[data-action="zoom"]')!.click();
    const colorbar = host.querySelector<HTMLElement>(".bfplot-colorbar")!, gradient = colorbar.querySelector<HTMLElement>(".bfplot-colorbar-gradient")!;
    Object.defineProperty(gradient, "getBoundingClientRect", { value: () => ({ left: 0, top: 0, width: 20, height: 100, right: 20, bottom: 100, x: 0, y: 0, toJSON: () => ({}) }) });
    gradient.setPointerCapture = () => undefined;
    gradient.dispatchEvent(pointer("pointerdown", { bubbles: true, pointerId: 1, clientX: 10, clientY: 20 }));
    gradient.dispatchEvent(pointer("pointerup", { bubbles: true, pointerId: 1, clientX: 10, clientY: 80 }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(colorbar.dataset.contrastLimits).toBe("0.2,0.8");
    expect(host.querySelector('[data-artist-id="contour"] path')?.getAttribute("fill")).not.toBe(before);
    viewer.destroy();
  });

  it("honors explicitly empty inset ticks", async () => {
    const host = window.document.createElement("div");
    window.document.body.append(host);
    const withInset: BFPlotDocument = {
      ...document,
      figures: [{ id: "f", axes: ["i"] }],
      axes: [{ id: "i", figure_id: "f", role: "inset", xlim: [0, 1], ylim: [0, 1], props: { xaxis: { ticks: [], ticklabels: [], provided: true }, yaxis: { ticks: [], ticklabels: [], provided: true } } }],
      artists: [],
    };
    const viewer = new BFPlotViewer(host, withInset);
    await viewer.render();
    expect(host.querySelector('[data-axes-id="i"] .bfplot-tick')).toBeNull();
    viewer.destroy();
  });

  it("constrains insets to their parent and excludes them from plot counts", async () => {
    const host = window.document.createElement("div");
    window.document.body.append(host);
    const withInset: BFPlotDocument = {
      ...document,
      figures: [{ id: "f", title: "Results", axes: ["a", "i"] }],
      axes: [
        { ...document.axes[0]!, position: [.1, .1, .7, .7] },
        { id: "i", figure_id: "f", role: "inset", parent_axes_id: "a", position: [.7, .6, .2, .2], xlim: [0, 1], ylim: [0, 1] },
      ],
    };
    const viewer = new BFPlotViewer(host, withInset);
    await viewer.render();
    expect(host.querySelector(".bfplot-figure-count")?.textContent).toBe("1 plot");
    const inset = host.querySelector<HTMLElement>('[data-axes-id="i"]')!;
    expect(inset.classList.contains("bfplot-axis--inset")).toBe(true);
    expect(parseFloat(inset.style.left)).toBeCloseTo(60);
    expect(parseFloat(inset.style.width)).toBeCloseTo(20);
    expect(inset.querySelector(".bfplot-coordinates")?.hasAttribute("hidden")).toBe(true);
    viewer.destroy();
  });

  it("shows the document metadata on its own page", async () => {
    const host = window.document.createElement("div");
    window.document.body.append(host);
    const viewer = new BFPlotViewer(host, { ...document, metadata: { provenance: { git_commit: "abc123", figures: 2 } } });
    await viewer.render();
    host.querySelector<HTMLButtonElement>('[data-page-id="__metadata__"]')!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const page = host.querySelector<HTMLElement>(".bfplot-metadata-page")!;
    expect(page.textContent).toContain("git_commit");
    expect(page.textContent).toContain("abc123");
    viewer.destroy();
  });

  it("renders result metadata as a peer navigation page", async () => {
    const host = window.document.createElement("div");
    window.document.body.append(host);
    const viewer = new BFPlotViewer(host, { ...document, metadata: { provenance: { created_utc: "2026-01-01T00:00:00Z" }, result: { document: "sha256:abc" } } });
    await viewer.render();
    expect(host.querySelector('[data-action="metadata"]')).toBeNull();
    expect(host.querySelector('[data-action="select"]')).toBeNull();
    host.querySelector<HTMLButtonElement>('[data-page-id="__metadata__"]')!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const page = host.querySelector<HTMLElement>(".bfplot-metadata-page")!;
    expect(page.hidden).toBe(false);
    expect(host.querySelector<HTMLElement>(".bfplot-figure")?.hidden).toBe(true);
    expect(host.querySelector('[data-page-id="__metadata__"]')?.getAttribute("aria-current")).toBe("page");
    expect(page.textContent).toContain("created_utc");
    expect(page.textContent).toContain("2026-01-01T00:00:00Z");
    expect(page.textContent).toContain("sha256:abc");
    expect(page.querySelector("details")).toBeNull();
    expect(Array.from(page.querySelectorAll("h4"), (heading) => heading.textContent)).toEqual(["provenance", "result"]);
    viewer.destroy();
  });

  it("plays, seeks, and steps through temporal artist buffers", async () => {
    const host = window.document.createElement("div");
    window.document.body.append(host);
    const animated: BFPlotDocument = {
      ...document,
      timeline: {
        fps: 2, duration: 1, loop: false,
        frames: [
          { time: .5, updates: [{ target_kind: "artist", target: "line", path: ["data", "y"], value: [4, 2, 0] }] },
          { time: 1, updates: [{ target_kind: "artist", target: "line", path: ["data", "y"], value: [1, 1, 1] }] },
        ],
      },
    };
    const viewer = new BFPlotViewer(host, animated);
    await viewer.render();
    expect(host.querySelector(".bfplot-timeline")).not.toBeNull();
    expect(host.querySelector(".bfplot-timeline-time")?.textContent).toBe("0.00 / 1.00 s");
    host.querySelectorAll<HTMLButtonElement>(".bfplot-timeline .bfplot-button")[2]!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(host.querySelector(".bfplot-timeline-time")?.textContent).toBe("0.50 / 1.00 s");
    expect(viewer.model.document.artists[0]?.data.y).toEqual([4, 2, 0]);
    host.querySelectorAll<HTMLButtonElement>(".bfplot-timeline .bfplot-button")[2]!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(viewer.model.document.artists[0]?.data.y).toEqual([1, 1, 1]);
    const range = host.querySelector<HTMLInputElement>(".bfplot-timeline-range")!;
    range.value = "0"; range.dispatchEvent(new window.Event("input"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(viewer.model.document.artists[0]?.data.y).toEqual([0, 2, 4]);
    viewer.destroy();
  });

  it("draws the last frame after rapid timeline steps", async () => {
    const host = window.document.createElement("div");
    window.document.body.append(host);
    const update = (time: number, y: number[]) => ({ time, updates: [{ target_kind: "artist" as const, target: "line", path: ["data", "y"], value: y }] });
    const viewer = new BFPlotViewer(host, { ...document, timeline: { fps: 2, duration: 1, frames: [update(.5, [4, 2, 0]), update(1, [1, 1, 1])] } });
    await viewer.render();
    const path = () => host.querySelector("[data-artist-id='line'] path:not(.bfplot-line-hit)")?.getAttribute("d");
    const step = host.querySelectorAll<HTMLButtonElement>(".bfplot-timeline .bfplot-button")[2]!;
    step.click(); step.click();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(host.querySelector(".bfplot-timeline-time")?.textContent).toBe("1.00 / 1.00 s");
    const rapid = path();
    const range = host.querySelector<HTMLInputElement>(".bfplot-timeline-range")!;
    range.value = "0"; range.dispatchEvent(new window.Event("input"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(path()).not.toBe(rapid);
    step.click(); await new Promise((resolve) => setTimeout(resolve, 20));
    step.click(); await new Promise((resolve) => setTimeout(resolve, 20));
    expect(rapid).toBe(path());
    viewer.destroy();
  });

  it("keeps repeated semilog wheel zoom inside the positive domain", async () => {
    const host = window.document.createElement("div");
    window.document.body.append(host);
    const viewer = new BFPlotViewer(host, { ...document, axes: [{ ...document.axes[0]!, xlim: [1, 1000], xscale: "log" }] });
    await viewer.render();
    const chart = host.querySelector<SVGSVGElement>(".bfplot-axis svg")!;
    Object.defineProperty(chart, "getBoundingClientRect", { value: () => ({ left: 0, top: 0, width: 640, height: 360, right: 640, bottom: 360, x: 0, y: 0, toJSON: () => ({}) }) });
    for (let index = 0; index < 12; index++) chart.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, clientX: 180, clientY: 170, deltaY: -100 }));
    const viewport = viewer.model.viewports.get("a")!;
    expect(viewport.x[0]).toBeGreaterThan(0);
    expect(viewport.x[1]).toBeGreaterThan(viewport.x[0]);
    expect(Number.isFinite(viewport.x[0])).toBe(true);
    viewer.destroy();
  });

  it("hides colorbar ticks outside the colour range", async () => {
    const host = window.document.createElement("div");
    window.document.body.append(host);
    const viewer = new BFPlotViewer(host, {
      ...document,
      figures: [{ id: "f", axes: ["a", "c"] }],
      axes: [...document.axes, { id: "c", figure_id: "f", role: "colorbar", position: [.82, .1, .03, .8], colorbar: { orientation: "vertical", limits: [.1, 4.8], ticks: [0, 1, 2, 3, 4, 5], ticklabels: ["0", "1", "2", "3", "4", "5"], colors: ["#000000", "#ffffff"] } }],
    });
    await viewer.render();
    expect(Array.from(host.querySelectorAll(".bfplot-colorbar-tick"), (tick) => tick.textContent)).toEqual(["1", "2", "3", "4"]);
    viewer.destroy();
  });

  it("rotates crowded category labels instead of overlapping them", async () => {
    const host = window.document.createElement("div");
    window.document.body.append(host);
    const labels = ["alpha centauri", "beta pictoris", "gamma draconis", "delta scuti", "epsilon eridani", "zeta reticuli", "eta carinae", "theta orionis"];
    const viewer = new BFPlotViewer(host, { ...document, axes: [{ ...document.axes[0]!, xlim: [-.5, 7.5], props: { xaxis: { ticks: labels.map((_, index) => index), ticklabels: labels, provided: true } } }] });
    await viewer.render();
    const ticks = Array.from(host.querySelectorAll(".bfplot-tick")).filter((tick) => labels.includes(tick.textContent ?? ""));
    expect(ticks).toHaveLength(labels.length);
    expect(ticks.every((tick) => tick.getAttribute("transform")?.startsWith("rotate(-30"))).toBe(true);
    viewer.destroy();
  });

  it("draws 3D panes and edge ticks without clipping the artists", async () => {
    const host = window.document.createElement("div");
    window.document.body.append(host);
    const viewer = new BFPlotViewer(host, { ...document, axes: [{ ...document.axes[0]!, projection: "3d", zlim: [0, 2], zlabel: "height", props: { view: { elev: 30, azim: -60 } } }], artists: [{ type: "bfplot.line3d", id: "line3d", axes_id: "a", props: {}, data: { x: [0, 1], y: [0, 1], z: [0, 2] } }] });
    await viewer.render();
    expect(host.querySelectorAll(".bfplot-3d-pane")).toHaveLength(3);
    expect(host.querySelector('[data-artist-id="line3d"]')?.hasAttribute("clip-path")).toBe(false);
    expect(Array.from(host.querySelectorAll(".bfplot-label"), (label) => label.textContent)).toEqual(expect.arrayContaining(["time", "value", "height"]));
    expect(host.querySelectorAll(".bfplot-tick").length).toBeGreaterThan(6);
    viewer.destroy();
  });

  it("rotates 3D plots like Matplotlib, dragging the box along with the pointer", async () => {
    const host = window.document.createElement("div");
    window.document.body.append(host);
    // The point sits on the front-bottom corner of the box at the default view.
    const viewer = new BFPlotViewer(host, { ...document, axes: [{ ...document.axes[0]!, projection: "3d", zlim: [0, 2], props: { view: { elev: 30, azim: -60 } } }], artists: [{ type: "bfplot.scatter3d", id: "corner", axes_id: "a", props: {}, data: { x: [2], y: [0], z: [0] } }] });
    await viewer.render();
    const chart = host.querySelector<SVGSVGElement>(".bfplot-axis svg")!, corner = () => host.querySelector('[data-artist-id="corner"] circle')!;
    const before = { x: Number(corner().getAttribute("cx")), y: Number(corner().getAttribute("cy")) };
    chart.setPointerCapture = () => undefined;
    chart.dispatchEvent(pointer("pointerdown", { bubbles: true, pointerId: 1, clientX: 200, clientY: 150 }));
    chart.dispatchEvent(pointer("pointermove", { bubbles: true, pointerId: 1, clientX: 230, clientY: 170 }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(Number(corner().getAttribute("cx"))).toBeGreaterThan(before.x);
    expect(Number(corner().getAttribute("cy"))).toBeGreaterThan(before.y);
    viewer.destroy();
  });

  it("rotates 3D plots by dragging", async () => {
    const host = window.document.createElement("div");
    window.document.body.append(host);
    const threeDimensional: BFPlotDocument = { ...document, axes: [{ ...document.axes[0]!, projection: "3d", zlim: [0, 2], props: { view: { elev: 30, azim: -60 } } }], artists: [{ type: "bfplot.line3d", id: "line3d", axes_id: "a", props: {}, data: { x: [0, 1], y: [0, 1], z: [0, 2] } }] };
    const viewer = new BFPlotViewer(host, threeDimensional);
    await viewer.render();
    const chart = host.querySelector<SVGSVGElement>(".bfplot-axis svg")!, before = host.querySelector('[data-artist-id="line3d"] path')?.getAttribute("d");
    chart.setPointerCapture = () => undefined;
    chart.dispatchEvent(pointer("pointerdown", { bubbles: true, pointerId: 1, clientX: 200, clientY: 150 }));
    chart.dispatchEvent(pointer("pointermove", { bubbles: true, pointerId: 1, clientX: 260, clientY: 180 }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(chart.classList.contains("bfplot-3d-view")).toBe(true);
    expect(host.querySelector('[data-artist-id="line3d"] path')?.getAttribute("d")).not.toBe(before);
    viewer.destroy();
  });

  it("shows a visible rectangle while box zooming", async () => {
    const host = window.document.createElement("div");
    window.document.body.append(host);
    const viewer = new BFPlotViewer(host, document);
    await viewer.render();
    const zoom = host.querySelector<HTMLButtonElement>('[data-action="zoom"]')!;
    const chart = host.querySelector<SVGSVGElement>(".bfplot-axis svg")!;
    zoom.click();
    chart.setPointerCapture = () => undefined;
    chart.dispatchEvent(pointer("pointerdown", { bubbles: true, pointerId: 1, clientX: 100, clientY: 100 }));
    chart.dispatchEvent(pointer("pointermove", { bubbles: true, pointerId: 1, clientX: 220, clientY: 180 }));
    expect(host.querySelector(".bfplot-brush--zoom")).not.toBeNull();
    viewer.destroy();
  });

  it("updates coordinates and sanitizes private hover labels", async () => {
    const host = window.document.createElement("div");
    window.document.body.append(host);
    const hoverDocument: BFPlotDocument = { ...document, artists: [{ ...document.artists[0]!, props: { label: "_child0" } }] };
    const viewer = new BFPlotViewer(host, hoverDocument);
    await viewer.render();
    const chart = host.querySelector<SVGSVGElement>(".bfplot-axis svg")!;
    chart.dispatchEvent(pointer("pointermove", { bubbles: true, clientX: 349, clientY: 163 }));
    expect(host.querySelector(".bfplot-coordinates")?.textContent).toMatch(/^x = .+ · y = .+$/);
    const tooltip = host.querySelector(".bfplot-tooltip")?.textContent;
    expect(tooltip).toMatch(/^x = .+ · y = .+$/);
    expect(tooltip).not.toContain("_child0");
    viewer.destroy();
  });

});

describe("tick layout", () => {
  const ticks = (values: number[], spacing: number, extent: number) => values.map((tick, index) => ({ tick, position: index * spacing, extent }));

  it("keeps every tick when the labels fit", () => {
    expect(thinTicks(ticks([0, 1, 2, 3], 50, 20), 8).map(({ tick }) => tick)).toEqual([0, 1, 2, 3]);
  });

  it("thins crowded ticks to a round step that keeps zero", () => {
    const values = [-1, -.75, -.5, -.25, 0, .25, .5, .75, 1];
    expect(thinTicks(ticks(values, 20, 30), 8).map(({ tick }) => tick)).toEqual([-1, -.5, 0, .5, 1]);
    expect(thinTicks(ticks(values, 14, 30), 8).map(({ tick }) => tick)).toEqual([-1, 0, 1]);
  });

  it("estimates label widths for plain text and TeX scripts", () => {
    expect(labelWidth("100")).toBeCloseTo(labelWidth("abc"));
    expect(labelWidth("$10^{3}$")).toBeGreaterThan(labelWidth("10"));
    expect(labelWidth("$10^{3}$")).toBeLessThan(labelWidth("1000"));
  });
});
