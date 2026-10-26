import { describe, expect, it, vi } from "vitest";
import { ViewerModel } from "./model.js";
import type { MPlotDocument } from "./types.js";

const document: MPlotDocument = {
  figures: [{ id: "figure", axes: ["a", "b"] }],
  axes: [{ id: "a", xlim: [0, 10], ylim: [0, 5] }, { id: "b", xlim: [0, 20], ylim: [-1, 1] }],
  artists: [],
  links: [{ axes: ["a", "b"], dimensions: ["x"] }],
};

describe("ViewerModel", () => {
  it("propagates linked dimensions without replacing unlinked ranges", () => {
    const model = new ViewerModel(document);
    model.setViewport("a", { x: [2, 4], y: [1, 2] });
    expect(model.viewports.get("b")).toEqual({ x: [2, 4], y: [-1, 1] });
  });

  it("resolves and caches immutable objects", async () => {
    const resolver = vi.fn(async () => new Float64Array([1, 2]));
    const model = new ViewerModel(document, resolver);
    const ref = { object: `sha256:${"a".repeat(64)}` as const, dtype: "f8", shape: [2] };
    const [a, b] = await Promise.all([model.resolveData({ x: ref }), model.resolveData({ x: ref })]);
    expect(a.x).toEqual(new Float64Array([1, 2]));
    expect(b.x).toBe(a.x);
    expect(resolver).toHaveBeenCalledOnce();
  });
});
