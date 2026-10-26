import type { ArrayReference, ArrayResolver, Axis, AxisDimension, MPlotDocument, PointSelection, ResolvedData, Viewport } from "./types.js";

const isReference = (value: unknown): value is ArrayReference => !!value && typeof value === "object" && typeof (value as ArrayReference).object === "string" && (value as ArrayReference).object.startsWith("sha256:");
const cloneViewport = (value: Viewport): Viewport => ({ x: [...value.x], y: [...value.y], ...(value.z ? { z: [...value.z] } : {}) } as Viewport);

export class ViewerModel extends EventTarget {
  document: MPlotDocument;
  readonly viewports = new Map<string, Viewport>();
  readonly selections = new Map<string, PointSelection[]>();
  private resolver: ArrayResolver | undefined;
  private readonly dataCache = new Map<string, Promise<unknown>>();

  constructor(document: MPlotDocument, resolver?: ArrayResolver) {
    super();
    this.document = document;
    this.resolver = resolver;
    this.resetViewports();
  }

  setDocument(document: MPlotDocument): void {
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

  defaultViewport(axis: Axis): Viewport {
    const artists = this.document.artists.filter((artist) => artist.axes_id === axis.id);
    const bounds = (key: string): [number, number] => {
      const values = artists.flatMap((artist) => {
        const value = artist.data[key];
        return Array.isArray(value) || ArrayBuffer.isView(value) ? Array.from(value as ArrayLike<unknown>, Number).filter(Number.isFinite) : [];
      });
      if (!values.length) return [0, 1];
      const lo = Math.min(...values), hi = Math.max(...values), pad = (hi - lo || 1) * 0.04;
      return [lo - pad, hi + pad];
    };
    return { x: axis.xlim ? [...axis.xlim] : bounds("x"), y: axis.ylim ? [...axis.ylim] : bounds("y"), ...(axis.zlim ? { z: [...axis.zlim] } : {}) };
  }

  setViewport(axisId: string, viewport: Viewport, source = axisId): void {
    this.viewports.set(axisId, cloneViewport(viewport));
    for (const link of this.document.links ?? []) {
      const members = link.axes ?? link.axis_ids ?? [];
      if (!members.includes(axisId)) continue;
      const dimensions = link.dimensions ?? (Array.isArray(link.dimension) ? link.dimension : [link.dimension ?? "x"]);
      for (const member of members) {
        if (member === axisId) continue;
        const current = this.viewports.get(member);
        if (!current) continue;
        const next = cloneViewport(current);
        for (const dimension of dimensions) this.copyDimension(next, viewport, dimension);
        this.viewports.set(member, next);
      }
    }
    this.dispatchEvent(new CustomEvent("viewport", { detail: { axisId, source } }));
  }

  private copyDimension(target: Viewport, source: Viewport, dimension: AxisDimension): void {
    if (dimension === "x") target.x = [...source.x];
    else if (dimension === "y") target.y = [...source.y];
    else if (source.z) target.z = [...source.z];
  }

  setSelection(id: string, points: PointSelection[]): void {
    this.selections.set(id, points.map((point) => ({ artistId: point.artistId, indices: [...point.indices] })));
    this.dispatchEvent(new CustomEvent("selection", { detail: { id, points } }));
  }

  async resolveData(data: Record<string, unknown>): Promise<ResolvedData> {
    const entries = await Promise.all(Object.entries(data).map(async ([key, value]) => [key, await this.resolveValue(value)] as const));
    return Object.fromEntries(entries);
  }

  private async resolveValue(value: unknown): Promise<unknown> {
    if (isReference(value)) {
      if (!this.resolver) return value;
      let pending = this.dataCache.get(value.object);
      if (!pending) { pending = this.resolver(value); this.dataCache.set(value.object, pending); }
      return pending;
    }
    if (Array.isArray(value)) return Promise.all(value.map((item) => this.resolveValue(item)));
    if (value && typeof value === "object") {
      const entries = await Promise.all(Object.entries(value as Record<string, unknown>).map(async ([key, item]) => [key, await this.resolveValue(item)]));
      return Object.fromEntries(entries);
    }
    return value;
  }
}
