import type { Artist, ResolvedData, Theme } from "./types.js";
import type { Scale } from "./scales.js";
export interface RenderContext {
    group: SVGGElement;
    artist: Artist;
    data: ResolvedData;
    x: Scale;
    y: Scale;
    width: number;
    height: number;
    theme: Theme;
    pointBudget: number;
    project3d(x: number, y: number, z: number): [number, number];
    /** Distance toward the viewer; larger values are nearer. */
    depth3d?(x: number, y: number, z: number): number;
}
export type ArtistRenderer = (context: RenderContext) => void | Promise<void>;
export declare const PLOT_TEXT_SIZE = 15;
export declare const builtinRenderers: Readonly<Record<string, ArtistRenderer>>;
