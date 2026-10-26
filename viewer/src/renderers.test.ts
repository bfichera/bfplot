// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { builtinRenderers } from "./renderers.js";
import { createScale } from "./scales.js";
import { svg } from "./svg.js";
import { themes } from "./theme.js";

const artist = { type: "mplot.line", schema_version: 1, id: "line", axes_id: "axis", props: {}, data: {} };
const context = (group: SVGGElement, type: string, data: Record<string, unknown>, props: Record<string, unknown> = {}) => ({
  group, artist: { ...artist, type, props }, data,
  x: createScale("linear", [-3, 3], [0, 600]), y: createScale("linear", [-3, 3], [600, 0]),
  width: 600, height: 600, theme: themes.light, selected: new Set<number>(), pointBudget: 2_000,
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
    const lines = svg("g");
    builtinRenderers["mplot.line"]!(context(lines, "mplot.line", { x: [-1, 0, 1], y: [0, 1, 0] }));
    expect(lines.querySelector("path")?.getAttribute("d")).toContain("L300.00,200.00");
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
});

describe("large data rendering", () => {
  it("limits line path complexity to the screen-space point budget", () => {
    const group = svg("g"), values = Array.from({ length: 100_000 }, (_, index) => index);
    builtinRenderers["mplot.line"]!({
      group, artist, data: { x: values, y: values }, x: createScale("linear", [0, 100_000], [0, 800]), y: createScale("linear", [0, 100_000], [600, 0]),
      width: 800, height: 600, theme: themes.light, selected: new Set(), pointBudget: 1_000, project3d: (x, y) => [x, y],
    });
    const path = group.querySelector("path")?.getAttribute("d") ?? "";
    expect((path.match(/[ML]/g) ?? [])).toHaveLength(1_000);
  });

  it("limits scatter DOM nodes to the screen-space point budget", () => {
    const group = svg("g"), values = Array.from({ length: 100_000 }, (_, index) => index);
    builtinRenderers["mplot.scatter"]!({
      group, artist: { ...artist, type: "mplot.scatter" }, data: { x: values, y: values }, x: createScale("linear", [0, 100_000], [0, 800]), y: createScale("linear", [0, 100_000], [600, 0]),
      width: 800, height: 600, theme: themes.light, selected: new Set(), pointBudget: 1_000, project3d: (x, y) => [x, y],
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
      width: 800, height: 600, theme: themes.light, selected: new Set(), pointBudget: 1_000, project3d: (x, y) => [x, y],
    });
    expect(group.querySelectorAll("image")).toHaveLength(1);
    expect(group.querySelectorAll("rect")).toHaveLength(0);
    expect(group.querySelector("image")?.getAttribute("href")).toBe("data:image/png;base64,test");
    expect(putImageData).toHaveBeenCalledOnce();
  });
});
