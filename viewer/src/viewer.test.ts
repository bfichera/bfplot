// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { MPlotViewer } from "./viewer.js";
import type { MPlotDocument } from "./types.js";

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
    expect(host.querySelector('[data-artist-id="line"] path')).not.toBeNull();
    expect(host.textContent).toContain("Unknown: org.example.missing");
    expect(viewer.exportSVG()).toContain("Scientific plot");
    viewer.destroy();
  });

  it("allows explicit plugin renderer registration", async () => {
    const host = window.document.createElement("div");
    const viewer = new MPlotViewer(host, document);
    viewer.registerRenderer("org.example.missing", ({ group }) => group.setAttribute("data-plugin", "yes"));
    await viewer.render();
    expect(host.querySelector('[data-plugin="yes"]')).not.toBeNull();
  });
});
