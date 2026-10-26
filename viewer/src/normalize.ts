import type { ArrayReference, Artist, Axis, Figure, MPlotDocument, ResolvedData, ScaleType } from "./types.js";

type JsonObject = Record<string, unknown>;

const record = (value: unknown): JsonObject => value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const text = (value: unknown, fallback = ""): string => typeof value === "string" ? value : fallback;
const pair = (value: unknown): [number, number] | undefined => Array.isArray(value) && value.length >= 2 && value.slice(0, 2).every((item) => typeof item === "number") ? [value[0] as number, value[1] as number] : undefined;
const quad = (value: unknown): [number, number, number, number] | undefined => Array.isArray(value) && value.length >= 4 && value.slice(0, 4).every((item) => typeof item === "number") ? value.slice(0, 4) as [number, number, number, number] : undefined;
const scale = (value: unknown): ScaleType => ["linear", "log", "symlog", "date", "category"].includes(String(value)) ? value as ScaleType : "linear";

function rgba(value: unknown): unknown {
  if (!Array.isArray(value) || value.length < 3 || !value.slice(0, 3).every((item) => typeof item === "number")) return value;
  const [r, g, b, a = 1] = value as number[];
  const channel = (item: number) => Math.round(Math.max(0, Math.min(1, item)) * 255);
  return `rgba(${channel(r!)}, ${channel(g!)}, ${channel(b!)}, ${Math.max(0, Math.min(1, a!))})`;
}

function normalizeProps(value: unknown): JsonObject {
  const props = { ...record(value) };
  for (const key of ["color", "facecolor", "edgecolor"]) if (key in props) props[key] = rgba(props[key]);
  for (const key of ["facecolors", "edgecolors"]) if (Array.isArray(props[key])) props[key] = (props[key] as unknown[]).map(rgba);
  if (props.size !== undefined && props.fontsize === undefined) props.fontsize = props.size;
  if (props.horizontalalignment !== undefined && props.align === undefined) {
    props.align = props.horizontalalignment === "center" ? "middle" : props.horizontalalignment === "right" ? "end" : "start";
  }
  return props;
}

function normalizeAxis(rawValue: unknown, figureId: string): Axis {
  const raw = record(rawValue), props = record(raw.props), source = { ...props, ...raw };
  const x = record(source.x), y = record(source.y), z = record(source.z);
  const projection = source.projection === "3d" ? "3d" : "2d";
  return {
    id: text(source.id), figure_id: figureId,
    ...(text(source.title) ? { title: text(source.title) } : {}),
    ...(text(x.label) ? { xlabel: text(x.label) } : {}),
    ...(text(y.label) ? { ylabel: text(y.label) } : {}),
    ...(text(z.label) ? { zlabel: text(z.label) } : {}),
    ...(pair(x.limits) ? { xlim: pair(x.limits)! } : {}),
    ...(pair(y.limits) ? { ylim: pair(y.limits)! } : {}),
    ...(pair(z.limits) ? { zlim: pair(z.limits)! } : {}),
    xscale: scale(x.scale), yscale: scale(y.scale), zscale: scale(z.scale), projection,
    ...(quad(source.bounds) ? { position: quad(source.bounds)! } : {}), props: normalizeProps(props),
  };
}

function normalizeArtist(rawValue: unknown, axesId: string): Artist {
  const raw = record(rawValue);
  return {
    type: text(raw.type, "mplot.unknown"), schema_version: Number(raw.schema_version ?? 1), id: text(raw.id),
    axes_id: text(raw.axes_id, axesId), props: normalizeProps(raw.props), data: { ...record(raw.data) },
  };
}

/** Accepts both the nested artifact schema emitted by Python/Rust and the viewer's flat schema. */
export function normalizeDocument(value: unknown): MPlotDocument {
  const raw = record(value), figures: Figure[] = [], axes: Axis[] = [], artists: Artist[] = [];
  for (const [figureIndex, figureValue] of list(raw.figures).entries()) {
    const figureRaw = record(figureValue), props = record(figureRaw.props), source = { ...props, ...figureRaw };
    const figureId = text(source.id, `figure-${figureIndex}`), axisIds: string[] = [];
    for (const [axisIndex, axisValue] of list(source.axes).entries()) {
      if (typeof axisValue === "string") { axisIds.push(axisValue); continue; }
      const axis = normalizeAxis(axisValue, figureId); if (!axis.id) axis.id = `${figureId}-axes-${axisIndex}`;
      axisIds.push(axis.id); axes.push(axis);
      const axisRaw = record(axisValue), axisSource = { ...record(axisRaw.props), ...axisRaw };
      for (const artistValue of list(axisSource.artists)) artists.push(normalizeArtist(artistValue, axis.id));
    }
    const sizeInches = pair(source.size_inches), dpi = Number(source.dpi ?? 100);
    figures.push({ id: figureId, ...(text(source.title) ? { title: text(source.title) } : {}), axes: axisIds, ...(pair(source.size) ? { size: pair(source.size)! } : sizeInches ? { size: [sizeInches[0] * dpi, sizeInches[1] * dpi] } : {}), props: normalizeProps(props) });
  }
  for (const axisValue of list(raw.axes)) { const axis = normalizeAxis(axisValue, text(record(axisValue).figure_id)); if (!axes.some((item) => item.id === axis.id)) axes.push(axis); }
  for (const artistValue of list(raw.artists)) { const artist = normalizeArtist(artistValue, text(record(artistValue).axes_id)); if (!artists.some((item) => item.id === artist.id)) artists.push(artist); }
  return {
    figures, axes, artists,
    links: list(raw.links) as NonNullable<MPlotDocument["links"]>, selections: list(raw.selections) as NonNullable<MPlotDocument["selections"]>,
    plugin_requirements: (list(raw.plugin_requirements).length ? list(raw.plugin_requirements) : list(raw.plugins)) as NonNullable<MPlotDocument["plugin_requirements"]>,
    ...(text(raw.title) ? { title: text(raw.title) } : {}), metadata: record(raw.metadata),
  };
}

const arrayShape = (value: unknown): number[] | undefined => {
  const shape = record(value).shape;
  return Array.isArray(shape) && shape.every((item) => Number.isInteger(item)) ? shape as number[] : undefined;
};
const numbers = (value: unknown): number[] => Array.isArray(value) || ArrayBuffer.isView(value) ? Array.from(value as ArrayLike<unknown>, Number) : [];
const rows = (value: unknown, width: number): number[][] => { const flat = numbers(value), result: number[][] = []; for (let i = 0; i + width <= flat.length; i += width) result.push(flat.slice(i, i + width)); return result; };

/** Adapts producer-specific array layouts after object references have been resolved. */
export function normalizeArtistData(type: string, source: Record<string, unknown>, resolved: ResolvedData): ResolvedData {
  const data: ResolvedData = { ...resolved };
  if (data.xy !== undefined) { const points = rows(data.xy, arrayShape(source.xy)?.[1] ?? 2); data.x = points.map((point) => point[0]); data.y = points.map((point) => point[1]); }
  if (type === "mplot.histogram" && data.left !== undefined) {
    const left=numbers(data.left),bottom=numbers(data.bottom),width=numbers(data.width),height=numbers(data.height);
    data.rects=left.map((x,index)=>[x,bottom[index]??0,width[index]??0,height[index]??0]);
  }
  if (data.position !== undefined) { const position=numbers(data.position); data.x=position[0]??0; data.y=position[1]??0; }
  if (data.path !== undefined && data.vertices === undefined) data.vertices=data.path;
  if (data.vertices !== undefined && data.path_lengths !== undefined) {
    const vertices=rows(data.vertices,arrayShape(source.vertices)?.[1]??2), lengths=numbers(data.path_lengths), paths:number[][][]=[]; let offset=0;
    for(const length of lengths){paths.push(vertices.slice(offset,offset+length));offset+=length;}
    data.paths=paths;
  }
  if (data.segments !== undefined) {
    const shape=arrayShape(source.segments), width=shape?.[shape.length-1]??2, segmentLength=shape?.[shape.length-2]??2;
    const points=rows(data.segments,width); data.paths=Array.from({length:Math.ceil(points.length/segmentLength)},(_,i)=>points.slice(i*segmentLength,(i+1)*segmentLength));
  }
  if (data.error_segments !== undefined) { const points=rows(data.error_segments,2); data.error_paths=Array.from({length:Math.ceil(points.length/2)},(_,i)=>points.slice(i*2,i*2+2)); }
  const valueShape=arrayShape(source.values); if(valueShape) data.shape=valueShape;
  return data;
}

export function isArrayReference(value: unknown): value is ArrayReference {
  const candidate=record(value); return typeof candidate.object === "string" && candidate.object.startsWith("sha256:") && typeof candidate.dtype === "string" && Array.isArray(candidate.shape);
}
