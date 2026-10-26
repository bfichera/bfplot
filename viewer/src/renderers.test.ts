// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
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
});
