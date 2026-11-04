// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { applyTimelineUpdate, TimelineSet } from "./timeline.js";
import type { BFPlotDocument } from "./types.js";

const animatedDocument = (): BFPlotDocument => ({
  figures: [{ id: "figure", axes: ["axes"] }],
  axes: [{ id: "axes" }],
  artists: [
    {
      type: "bfplot.line",
     
      id: "line",
      axes_id: "axes",
      props: {},
      data: { y: [0, 1] },
    },
  ],
  timelines: [{
    figures: ["figure"],
    fps: 2,
    duration: 0.5,
    loop: false,
    frames: [
      {
        time: 0.5,
        updates: [
          {
            target_kind: "artist",
            target: "line",
            path: ["data", "y"],
            value: [1, 0],
          },
        ],
      },
    ],
  }],
});

const twoAnimations = (): BFPlotDocument => ({
  figures: [{ id: "a", axes: ["ax-a"] }, { id: "b", axes: ["ax-b"] }],
  axes: [{ id: "ax-a" }, { id: "ax-b" }],
  artists: [
    { type: "bfplot.line", id: "la", axes_id: "ax-a", props: {}, data: { y: [0] } },
    { type: "bfplot.line", id: "lb", axes_id: "ax-b", props: {}, data: { y: [0] } },
  ],
  timelines: [
    { figures: ["a"], fps: 2, duration: 0.5, frames: [{ time: 0.5, updates: [{ target_kind: "artist", target: "la", path: ["data", "y"], value: [1] }] }] },
    { figures: ["b"], fps: 1, duration: 2, frames: [{ time: 2, updates: [{ target_kind: "artist", target: "lb", path: ["data", "y"], value: [2] }] }] },
  ],
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("TimelineSet", () => {
  it("seeks from the immutable initial document", async () => {
    const rendered: BFPlotDocument[] = [];
    const player = new TimelineSet(animatedDocument(), async (document) => {
      rendered.push(document);
    });
    const controls = player.createControls()[0]!;
    document.body.append(controls);

    const range = controls.querySelector<HTMLInputElement>(".bfplot-timeline-range")!;
    range.value = "0.5";
    range.dispatchEvent(new Event("input"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(rendered.at(-1)?.artists[0]?.data.y).toEqual([1, 0]);

    range.value = "0";
    range.dispatchEvent(new Event("input"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(rendered.at(-1)?.artists[0]?.data.y).toEqual([0, 1]);
  });

  it("gives each timeline its own clock and controls", async () => {
    const rendered: BFPlotDocument[] = [];
    const set = new TimelineSet(twoAnimations(), async (document) => { rendered.push(document); });
    const [first, second] = set.createControls();
    expect(first!.dataset.figures).toBe("a");
    expect(second!.dataset.figures).toBe("b");
    expect(second!.querySelector(".bfplot-timeline-time")?.textContent).toBe("0.00 / 2.00 s");

    set.showFigure("a");
    expect(first!.hidden).toBe(false);
    expect(second!.hidden).toBe(true);

    const range = (controls: HTMLElement) => controls.querySelector<HTMLInputElement>(".bfplot-timeline-range")!;
    range(first!).value = "0.5"; range(first!).dispatchEvent(new Event("input")); await settle();
    expect(rendered.at(-1)?.artists.map((artist) => artist.data.y)).toEqual([[1], [0]]);

    range(second!).value = "2"; range(second!).dispatchEvent(new Event("input")); await settle();
    expect(rendered.at(-1)?.artists.map((artist) => artist.data.y)).toEqual([[1], [2]]);
    expect(first!.querySelector(".bfplot-timeline-time")?.textContent).toBe("0.50 / 0.50 s");
  });

  it("applies only the requested semantic replacement", () => {
    const document = animatedDocument();
    applyTimelineUpdate(document, {
      target_kind: "axes",
      target: "axes",
      path: ["title"],
      value: "Updated",
    });
    expect(document.axes[0]?.title).toBe("Updated");
    expect(document.artists[0]?.data.y).toEqual([0, 1]);
  });
});
