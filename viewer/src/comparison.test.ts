import { describe, expect, it } from "vitest";
import { fitLineViewport, LineComparison } from "./comparison.js";
import type { BFPlotDocument } from "./types.js";

const document: BFPlotDocument = {
  figures: [{ id: "f1", axes: ["a1"] }, { id: "f2", axes: ["a2", "a3"] }],
  axes: [
    { id: "a1", xscale: "linear", yscale: "linear" },
    { id: "a2", xscale: "linear", yscale: "linear" },
    { id: "a3", xscale: "linear", yscale: "log" },
  ],
  artists: [
    { type: "bfplot.line", id: "one", axes_id: "a1", props: {}, data: {} },
    { type: "bfplot.line", id: "two", axes_id: "a2", props: {}, data: {} },
    { type: "bfplot.line", id: "log", axes_id: "a3", props: {}, data: {} },
    { type: "bfplot.scatter", id: "dots", axes_id: "a1", props: {}, data: {} },
  ],
};

describe("LineComparison", () => {
  it("selects compatible lines across figures without mutating them", () => {
    const comparison = new LineComparison();
    expect(comparison.toggle(document, "one").selected).toBe(true);
    expect(comparison.toggle(document, "two").selected).toBe(true);
    expect(comparison.artists(document).map((artist) => artist.id)).toEqual(["one", "two"]);
    expect(document.artists.every((artist) => artist.axes_id !== "__comparison-axis__")).toBe(true);
  });

  it("rejects non-lines and incompatible scale types", () => {
    const comparison = new LineComparison();
    comparison.toggle(document, "one");
    expect(comparison.toggle(document, "dots").message).toContain("Only 2D line");
    expect(comparison.toggle(document, "log").message).toContain("linear/log");
    expect(comparison.selectedIds).toEqual(new Set(["one"]));
  });

  it("fits a padded viewport to every selected line", () => {
    expect(fitLineViewport([
      { x: [0, 2], y: [10, 20] },
      { x: [-2, 1], y: [5, 30] },
    ])).toEqual({ x: [-2.16, 2.16], y: [4, 31] });
  });
});
