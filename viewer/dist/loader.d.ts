import type { ArrayReference, ArrayResolver, BFPlotDocument } from "./types.js";
export interface LoadOptions extends RequestInit {
    documentUrl?: string;
    objectBaseUrl?: string;
}
export declare function decodeArray(reference: ArrayReference, stored: Uint8Array): ArrayBufferView;
export declare function createHttpArrayResolver(objectBaseUrl?: string, init?: RequestInit): ArrayResolver;
export declare function loadDocument(options?: LoadOptions): Promise<BFPlotDocument>;
