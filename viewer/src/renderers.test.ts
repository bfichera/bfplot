// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { builtinRenderers } from "./renderers.js";
import { createScale } from "./scales.js";
import { svg } from "./svg.js";
import { themes } from "./theme.js";

const artist = { type: "mplot.line", schema_version: 1, id: "line", axes_id: "axis", props: {}, data: {} };

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
