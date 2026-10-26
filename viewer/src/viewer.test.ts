// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { MPlotViewer } from "./viewer.js";
import type { MPlotDocument } from "./types.js";

const pointer = (type: string, init: PointerEventInit): Event => {
  const EventConstructor = window.PointerEvent || window.MouseEvent;
  const event = new EventConstructor(type, init);
  if (!("pointerId" in event)) Object.defineProperty(event, "pointerId", { value: init.pointerId ?? 1 });
  return event;
};

const document: MPlotDocument = {
  title: "Experiment",
  figures: [{ id: "f", title: "Results", axes: ["a"] }],
  axes: [{ id: "a", title: "Signal", xlabel: "time", ylabel: "value", xlim: [0, 2], ylim: [0, 4] }],
  artists: [
    { type: "mplot.line", schema_version: 1, id: "line", axes_id: "a", props: { color: "red" }, data: { x: [0, 1, 2], y: [0, 2, 4] } },
    { type: "org.example.missing", schema_version: 1, id: "unknown", axes_id: "a", props: {}, data: {} },
  ],
};

describe("MPlotViewer", () => {
  it("renders built-ins and visibly degrades unknown artists", async () => {
    const host = window.document.createElement("div");
    window.document.body.append(host);
    const viewer = new MPlotViewer(host, document);
    await viewer.render();
    expect(host.textContent).toContain("Experiment");
    expect(host.querySelector(".mplot-shell")?.firstElementChild).toBe(host.querySelector(".mplot-header"));
    expect(host.querySelector(".mplot-header")?.nextElementSibling).toBe(host.querySelector(".mplot-figures"));
    expect(host.querySelector('[data-artist-id="line"] path')).not.toBeNull();
    expect(host.textContent).toContain("Unknown: org.example.missing");
    expect(host.querySelector(".mplot-coordinates")?.textContent).toBe("x — · y —");
    const xLabel = Array.from(host.querySelectorAll(".mplot-label")).find((label) => label.textContent === "time");
    expect(Number(xLabel?.getAttribute("y"))).toBeLessThan(360);
    expect(host.querySelector(".mplot-tick")?.getAttribute("font-size")).toBe("15");
    expect(host.querySelector(".mplot-label")?.getAttribute("font-size")).toBe("15");
    expect(host.querySelector(".mplot-axis-title")?.getAttribute("font-size")).toBe("15");
    expect(viewer.exportSVG()).toContain(">Signal</text>");
    viewer.destroy();
  });

  it("renders named figure navigation in the left rail", async () => {
    const host = window.document.createElement("div");
    window.document.body.append(host);
    const viewer = new MPlotViewer(host, { ...document, figures: [{ id: "f", title: "Results", axes: ["a"] }, { id: "g", title: "Appendix", axes: [] }] });
    await viewer.render();
    expect(Array.from(host.querySelectorAll(".mplot-page-name"), (element) => element.textContent)).toEqual(["Results", "Appendix"]);
    expect(host.querySelector(".mplot-page-button[aria-current=page] .mplot-page-number")?.textContent).toBe("01");
    viewer.destroy();
  });

  it("renders colorbars as auxiliary axes excluded from plot counts", async () => {
    const host = window.document.createElement("div");
    window.document.body.append(host);
    const withColorbar: MPlotDocument = {
      ...document,
      figures: [{ id: "f", title: "Results", axes: ["a", "c"] }],
      axes: [...document.axes, { id: "c", figure_id: "f", role: "colorbar", position: [.82, .1, .03, .8], colorbar: { orientation: "vertical", label: "intensity", limits: [0, 1], ticks: [0, .5, 1], colors: ["#000000", "#ffffff"] } }],
    };
    const viewer = new MPlotViewer(host, withColorbar);
    await viewer.render();
    expect(host.querySelector(".mplot-figure-count")?.textContent).toBe("1 plot");
    expect(host.querySelectorAll(".mplot-axis")).toHaveLength(1);
    expect(host.querySelector(".mplot-colorbar")?.getAttribute("style")).toContain("left: 82%");
    expect(host.querySelector(".mplot-colorbar-label")?.textContent).toBe("intensity");
    viewer.destroy();
  });

  it("shows a visible rectangle while box zooming", async () => {
    const host = window.document.createElement("div");
    window.document.body.append(host);
    const viewer = new MPlotViewer(host, document);
    await viewer.render();
    const zoom = host.querySelector<HTMLButtonElement>('[data-action="zoom"]')!;
    const chart = host.querySelector<SVGSVGElement>(".mplot-axis svg")!;
    zoom.click();
    chart.setPointerCapture = () => undefined;
    chart.dispatchEvent(pointer("pointerdown", { bubbles: true, pointerId: 1, clientX: 100, clientY: 100 }));
    chart.dispatchEvent(pointer("pointermove", { bubbles: true, pointerId: 1, clientX: 220, clientY: 180 }));
    expect(host.querySelector(".mplot-brush--zoom")).not.toBeNull();
    viewer.destroy();
  });

  it("updates the coordinate readout while hovering", async () => {
    const host = window.document.createElement("div");
    window.document.body.append(host);
    const viewer = new MPlotViewer(host, document);
    await viewer.render();
    const chart = host.querySelector<SVGSVGElement>(".mplot-axis svg")!;
    chart.dispatchEvent(pointer("pointermove", { bubbles: true, clientX: 200, clientY: 150 }));
    expect(host.querySelector(".mplot-coordinates")?.textContent).toMatch(/^x .+ · y .+$/);
    viewer.destroy();
  });

});
