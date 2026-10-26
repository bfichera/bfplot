import type { ScaleType } from "./types.js";
export interface Scale {
    (value: number): number;
    invert(pixel: number): number;
    ticks(count?: number): number[];
}
export declare function createScale(type: ScaleType | undefined, domain: [number, number], range: [number, number]): Scale;
export declare function formatTick(value: number, type?: ScaleType): string;
