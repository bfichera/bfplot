export type NumberArray = number[] | Float32Array | Float64Array | Int32Array | Uint32Array | Uint8Array;

export interface ArrayReference {
  object: `sha256:${string}`;
  dtype: string;
  shape: number[];
  codec?: string;
}

export type DataValue = unknown | ArrayReference;

export interface Artist {
  type: string;
  id: string;
  axes_id: string;
  props: Record<string, unknown>;
  data: Record<string, DataValue>;
}

export type ScaleType = "linear" | "log" | "symlog" | "date" | "category";
export type AxisDimension = "x" | "y" | "z";

export interface Colorbar {
  orientation: "vertical" | "horizontal";
  label?: string;
  limits?: [number, number];
  ticks?: number[];
  ticklabels?: string[];
  cmap?: string;
  colors?: unknown[];
  mappable?: string;
}

export interface Axis {
  id: string;
  figure_id?: string;
  role?: "plot" | "colorbar" | "inset";
  parent_axes_id?: string;
  colorbar?: Colorbar;
  title?: string;
  xlabel?: string;
  ylabel?: string;
  zlabel?: string;
  xlim?: [number, number];
  ylim?: [number, number];
  zlim?: [number, number];
  xscale?: ScaleType;
  yscale?: ScaleType;
  zscale?: ScaleType;
  projection?: "2d" | "3d";
  position?: [number, number, number, number];
  props?: Record<string, unknown>;
}

export interface Figure {
  id: string;
  title?: string;
  name?: string;
  axes?: string[] | Axis[];
  size?: [number, number];
  props?: Record<string, unknown>;
}

export interface TimelineUpdate {
  target_kind: "artist" | "axes" | "figure";
  target: string;
  path: string[];
  value: unknown;
}

export interface TimelineFrame { time: number; updates: TimelineUpdate[]; }

export interface Timeline {
  fps: number;
  duration: number;
  loop?: boolean;
  frames: TimelineFrame[];
}

export interface MPlotDocument {
  title?: string;
  figures: Figure[];
  axes: Axis[];
  artists: Artist[];
  timeline?: Timeline;
  metadata?: Record<string, unknown>;
}

export interface Viewport {
  x: [number, number];
  y: [number, number];
  z?: [number, number];
}

export type ResolvedData = Record<string, unknown>;
export type ArrayResolver = (reference: ArrayReference) => Promise<unknown>;

export interface Theme {
  background: string;
  panel: string;
  foreground: string;
  muted: string;
  grid: string;
  accent: string;
  fontFamily: string;
}

export type ThemeName = "light" | "dark" | "auto";
