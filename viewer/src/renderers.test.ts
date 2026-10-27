// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { builtinRenderers, PLOT_TEXT_SIZE } from "./renderers.js";
import { createScale } from "./scales.js";
import { svg } from "./svg.js";
import { themes } from "./theme.js";

const artist = { type: "mplot.line", id: "line", axes_id: "axis", props: {}, data: {} };
const context = (group: SVGGElement, type: string, data: Record<string, unknown>, props: Record<string, unknown> = {}) => ({
  group, artist: { ...artist, type, props }, data,
  x: createScale("linear", [-3, 3], [0, 600]), y: createScale("linear", [-3, 3], [600, 0]),
  width: 600, height: 600, theme: themes.light, pointBudget: 2_000,
  project3d: (x: number, y: number, z: number) => [300 + x * 80 + z * 20, 300 - y * 80 - z * 20] as [number, number],
});

describe("artist rendering", () => {
  it("renders normalized error segments, filled contours, and equal-aspect paths", () => {
    const errors = svg("g");
    builtinRenderers["mplot.errorbar"]!(context(errors, "mplot.errorbar", { x: [0, 1], y: [1, 2], error_paths: [[[0, .5], [0, 1.5]], [[1, 1], [1, 3]]] }));
    expect(errors.querySelectorAll("path").length).toBeGreaterThanOrEqual(2);
    expect(errors.querySelectorAll("circle")).toHaveLength(2);
    const contours = svg("g");
    builtinRenderers["mplot.contourf"]!(context(contours, "mplot.contourf", { paths: [[[-2, -1], [0, 2], [2, -1], [-1, 0], [0, 1], [1, 0]]], path_codes: [[1, 2, 2, 1, 2, 79]] }, { facecolors: ["#abcdef"] }));
    expect(contours.querySelector("path")?.getAttribute("d")).toContain("L500.00,400.00 M200.00,300.00");
    expect(contours.querySelector("path")?.getAttribute("fill")).toBe("#abcdef");
    expect(contours.querySelector("path")?.getAttribute("fill-rule")).toBe("evenodd");
    const recolored = svg("g");
    builtinRenderers["mplot.contourf"]!(context(recolored, "mplot.contourf", { paths: [[[-2, -1], [0, 2], [2, -1]]], path_values: [7], levels: [0, 10] }, { facecolors: ["#abcdef"], cmap: "viridis", clim: [5, 10] }));
    expect(recolored.querySelector("path")?.getAttribute("fill")).not.toBe("#abcdef");
    expect(recolored.querySelector("path")?.getAttribute("fill")).toBe("rgb(43, 120, 140)");
    const lines = svg("g");
    builtinRenderers["mplot.line"]!(context(lines, "mplot.line", { x: [-1, 0, 1], y: [0, 1, 0] }));
    expect(lines.querySelector("path")?.getAttribute("d")).toContain("L300.00,200.00");
  });

  it("maps scalar scatter colors through the effective color limits", () => {
    const original = svg("g"), contrasted = svg("g");
    builtinRenderers["mplot.scatter"]!(context(original, "mplot.scatter", { x: [0, 1, 2], y: [0, 1, 2], values: [0, .5, 1] }, { cmap: "viridis", clim: [0, 1] }));
    builtinRenderers["mplot.scatter"]!(context(contrasted, "mplot.scatter", { x: [0, 1, 2], y: [0, 1, 2], values: [0, .5, 1] }, { cmap: "viridis", clim: [0, .75] }));
    expect(contrasted.querySelectorAll("circle")[1]?.getAttribute("fill")).not.toBe(original.querySelectorAll("circle")[1]?.getAttribute("fill"));
    expect(Array.from(contrasted.querySelectorAll("circle"), (point) => point.getAttribute("fill"))).toEqual(["rgb(68, 1, 84)", "rgb(74, 182, 112)", "rgb(253, 231, 37)"]);
  });

  it("renders TeX annotations as native MathML", () => {
    const group = svg("g");
    builtinRenderers["mplot.text"]!(context(group, "mplot.text", { x: 0, y: 0, text: "$x_1$" }));
    expect(group.querySelector("math")?.textContent).toContain("x1");
    expect(group.textContent).not.toContain("$x_1$");
    const matplotlib = svg("g");
    builtinRenderers["mplot.text"]!(context(matplotlib, "mplot.text", { x: 0, y: 0, text: "$\\mathdefault{10^{-2}}$" }));
    expect(matplotlib.textContent).not.toContain("\\mathdefault");
  });

  it("uses a uniform readable baseline for annotations", () => {
    const small = svg("g"), large = svg("g");
    builtinRenderers["mplot.text"]!(context(small, "mplot.text", { x: 0, y: 0, text: "small" }, { fontsize: 7 }));
    builtinRenderers["mplot.text"]!(context(large, "mplot.text", { x: 0, y: 0, text: "large" }, { fontsize: 18 }));
    expect(small.querySelector("text")?.getAttribute("font-size")).toBe(String(PLOT_TEXT_SIZE));
    expect(large.querySelector("text")?.getAttribute("font-size")).toBe("18");
  });

  it("applies affine patch transforms and suppresses two-point legacy spines", () => {
    const group = svg("g");
    builtinRenderers["mplot.patch"]!(context(group, "mplot.patch", { vertices: [[0, 0], [1, 0], [1, 1]], transform: [[.5, 0, 1], [0, .25, -1], [0, 0, 1]] }));
    expect(group.querySelector("path")?.getAttribute("d")).toBe("M400.00,400.00 L450.00,400.00 L450.00,375.00 Z");
    const legacy = svg("g");
    builtinRenderers["mplot.patch"]!(context(legacy, "mplot.patch", { vertices: [[0, -3], [0, 3]] }, { facecolor: "black", edgecolor: "black" }));
    expect(legacy.querySelector("path")).toBeNull();
  });

  it("renders true 3D surface faces and wire paths", () => {
    const paths = [[[0, 0, 0], [1, 0, .5], [1, 1, 1], [0, 1, .5]]];
    const surface = svg("g"), wire = svg("g");
    builtinRenderers["mplot.surface3d"]!(context(surface, "mplot.surface3d", { paths }, { facecolors: ["#123456"] }));
    builtinRenderers["mplot.mesh3d"]!(context(wire, "mplot.mesh3d", { paths }, { color: "#654321" }));
    expect(surface.querySelector("path")?.getAttribute("d")).toContain(" Z");
    expect(surface.querySelector("path")?.getAttribute("fill")).toBe("#123456");
    expect(wire.querySelector("path")?.getAttribute("fill")).toBe("none");
  });

  it("draws surface faces back to front and cycles single-entry styles", () => {
    const near = [[0, 0, 1], [1, 0, 1], [1, 1, 1]], far = [[0, 0, -1], [1, 0, -1], [1, 1, -1]];
    const surface = svg("g");
    builtinRenderers["mplot.surface3d"]!({ ...context(surface, "mplot.surface3d", { paths: [near, far] }, { facecolors: ["#111111", "#222222"], edgecolors: ["#0000ff"], linewidths: [1] }), depth3d: (_x: number, _y: number, z: number) => z });
    const faces = Array.from(surface.querySelectorAll("path"));
    expect(faces.map((face) => face.getAttribute("fill"))).toEqual(["#222222", "#111111"]);
    expect(faces.map((face) => face.getAttribute("stroke"))).toEqual(["#0000ff", "#0000ff"]);
    const wire = svg("g");
    builtinRenderers["mplot.mesh3d"]!(context(wire, "mplot.mesh3d", { paths: [near, far] }, { edgecolors: ["#1f77b4"] }));
    expect(Array.from(wire.querySelectorAll("path"), (path) => path.getAttribute("stroke"))).toEqual(["#1f77b4", "#1f77b4"]);
  });
});

describe("large data rendering", () => {
  it("limits line path complexity to the screen-space point budget", () => {
    const group = svg("g"), values = Array.from({ length: 100_000 }, (_, index) => index);
    builtinRenderers["mplot.line"]!({
      group, artist, data: { x: values, y: values }, x: createScale("linear", [0, 100_000], [0, 800]), y: createScale("linear", [0, 100_000], [600, 0]),
      width: 800, height: 600, theme: themes.light, pointBudget: 1_000, project3d: (x, y) => [x, y],
    });
    const path = group.querySelector("path")?.getAttribute("d") ?? "";
    expect((path.match(/[ML]/g) ?? [])).toHaveLength(1_000);
  });

  it("limits scatter DOM nodes to the screen-space point budget", () => {
    const group = svg("g"), values = Array.from({ length: 100_000 }, (_, index) => index);
    builtinRenderers["mplot.scatter"]!({
      group, artist: { ...artist, type: "mplot.scatter" }, data: { x: values, y: values }, x: createScale("linear", [0, 100_000], [0, 800]), y: createScale("linear", [0, 100_000], [600, 0]),
      width: 800, height: 600, theme: themes.light, pointBudget: 1_000, project3d: (x, y) => [x, y],
    });
    expect(group.querySelectorAll("circle")).toHaveLength(1_000);
  });

  it("renders a dense numerical image as one bounded raster node", () => {
    const pixels = new Uint8ClampedArray(4 * 3 * 2), putImageData = vi.fn(), toDataURL = vi.fn(() => "data:image/png;base64,test");
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ createImageData: () => ({ data: pixels }), putImageData } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockImplementation(toDataURL);
    const group = svg("g"), values = Array.from({ length: 175_000 }, (_, index) => index % 251);
    builtinRenderers["mplot.image"]!({
      group, artist: { ...artist, type: "mplot.image", props: { cmap: "cividis", clim: [0, 250], origin: "lower" } }, data: { values, shape: [350, 500], extent: [0, 500, 0, 350] }, x: createScale("linear", [0, 500], [0, 800]), y: createScale("linear", [0, 350], [600, 0]),
      width: 800, height: 600, theme: themes.light, pointBudget: 1_000, project3d: (x, y) => [x, y],
    });
    expect(group.querySelectorAll("image")).toHaveLength(1);
    expect(group.querySelectorAll("rect")).toHaveLength(0);
    expect(group.querySelector("image")?.getAttribute("href")).toBe("data:image/png;base64,test");
    expect(putImageData).toHaveBeenCalledOnce();
  });
});
