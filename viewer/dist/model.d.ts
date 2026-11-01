import type { ArrayResolver, Axis, Artist, BFPlotDocument, ResolvedData, Viewport } from "./types.js";
export declare class ViewerModel extends EventTarget {
    document: BFPlotDocument;
    readonly viewports: Map<string, Viewport>;
    private resolver;
    private readonly dataCache;
    private activeResolutions;
    private readonly resolutionQueue;
    private readonly resolutionLimit;
    constructor(document: BFPlotDocument, resolver?: ArrayResolver);
    setDocument(document: BFPlotDocument): void;
    setResolver(resolver?: ArrayResolver): void;
    resetViewports(clear?: boolean): void;
    fitViewports(clear?: boolean, axisIds?: Iterable<string>): Promise<void>;
    fitViewport(axisId: string): Promise<void>;
    defaultViewport(axis: Axis): Viewport;
    private resolvedViewport;
    private paddedBounds;
    setViewport(axisId: string, viewport: Viewport, source?: string): void;
    resolveData(data: Record<string, unknown>, artist?: Artist): Promise<ResolvedData>;
    private resolveValue;
    private withResolutionSlot;
}
