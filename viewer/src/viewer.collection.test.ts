// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { MPlotViewer } from "./viewer.js";
import type { MPlotDocument } from "./types.js";

const manyPlots = (): MPlotDocument => ({
  title: "Large study",
  figures: [
    { id: "f1", title: "Overview", axes: ["a1", "a2"], size: [800, 500] },
    { id: "f2", title: "Details", axes: ["a3"], size: [600, 600] },
  ],
  axes: [
    { id: "a1", figure_id: "f1", title: "Main", position: [.08, .12, .55, .8], xlim: [0, 2], ylim: [0, 4] },
    { id: "a2", figure_id: "f1", title: "Inset", position: [.7, .55, .25, .35], xlim: [0, 2], ylim: [0, 4] },
    { id: "a3", figure_id: "f2", title: "Independent", position: [.1, .1, .8, .8], xlim: [0, 2], ylim: [0, 4] },
  ],
  artists: ["a1", "a2", "a3"].map((axes_id, index) => ({
    type: "mplot.line", schema_version: 1, id: `line-${index}`, axes_id, props: {}, data: { x: [0, 1, 2], y: [index, index + 1, index + 2] },
  })),
});

class DeferredIntersectionObserver {
  static instances: DeferredIntersectionObserver[] = [];
  readonly observed: Element[] = [];
  constructor(private readonly callback: IntersectionObserverCallback) { DeferredIntersectionObserver.instances.push(this); }
  observe = (element: Element): void => { this.observed.push(element); };
  unobserve = (): void => undefined;
  disconnect = (): void => undefined;
  takeRecords = (): IntersectionObserverEntry[] => [];
  readonly root = null;
  readonly rootMargin = "600px 0px";
  readonly thresholds = [0];
  trigger(element: Element): void { this.callback([{ target: element, isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver); }
}

class ControlledResizeObserver {
  static instance: ControlledResizeObserver | undefined;
  readonly observed: Element[] = [];
  constructor(private readonly callback: ResizeObserverCallback) { ControlledResizeObserver.instance = this; }
  observe = (element: Element): void => { this.observed.push(element); };
  unobserve = (): void => undefined;
  disconnect = (): void => undefined;
  trigger(element: Element, width: number, height: number): void { this.callback([{ target: element, contentRect: { width, height } } as ResizeObserverEntry], this as unknown as ResizeObserver); }
}

describe("large plot collections", () => {
  it("reconstructs saved axes geometry and provides figure navigation", async () => {
    const original = globalThis.IntersectionObserver;
    try {
      globalThis.IntersectionObserver = DeferredIntersectionObserver as unknown as typeof IntersectionObserver;
      const host = document.createElement("div"), viewer = new MPlotViewer(host, manyPlots());
      await viewer.render();
      expect(host.querySelectorAll(".mplot-figure")).toHaveLength(2);
      expect(host.querySelectorAll(".mplot-page-list [data-figure-id]")).toHaveLength(2);
      const main = host.querySelector<HTMLElement>('[data-axes-id="a1"]')!;
      const inset = host.querySelector<HTMLElement>('[data-axes-id="a2"]')!;
      expect(main.style.left).toBe("8%");
      expect(parseFloat(main.style.width)).toBeCloseTo(55);
      expect(parseFloat(inset.style.top)).toBeCloseTo(10);
      viewer.destroy();
    } finally { globalThis.IntersectionObserver = original; }
  });

  it("leaves axes unrendered until they approach the viewport", async () => {
    DeferredIntersectionObserver.instances.length = 0;
    const original = globalThis.IntersectionObserver;
    try {
      globalThis.IntersectionObserver = DeferredIntersectionObserver as unknown as typeof IntersectionObserver;
      const host = document.createElement("div"), viewer = new MPlotViewer(host, manyPlots());
      await viewer.render();
      const axis = host.querySelector<HTMLElement>('[data-axes-id="a3"]')!;
      expect(axis.classList.contains("mplot-axis--pending")).toBe(true);
      expect(axis.querySelector("svg")).toBeNull();
      host.querySelector<HTMLButtonElement>('[data-figure-id="f2"]')!.click();
      await vi.waitFor(() => expect(axis.querySelector("svg")).not.toBeNull());
      expect(axis.classList.contains("mplot-axis--pending")).toBe(false);
      viewer.destroy();
    } finally { globalThis.IntersectionObserver = original; }
  });

  it("shows figures as separate pages and mounts the selected page", async () => {
    DeferredIntersectionObserver.instances.length = 0;
    const original = globalThis.IntersectionObserver;
    try {
      globalThis.IntersectionObserver = DeferredIntersectionObserver as unknown as typeof IntersectionObserver;
      const host = document.createElement("div"), viewer = new MPlotViewer(host, manyPlots());
      await viewer.render();
      const figures = host.querySelectorAll<HTMLElement>(".mplot-figure");
      expect(figures[0]!.hidden).toBe(false);
      expect(figures[1]!.hidden).toBe(true);
      const secondPage = host.querySelector<HTMLButtonElement>('[data-figure-id="f2"]')!;
      secondPage.click();
      await vi.waitFor(() => expect(figures[1]!.hidden).toBe(false));
      expect(figures[0]!.hidden).toBe(true);
      expect(secondPage.getAttribute("aria-current")).toBe("page");
      expect(host.querySelector('[data-axes-id="a3"] svg')).not.toBeNull();
      expect(host.querySelector<HTMLElement>(".mplot-header")!.classList.contains("mplot-header")).toBe(true);
      viewer.destroy();
    } finally { globalThis.IntersectionObserver = original; }
  });

  it("ignores resize churn from hidden figure pages", async () => {
    const originalIntersection = globalThis.IntersectionObserver, originalResize = globalThis.ResizeObserver;
    try {
      globalThis.IntersectionObserver = undefined as unknown as typeof IntersectionObserver;
      globalThis.ResizeObserver = ControlledResizeObserver as unknown as typeof ResizeObserver;
      const host = document.createElement("div"), viewer = new MPlotViewer(host, manyPlots());
      await viewer.render();
      const firstAxis = host.querySelector<HTMLElement>('[data-axes-id="a1"]')!;
      const originalPath = firstAxis.querySelector("path")?.getAttribute("d");
      host.querySelector<HTMLButtonElement>('[data-figure-id="f2"]')!.click();
      await vi.waitFor(() => expect(host.querySelector('[data-axes-id="a3"] svg')).not.toBeNull());
      ControlledResizeObserver.instance!.trigger(firstAxis, 0, 0);
      await Promise.resolve();
      expect(firstAxis.querySelector("path")?.getAttribute("d")).toBe(originalPath);
      viewer.destroy();
    } finally { globalThis.IntersectionObserver = originalIntersection; globalThis.ResizeObserver = originalResize; }
  });

  it("exports an individual plot, figure layout, or entire artifact", async () => {
    const original = globalThis.IntersectionObserver;
    try {
      globalThis.IntersectionObserver = undefined as unknown as typeof IntersectionObserver;
      const host = document.createElement("div"), viewer = new MPlotViewer(host, manyPlots());
      await viewer.render();
      const axisSvg = viewer.exportSVG("axis", "a1");
      const figureSvg = viewer.exportSVG("figure", "f1");
      const artifactSvg = viewer.exportSVG("artifact");
      expect(axisSvg).toContain('aria-label="Main"');
      expect(figureSvg).toContain("translate(");
      expect(artifactSvg.match(/translate\(/g)?.length).toBeGreaterThan(1);
      viewer.destroy();
    } finally { globalThis.IntersectionObserver = original; }
  });
});
