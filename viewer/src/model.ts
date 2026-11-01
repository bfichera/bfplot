import { isArrayReference, normalizeArtistData } from "./normalize.js";
import type { ArrayResolver, Axis, Artist, BFPlotDocument, ResolvedData, Viewport } from "./types.js";
const cloneViewport = (value: Viewport): Viewport => ({ x: [...value.x], y: [...value.y], ...(value.z ? { z: [...value.z] } : {}) } as Viewport);
const numbers = (value: unknown): number[] => Array.isArray(value) || ArrayBuffer.isView(value) ? Array.from(value as ArrayLike<unknown>, Number).filter(Number.isFinite) : [];
const pointValues = (value: unknown, dimension: 0 | 1 | 2): number[] => {
  if (!Array.isArray(value)) return [];
  if (value.length > dimension && value.every((item) => typeof item === "number")) {
    const coordinate = Number(value[dimension]);
    return Number.isFinite(coordinate) ? [coordinate] : [];
  }
  return value.flatMap((item) => pointValues(item, dimension));
};

function dataValues(data: ResolvedData, dimension: "x" | "y" | "z"): number[] {
  const index = dimension === "x" ? 0 : dimension === "y" ? 1 : 2;
  const values = numbers(data[dimension]);
  for (const key of ["xy", "points", "vertices", "path", "paths", "segments", "error_paths", "cap_paths"]) values.push(...pointValues(data[key], index));
  if (dimension !== "z") {
    for (const rectangle of Array.isArray(data.rects) ? data.rects : []) {
      if (!Array.isArray(rectangle)) continue;
      const start = Number(rectangle[index]), size = Number(rectangle[index + 2]);
      if (Number.isFinite(start)) values.push(start);
      if (Number.isFinite(start) && Number.isFinite(size)) values.push(start + size);
    }
    const extent = numbers(data.extent);
    if (extent.length >= 4) values.push(...(dimension === "x" ? extent.slice(0, 2) : extent.slice(2, 4)));
  }
  return values.filter(Number.isFinite);
}

export class ViewerModel extends EventTarget {
  document: BFPlotDocument;
  readonly viewports = new Map<string, Viewport>();
  private resolver: ArrayResolver | undefined;
  private readonly dataCache = new Map<string, Promise<unknown>>();
  private activeResolutions = 0;
  private readonly resolutionQueue: Array<() => void> = [];
  private readonly resolutionLimit = 6;

  constructor(document: BFPlotDocument, resolver?: ArrayResolver) {
    super();
    this.document = document;
    this.resolver = resolver;
    this.resetViewports();
  }

  setDocument(document: BFPlotDocument): void {
    this.document = document;
    const valid = new Set(document.axes.map((axis) => axis.id));
    for (const key of this.viewports.keys()) if (!valid.has(key)) this.viewports.delete(key);
    this.resetViewports(false);
    this.dispatchEvent(new Event("change"));
  }

  setResolver(resolver?: ArrayResolver): void { this.resolver = resolver; this.dataCache.clear(); }

  resetViewports(clear = true): void {
    if (clear) this.viewports.clear();
    for (const axis of this.document.axes) if (!this.viewports.has(axis.id)) this.viewports.set(axis.id, this.defaultViewport(axis));
  }

  async fitViewports(clear = true, axisIds?: Iterable<string>): Promise<void> {
    if (clear) this.viewports.clear();
    const requested = axisIds ? new Set(axisIds) : undefined;
    await Promise.all(this.document.axes.filter((axis) => !requested || requested.has(axis.id)).map(async (axis) => {
      if (!this.viewports.has(axis.id)) this.viewports.set(axis.id, await this.resolvedViewport(axis));
    }));
  }

  async fitViewport(axisId: string): Promise<void> {
    const axis = this.document.axes.find((item) => item.id === axisId);
    if (axis) this.viewports.set(axis.id, await this.resolvedViewport(axis));
  }

  defaultViewport(axis: Axis): Viewport {
    const artists = this.document.artists.filter((artist) => artist.axes_id === axis.id && artist.props.visible !== false);
    const bounds = (dimension: "x" | "y" | "z"): [number, number] => this.paddedBounds(artists.flatMap((artist) => dataValues(artist.data, dimension)));
    return { x: axis.xlim ? [...axis.xlim] : bounds("x"), y: axis.ylim ? [...axis.ylim] : bounds("y"), ...(axis.zlim ? { z: [...axis.zlim] } : axis.projection === "3d" ? { z: bounds("z") } : {}) };
  }

  private async resolvedViewport(axis: Axis): Promise<Viewport> {
    const artists = this.document.artists.filter((artist) => artist.axes_id === axis.id && artist.props.visible !== false);
    if (axis.xlim && axis.ylim && (axis.projection !== "3d" || axis.zlim)) return { x: [...axis.xlim], y: [...axis.ylim], ...(axis.zlim ? { z: [...axis.zlim] } : {}) };
    const data = await Promise.all(artists.map((artist) => this.resolveData(artist.data, artist)));
    const bounds = (dimension: "x" | "y" | "z"): [number, number] => this.paddedBounds(data.flatMap((item) => dataValues(item, dimension)));
    return { x: axis.xlim ? [...axis.xlim] : bounds("x"), y: axis.ylim ? [...axis.ylim] : bounds("y"), ...(axis.zlim ? { z: [...axis.zlim] } : axis.projection === "3d" ? { z: bounds("z") } : {}) };
  }

  private paddedBounds(values: number[]): [number, number] {
    if (!values.length) return [0, 1];
    const lo = Math.min(...values), hi = Math.max(...values), pad = (hi - lo || Math.max(Math.abs(lo), 1)) * 0.04;
    return [lo - pad, hi + pad];
  }

  setViewport(axisId: string, viewport: Viewport, source = axisId): void {
    this.viewports.set(axisId, cloneViewport(viewport));
    this.dispatchEvent(new CustomEvent("viewport", { detail: { axisId, source } }));
  }

  async resolveData(data: Record<string, unknown>, artist?: Artist): Promise<ResolvedData> {
    const entries = await Promise.all(Object.entries(data).map(async ([key, value]) => [key, await this.resolveValue(value)] as const));
    const resolved = Object.fromEntries(entries);
    return artist ? normalizeArtistData(artist.type, data, resolved) : resolved;
  }

  private async resolveValue(value: unknown): Promise<unknown> {
    if (isArrayReference(value)) {
      if (!this.resolver) return value;
      let pending = this.dataCache.get(value.object);
      if (!pending) { pending = this.withResolutionSlot(() => this.resolver!(value)); this.dataCache.set(value.object, pending); }
      return pending;
    }
    if (Array.isArray(value)) return Promise.all(value.map((item) => this.resolveValue(item)));
    if (value && typeof value === "object") {
      const entries = await Promise.all(Object.entries(value as Record<string, unknown>).map(async ([key, item]) => [key, await this.resolveValue(item)]));
      return Object.fromEntries(entries);
    }
    return value;
  }

  private async withResolutionSlot<T>(operation: () => Promise<T>): Promise<T> {
    if (this.activeResolutions >= this.resolutionLimit) await new Promise<void>((resolve) => this.resolutionQueue.push(resolve));
    this.activeResolutions += 1;
    try { return await operation(); }
    finally { this.activeResolutions -= 1; this.resolutionQueue.shift()?.(); }
  }
}
