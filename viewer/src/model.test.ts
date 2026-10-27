import { describe, expect, it, vi } from "vitest";
import { ViewerModel } from "./model.js";
import type { BFPlotDocument } from "./types.js";

const document: BFPlotDocument = {
  figures: [{ id: "figure", axes: ["a", "b"] }],
  axes: [{ id: "a", xlim: [0, 10], ylim: [0, 5] }, { id: "b", xlim: [0, 20], ylim: [-1, 1] }],
  artists: [],
};

describe("ViewerModel", () => {
  it("changes only the requested viewport and reports it", () => {
    const model = new ViewerModel(document), listener = vi.fn();
    model.addEventListener("viewport", listener);
    model.setViewport("a", { x: [2, 4], y: [1, 2] });
    expect(model.viewports.get("a")).toEqual({ x: [2, 4], y: [1, 2] });
    expect(model.viewports.get("b")).toEqual({ x: [0, 20], y: [-1, 1] });
    expect((listener.mock.calls[0]?.[0] as CustomEvent).detail.axisId).toBe("a");
  });

  it("fits and resets object-backed data when explicit limits are absent", async () => {
    const xref = { object: `sha256:${"b".repeat(64)}` as const, dtype: "f8", shape: [3] };
    const yref = { object: `sha256:${"c".repeat(64)}` as const, dtype: "f8", shape: [3] };
    const resolver = vi.fn(async (reference: typeof xref) => reference.object === xref.object ? new Float64Array([10, 20, 30]) : new Float64Array([-5, 0, 5]));
    const autoscaleDocument: BFPlotDocument = {
      figures: [{ id: "figure", axes: ["a"] }], axes: [{ id: "a" }],
      artists: [{ type: "bfplot.line", id: "line", axes_id: "a", props: {}, data: { x: xref, y: yref } }],
    };
    const model = new ViewerModel(autoscaleDocument, resolver);
    await model.fitViewports();
    expect(model.viewports.get("a")?.x).toEqual([9.2, 30.8]);
    expect(model.viewports.get("a")?.y).toEqual([-5.4, 5.4]);
    model.setViewport("a", { x: [15, 16], y: [1, 2] });
    await model.fitViewports();
    expect(model.viewports.get("a")?.x).toEqual([9.2, 30.8]);
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
