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
    selected: ReadonlySet<number>;
    pointBudget: number;
    project3d(x: number, y: number, z: number): [number, number];
}
export type ArtistRenderer = (context: RenderContext) => void | Promise<void>;
export declare const builtinRenderers: Readonly<Record<string, ArtistRenderer>>;
