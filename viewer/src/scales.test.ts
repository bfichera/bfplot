import { describe, expect, it } from "vitest";
import { createScale, formatTick } from "./scales.js";

describe("scales", () => {
  it("maps and inverts linear domains", () => {
    const scale = createScale("linear", [0, 10], [20, 120]);
    expect(scale(5)).toBe(70);
    expect(scale.invert(95)).toBe(7.5);
    expect(scale.ticks()).toContain(10);
  });

  it("supports logarithmic and symlog values", () => {
    const log = createScale("log", [1, 100], [0, 2]);
    expect(log(10)).toBeCloseTo(1);
    expect(log.invert(1)).toBeCloseTo(10);
    const symlog = createScale("symlog", [-1_000, 1_000], [0, 100]);
    expect(symlog(0)).toBeCloseTo(50);
    expect(symlog.ticks()).toEqual([-1_000, -100, -10, -1, 0, 1, 10, 100, 1_000]);
  });

  it("formats scientific and date ticks", () => {
    expect(formatTick(1e8)).toContain("e+");
    expect(formatTick(20_454, "date", "%b %d")).toBe("Jan 01");
  });
});
