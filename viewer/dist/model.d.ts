import type { ArrayResolver, Axis, Artist, MPlotDocument, PointSelection, ResolvedData, Viewport } from "./types.js";
export declare class ViewerModel extends EventTarget {
    document: MPlotDocument;
    readonly viewports: Map<string, Viewport>;
    readonly selections: Map<string, PointSelection[]>;
    private resolver;
    private readonly dataCache;
    constructor(document: MPlotDocument, resolver?: ArrayResolver);
    setDocument(document: MPlotDocument): void;
    setResolver(resolver?: ArrayResolver): void;
    resetViewports(clear?: boolean): void;
    defaultViewport(axis: Axis): Viewport;
    setViewport(axisId: string, viewport: Viewport, source?: string): void;
    private copyDimension;
    setSelection(id: string, points: PointSelection[]): void;
    resolveData(data: Record<string, unknown>, artist?: Artist): Promise<ResolvedData>;
    private resolveValue;
}
