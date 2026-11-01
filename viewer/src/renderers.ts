import { plotText } from "./math.js";
import type { Artist, ResolvedData, Theme } from "./types.js";
import type { Scale } from "./scales.js";
import { cssColor, numeric, pairs, svg } from "./svg.js";

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

const prop = <T>(artist: Artist, key: string, fallback: T): T => (artist.props[key] as T | undefined) ?? fallback;
export const PLOT_TEXT_SIZE = 15;
const pathFrom = (points: Array<[number, number]>, close = false): string => points.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(" ") + (close ? " Z" : "");
const sampled = <T>(values: T[], budget: number): T[] => {
  if (values.length <= budget) return values;
  const result: T[] = [], stride = (values.length - 1) / Math.max(1, budget - 1);
  for (let index = 0; index < budget; index++) result.push(values[Math.min(values.length - 1, Math.round(index * stride))]!);
  return result;
};

const line: ArtistRenderer = ({ group, artist, data, x, y, theme, pointBudget }) => {
  const points = sampled(pairs(data.x, data.y), pointBudget).map(([px, py]) => [x(px), y(py)] as [number, number]);
  group.append(svg("path", { d: pathFrom(points), fill: "none", stroke: cssColor(artist.props.color, theme.accent), "stroke-width": prop(artist, "linewidth", 1.8), "stroke-dasharray": prop(artist, "dasharray", undefined), opacity: prop(artist, "alpha", 1), "vector-effect": "non-scaling-stroke" }));
};

const scatter: ArtistRenderer = ({ group, artist, data, x, y, theme, pointBudget }) => {
  const sizes = numeric(data.sizes ?? artist.props.size), colors = Array.isArray(data.colors) ? data.colors : [], facecolors = artist.props.facecolors as unknown[] | undefined;
  const values = numeric(data.values), mapped = values.length ? scalarColors(values, artist) : [];
  for (const [px, py, index] of sampled(pairs(data.x, data.y), pointBudget)) {
    const point = svg("circle", { cx: x(px), cy: y(py), r: Math.sqrt(sizes[index] ?? prop(artist, "size", 24)) / 2, fill: mapped[index] ?? cssColor(colors[index] ?? facecolors?.[index] ?? artist.props.color, theme.accent), opacity: prop(artist, "alpha", 0.85), class: "bfplot-point", "data-index": index, tabindex: "-1" });
    group.append(point);
  }
};

const bars = (horizontal = false): ArtistRenderer => ({ group, artist, data, x, y, theme }) => {
  if (Array.isArray(data.rects)) {
    for (const raw of data.rects) {
      if (!Array.isArray(raw)) continue;
      const [left=0,bottom=0,width=0,height=0]=raw.map(Number), x0=x(left),x1=x(left+width),y0=y(bottom),y1=y(bottom+height);
      group.append(svg("rect",{x:Math.min(x0,x1),y:Math.min(y0,y1),width:Math.abs(x1-x0),height:Math.abs(y1-y0),fill:cssColor(artist.props.facecolor??artist.props.color,theme.accent),opacity:prop(artist,"alpha",.75),stroke:cssColor(artist.props.edgecolor,"none")}));
    }
    return;
  }
  const values = numeric(data.values ?? data.counts ?? data.y);
  const positions = numeric(data.positions ?? data.bins ?? data.x);
  const widths = numeric(data.widths);
  const baseline = Number(data.baseline ?? 0);
  const inferred = positions.length > 1 ? Math.abs(positions[1]! - positions[0]!) * 0.8 : 0.8;
  values.forEach((value, index) => {
    const position = positions[index] ?? index;
    const width = widths[index] ?? inferred;
    const x0 = horizontal ? x(baseline) : x(position - width / 2), x1 = horizontal ? x(value) : x(position + width / 2);
    const y0 = horizontal ? y(position - width / 2) : y(baseline), y1 = horizontal ? y(position + width / 2) : y(value);
    group.append(svg("rect", { x: Math.min(x0, x1), y: Math.min(y0, y1), width: Math.abs(x1 - x0), height: Math.abs(y1 - y0), fill: cssColor(artist.props.color, theme.accent), opacity: prop(artist, "alpha", 0.75), stroke: cssColor(artist.props.edgecolor, "none") }));
  });
};

const fillBetween: ArtistRenderer = ({ group, artist, data, x, y, theme }) => {
  const paths=Array.isArray(data.paths)?data.paths:[];
  if(paths.length){for(const raw of paths){if(!Array.isArray(raw))continue;const points=raw.map(point=>Array.isArray(point)?[x(Number(point[0])),y(Number(point[1]))] as [number,number]:null).filter((point):point is [number,number]=>point!==null);group.append(svg("path",{d:pathFrom(points,true),fill:cssColor(artist.props.facecolor??artist.props.color,theme.accent),opacity:prop(artist,"alpha",.28),stroke:cssColor(artist.props.edgecolor,"none")}));}return;}
  const xs = numeric(data.x), y1 = numeric(data.y1 ?? data.y), y2 = numeric(data.y2);
  const top = xs.map((v, i) => [x(v), y(y1[i] ?? 0)] as [number, number]);
  const bottom = xs.map((v, i) => [x(v), y(y2[i] ?? 0)] as [number, number]).reverse();
  group.append(svg("path", { d: pathFrom([...top, ...bottom], true), fill: cssColor(artist.props.color, theme.accent), opacity: prop(artist, "alpha", 0.28), stroke: cssColor(artist.props.edgecolor, "none") }));
};

const errorbar: ArtistRenderer = (context) => {
  const { group, artist, data, x, y, theme } = context;
  for(const path of [...(Array.isArray(data.error_paths)?data.error_paths:[]),...(Array.isArray(data.cap_paths)?data.cap_paths:[])]){
    if(!Array.isArray(path))continue;const points=path.map(point=>Array.isArray(point)?[x(Number(point[0])),y(Number(point[1]))] as [number,number]:null).filter((point):point is [number,number]=>point!==null);
    group.append(svg("path",{d:pathFrom(points),fill:"none",stroke:cssColor(artist.props.color,theme.accent),"stroke-width":prop(artist,"linewidth",1.2)}));
  }
  const cap = prop(artist, "capsize", 4), points = pairs(data.x, data.y), xerr = numeric(data.xerr), yerr = numeric(data.yerr);
  for (const [px, py, i] of points) {
    if (yerr[i] !== undefined) {
      const a = y(py - yerr[i]!), b = y(py + yerr[i]!), cx = x(px);
      group.append(svg("path", { d: `M${cx},${a}V${b}M${cx-cap},${a}H${cx+cap}M${cx-cap},${b}H${cx+cap}`, stroke: cssColor(artist.props.color, theme.accent), fill: "none" }));
    }
    if (xerr[i] !== undefined) {
      const a = x(px - xerr[i]!), b = x(px + xerr[i]!), cy = y(py);
      group.append(svg("path", { d: `M${a},${cy}H${b}M${a},${cy-cap}V${cy+cap}M${b},${cy-cap}V${cy+cap}`, stroke: cssColor(artist.props.color, theme.accent), fill: "none" }));
    }
  }
  scatter(context);
};

const palettes: Record<string, string[]> = {
  viridis: ["#440154", "#3b528b", "#21918c", "#5ec962", "#fde725"],
  magma: ["#000004", "#3b0f70", "#8c2981", "#de4968", "#fe9f6d", "#fcfdbf"],
  cividis: ["#00224e", "#344e6c", "#7d7c78", "#c7b866", "#fee838"],
  coolwarm: ["#3b4cc0", "#8db0fe", "#dddcdc", "#f4987a", "#b40426"],
};

const colorChannels = (color: string): [number, number, number] => {
  const hex = color.replace("#", "");
  return [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16)) as [number, number, number];
};

const colorTable = (palette: string[]): Uint8Array => {
  const channels = palette.map(colorChannels), table = new Uint8Array(256 * 3);
  for (let value = 0; value < 256; value++) {
    const scaled = value / 255 * (channels.length - 1), index = Math.min(channels.length - 2, Math.floor(scaled)), mix = scaled - index;
    const from = channels[index]!, to = channels[index + 1]!;
    for (let channel = 0; channel < 3; channel++) table[value * 3 + channel] = Math.round(from[channel]! + (to[channel]! - from[channel]!) * mix);
  }
  return table;
};

const mappedColor = (value: number, limits: [number, number], palette: string[]): string => {
  const colors = colorTable(palette), fraction = Math.max(0, Math.min(1, (value - limits[0]) / (limits[1] - limits[0] || 1)));
  const offset = Math.round(fraction * 255) * 3;
  return `rgb(${colors[offset]}, ${colors[offset + 1]}, ${colors[offset + 2]})`;
};

const scalarColors = (values: number[], artist: Artist): string[] => {
  const configured = numeric(artist.props.clim), limits = configured.length >= 2 ? [configured[0]!, configured[1]!] as [number, number] : finiteRange(values, [0, 1]);
  const configuredPalette = prop<string[]>(artist, "colors", palettes[String(artist.props.cmap)] ?? palettes.viridis!);
  const palette = configuredPalette.length >= 2 ? configuredPalette : palettes.viridis!;
  return values.map((value) => mappedColor(value, limits, palette));
};

const finiteRange = (values: number[], fallback: [number, number]): [number, number] => {
  let minimum = Infinity, maximum = -Infinity;
  for (const value of values) if (Number.isFinite(value)) { minimum = Math.min(minimum, value); maximum = Math.max(maximum, value); }
  return minimum <= maximum ? [minimum, maximum] : fallback;
};

const rasterDataUrl = (values: number[], rows: number, columns: number, artist: Artist): string | undefined => {
  if (typeof document === "undefined" || !rows || !columns) return undefined;
  const limit = 1024, width = Math.min(columns, limit), height = Math.min(rows, limit), canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  let context: CanvasRenderingContext2D | null = null;
  try { context = canvas.getContext("2d"); } catch { return undefined; }
  if (!context) return undefined;
  const configured = numeric(artist.props.clim), [minimum, maximum] = configured.length >= 2 ? [configured[0]!, configured[1]!] : finiteRange(values, [0, 1]);
  const configuredPalette = prop<string[]>(artist, "colors", palettes[String(artist.props.cmap)] ?? palettes.viridis!);
  const palette = configuredPalette.length >= 2 ? configuredPalette : palettes.viridis!, colors = colorTable(palette);
  const pixels = context.createImageData(width, height), lower = artist.props.origin === "lower", scale = 255 / (maximum - minimum || 1);
  for (let targetRow = 0; targetRow < height; targetRow++) {
    const sourceRowFromTop = Math.min(rows - 1, Math.floor(targetRow * rows / height));
    const sourceRow = lower ? rows - sourceRowFromTop - 1 : sourceRowFromTop;
    for (let column = 0; column < width; column++) {
      const sourceColumn = Math.min(columns - 1, Math.floor(column * columns / width));
      const value = values[sourceRow * columns + sourceColumn]!, offset = (targetRow * width + column) * 4;
      if (!Number.isFinite(value)) { pixels.data[offset + 3] = 0; continue; }
      const color = Math.max(0, Math.min(255, Math.round((value - minimum) * scale))) * 3;
      pixels.data[offset] = colors[color]!; pixels.data[offset + 1] = colors[color + 1]!; pixels.data[offset + 2] = colors[color + 2]!; pixels.data[offset + 3] = 255;
    }
  }
  context.putImageData(pixels, 0, 0);
  return canvas.toDataURL("image/png");
};

const image: ArtistRenderer = ({ group, artist, data, x, y }) => {
  const extent = numeric(data.extent), values = numeric(data.values ?? data.array), shape = numeric(data.shape);
  const [left, right, bottom, top] = extent.length >= 4 ? extent : [0, 1, 0, 1];
  const rows = shape[0] ?? Math.round(Math.sqrt(values.length)), columns = shape[1] ?? Math.ceil(values.length / Math.max(1, rows));
  const supplied = typeof data.url === "string" ? data.url : typeof data.data_url === "string" ? data.data_url : "";
  const href = supplied || rasterDataUrl(values, rows, columns, artist);
  if (!href) return;
  group.append(svg("image", { href, x: Math.min(x(left!), x(right!)), y: Math.min(y(bottom!), y(top!)), width: Math.abs(x(right!) - x(left!)), height: Math.abs(y(top!) - y(bottom!)), preserveAspectRatio: prop(artist, "aspect", "none"), opacity: prop(artist, "alpha", 1), "image-rendering": artist.props.interpolation === "nearest" ? "pixelated" : undefined }));
};

const contourPath = (raw: unknown, rawCodes: unknown, x: Scale, y: Scale, budget: number, filled: boolean): string => {
  const points = Array.isArray(raw) ? raw : [], codes = Array.isArray(rawCodes) ? rawCodes.map(Number) : [];
  if (!codes.length) {
    const scaled = sampled(points, budget).map((point) => Array.isArray(point) ? [x(Number(point[0])), y(Number(point[1]))] as [number, number] : null).filter((point): point is [number, number] => point !== null);
    return scaled.length >= 2 ? pathFrom(scaled, filled) : "";
  }
  const parts: string[] = [];
  for (let index = 0; index < points.length; index++) {
    const point = points[index];
    if (!Array.isArray(point)) continue;
    const px = x(Number(point[0])), py = y(Number(point[1])), code = codes[index];
    if (code === 1 || !parts.length) parts.push(`M${px.toFixed(2)},${py.toFixed(2)}`);
    else if (code === 79) parts.push("Z");
    else parts.push(`L${px.toFixed(2)},${py.toFixed(2)}`);
  }
  return parts.join(" ");
};

const contour = (filled: boolean): ArtistRenderer => ({ group, artist, data, x, y, theme, pointBudget }) => {
  const paths = (data.paths ?? data.segments ?? data.polygons ?? []) as unknown[], codes = Array.isArray(data.path_codes) ? data.path_codes : [], budgetPerPath = Math.max(64, Math.floor(pointBudget / Math.max(1, paths.length)));
  const facecolors = artist.props.facecolors as unknown[] | undefined, edgecolors = artist.props.edgecolors as unknown[] | undefined;
  const values = numeric(data.path_values), levels = numeric(data.levels), configured = numeric(artist.props.clim);
  const limits = configured.length >= 2 ? [configured[0]!, configured[1]!] as [number, number] : finiteRange(levels, [0, 1]);
  const configuredPalette = prop<string[]>(artist, "colors", palettes[String(artist.props.cmap)] ?? palettes.viridis!);
  const palette = configuredPalette.length >= 2 ? configuredPalette : palettes.viridis!;
  for (const [index, raw] of paths.entries()) {
    const path = contourPath(raw, codes[index], x, y, budgetPerPath, filled);
    if (!path) continue;
    const mapped = values[index] === undefined ? undefined : mappedColor(values[index]!, limits, palette);
    const fill = mapped ?? cssColor(facecolors?.[index] ?? (artist.props.colors as unknown[] | undefined)?.[index], theme.accent);
    const stroke = mapped ?? cssColor(edgecolors?.[index] ?? (artist.props.colors as unknown[] | undefined)?.[index], filled ? "none" : theme.accent);
    group.append(svg("path", { d: path, fill: filled ? fill : "none", "fill-rule": filled ? "evenodd" : undefined, "fill-opacity": filled ? prop(artist, "alpha", 1) : 0, stroke: filled ? "none" : stroke, "stroke-width": numeric(artist.props.linewidths)[index] ?? prop(artist, "linewidth", 1) }));
  }
};

const text: ArtistRenderer = ({ group, artist, data, x, y, theme }) => {
  const px = x(Number(data.x ?? 0)), py = y(Number(data.y ?? 0));
  group.append(plotText({ x: px, y: py, fill: cssColor(artist.props.color, theme.foreground), "font-size": Math.max(PLOT_TEXT_SIZE, prop(artist, "fontsize", PLOT_TEXT_SIZE)), "font-weight": prop(artist, "fontweight", undefined), "text-anchor": prop(artist, "align", "start"), transform: `rotate(${prop(artist, "rotation", 0)} ${px} ${py})` }, String(data.text ?? artist.props.text ?? ""), "bfplot-artist-text"));
};

const transformedPoints = (value: unknown, transform: unknown): Array<[number, number]> => {
  const vertices = Array.isArray(value) ? value : [], matrix = Array.isArray(transform) ? transform : [];
  return vertices.map((point) => {
    if (!Array.isArray(point)) return null;
    const px = Number(point[0]), py = Number(point[1]);
    if (!Number.isFinite(px) || !Number.isFinite(py)) return null;
    if (matrix.length < 3 || !matrix.every((row) => Array.isArray(row) && row.length >= 3)) return [px, py] as [number, number];
    const tx = Number(matrix[0]![0]) * px + Number(matrix[0]![1]) * py + Number(matrix[0]![2]);
    const ty = Number(matrix[1]![0]) * px + Number(matrix[1]![1]) * py + Number(matrix[1]![2]);
    const tw = Number(matrix[2]![0]) * px + Number(matrix[2]![1]) * py + Number(matrix[2]![2]);
    return Number.isFinite(tx) && Number.isFinite(ty) && Number.isFinite(tw) && tw !== 0 ? [tx / tw, ty / tw] as [number, number] : null;
  }).filter((point): point is [number, number] => point !== null);
};

const patch: ArtistRenderer = ({ group, artist, data, x, y, theme }) => {
  const vertices = data.vertices ?? data.points;
  const source = transformedPoints(vertices, data.transform);
  const points = source.length ? source.map(([px, py]) => [x(px), y(py)] as [number, number]) : pairs(data.x, data.y).map(([a,b]) => [x(a),y(b)] as [number,number]);
  if (points.length < 3) return;
  const closed = prop(artist, "closed", true);
  group.append(svg("path", { d: pathFrom(points, closed), fill: closed ? cssColor(artist.props.facecolor ?? artist.props.color, theme.accent) : "none", "fill-opacity": closed ? prop(artist, "alpha", 0.35) : 0, stroke: cssColor(artist.props.edgecolor, theme.accent), "stroke-width": prop(artist, "linewidth", 1.2) }));
};

const line3d: ArtistRenderer = ({ group, artist, data, project3d, theme, pointBudget }) => {
  const xs=numeric(data.x), ys=numeric(data.y), zs=numeric(data.z), points=sampled(xs.slice(0,Math.min(xs.length,ys.length,zs.length)).map((v,i)=>[v,ys[i]!,zs[i]!] as [number,number,number]),pointBudget).map(([x,y,z])=>project3d(x,y,z));
  group.append(svg("path", { d:pathFrom(points), fill:"none", stroke:cssColor(artist.props.color,theme.accent), "stroke-width":prop(artist,"linewidth",1.8) }));
};

const scatter3d: ArtistRenderer = ({ group, artist, data, project3d, depth3d, theme, pointBudget }) => {
  const xs=numeric(data.x),ys=numeric(data.y),zs=numeric(data.z), values=numeric(data.values), mapped=values.length?scalarColors(values,artist):[];
  const depth=(i:number)=>depth3d?depth3d(xs[i]??0,ys[i]??0,zs[i]??0):zs[i]??0, indices=sampled(xs.map((_,i)=>i),pointBudget).sort((a,b)=>depth(a)-depth(b));
  for(const i of indices){ if(ys[i]===undefined||zs[i]===undefined) continue; const [cx,cy]=project3d(xs[i]!,ys[i]!,zs[i]!); group.append(svg("circle",{cx,cy,r:prop(artist,"size",4),fill:mapped[i]??cssColor(artist.props.color,theme.accent),opacity:prop(artist,"alpha",.85),class:"bfplot-point","data-index":i})); }
};

const surface3d = (filled: boolean): ArtistRenderer => ({ group, artist, data, project3d, depth3d, theme, pointBudget }) => {
  const paths = Array.isArray(data.paths) ? data.paths : [], values = numeric(data.values), mapped = values.length ? scalarColors(values, artist) : [], budget = Math.max(1, Math.min(paths.length, pointBudget));
  const vertices = (raw: unknown): Array<[number, number, number]> => Array.isArray(raw) ? raw.filter((point): point is unknown[] => Array.isArray(point) && point.length >= 3).map((point) => [Number(point[0]), Number(point[1]), Number(point[2])]) : [];
  const faceDepth = (index: number): number => { const face = vertices(paths[index]); return depth3d && face.length ? face.reduce((sum, point) => sum + depth3d(...point), 0) / face.length : 0; };
  // Painter's algorithm: draw far faces first so nearer ones cover them.
  const indices = sampled(paths.map((_, index) => index), budget);
  if (filled && depth3d) { const depths = new Map(indices.map((index) => [index, faceDepth(index)])); indices.sort((a, b) => depths.get(a)! - depths.get(b)!); }
  // Matplotlib cycles per-face style lists, so a single entry applies to every face.
  const cycled = <T>(values: T[] | undefined, index: number): T | undefined => values?.length ? values[index % values.length] : undefined;
  const facecolors = artist.props.facecolors as unknown[] | undefined, edgecolors = artist.props.edgecolors as unknown[] | undefined, linewidths = numeric(artist.props.linewidths);
  for (const index of indices) {
    const points = vertices(paths[index]).map((point) => project3d(...point));
    if (points.length < 2) continue;
    const fill = filled ? mapped[index] ?? cssColor(cycled(facecolors, index) ?? artist.props.facecolor ?? artist.props.color, theme.accent) : "none";
    const width = cycled(linewidths, index) ?? (filled ? 0.35 : 0.8), seamless = filled && width === 0;
    group.append(svg("path", {
      d: pathFrom(points, filled),
      fill,
      "fill-opacity": filled ? prop(artist, "alpha", 1) : 0,
      // Edgeless faces are stroked in their own colour to hide antialiasing seams.
      stroke: seamless ? fill : cssColor(cycled(edgecolors, index) ?? artist.props.edgecolor ?? artist.props.color, filled ? theme.grid : theme.accent),
      "stroke-width": seamless ? 0.6 : width,
      "vector-effect": "non-scaling-stroke",
    }));
  }
};

export const builtinRenderers: Readonly<Record<string, ArtistRenderer>> = {
  "bfplot.line": line, "bfplot.scatter": scatter, "bfplot.image": image, "bfplot.errorbar": errorbar,
  "bfplot.fill_between": fillBetween, "bfplot.histogram": bars(), "bfplot.contour": contour(false), "bfplot.contourf": contour(true),
  "bfplot.text": text, "bfplot.patch": patch, "bfplot.line3d": line3d, "bfplot.scatter3d": scatter3d,
  "bfplot.surface3d": surface3d(true), "bfplot.mesh3d": surface3d(false),
};
