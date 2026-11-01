import type { Artist, Axis, BFPlotDocument, ScaleType, Viewport } from "./types.js";
export interface ComparisonSelectionResult {
    selected: boolean;
    message?: string;
}
/** Tracks an ephemeral set of compatible line artists without changing the document. */
export declare class LineComparison {
    readonly selectedIds: Set<string>;
    open: boolean;
    message: string;
    get active(): boolean;
    toggle(document: BFPlotDocument, artistId: string): ComparisonSelectionResult;
    artists(document: BFPlotDocument): Artist[];
    sourceAxis(document: BFPlotDocument): Axis | undefined;
    clear(): void;
}
export declare function fitLineViewport(data: Array<Record<string, unknown>>, xscale?: ScaleType, yscale?: ScaleType): Viewport;
