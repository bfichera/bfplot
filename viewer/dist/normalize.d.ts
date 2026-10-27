import type { ArrayReference, MPlotDocument, ResolvedData } from "./types.js";
/** Accepts both the nested document written by Python/Rust and the viewer's flat schema. */
export declare function normalizeDocument(value: unknown): MPlotDocument;
/** Adapts producer-specific array layouts after object references have been resolved. */
export declare function normalizeArtistData(type: string, source: Record<string, unknown>, resolved: ResolvedData): ResolvedData;
export declare function isArrayReference(value: unknown): value is ArrayReference;
