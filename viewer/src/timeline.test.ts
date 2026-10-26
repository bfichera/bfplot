// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { applyTimelineUpdate, TimelinePlayer } from "./timeline.js";
import type { MPlotDocument } from "./types.js";

const animatedDocument = (): MPlotDocument => ({
  figures: [{ id: "figure", axes: ["axes"] }],
  axes: [{ id: "axes" }],
  artists: [
    {
      type: "mplot.line",
      schema_version: 1,
      id: "line",
      axes_id: "axes",
      props: {},
      data: { y: [0, 1] },
    },
  ],
  timeline: {
    version: 1,
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
  },
});

describe("TimelinePlayer", () => {
  it("seeks from the immutable initial document", async () => {
    const rendered: MPlotDocument[] = [];
    const player = new TimelinePlayer(animatedDocument(), async (document) => {
      rendered.push(document);
    });
    const controls = player.createControls()!;
    document.body.append(controls);

    const range = controls.querySelector<HTMLInputElement>(".mplot-timeline-range")!;
    range.value = "0.5";
    range.dispatchEvent(new Event("input"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(rendered.at(-1)?.artists[0]?.data.y).toEqual([1, 0]);

    range.value = "0";
    range.dispatchEvent(new Event("input"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(rendered.at(-1)?.artists[0]?.data.y).toEqual([0, 1]);
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
