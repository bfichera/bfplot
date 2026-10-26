export { MPlotViewer, type ViewerOptions } from "./viewer.js";
export { ViewerModel } from "./model.js";
export type { ArtistRenderer, RenderContext } from "./renderers.js";
export { createScale, formatTick, type Scale } from "./scales.js";
export { resolveTheme, themes } from "./theme.js";
export { normalizeDocument, normalizeArtistData, isArrayReference } from "./normalize.js";
export { createHttpArrayResolver, decodeArray, loadDocument, type LoadOptions } from "./loader.js";
export type * from "./types.js";

import { MPlotViewer, type ViewerOptions } from "./viewer.js";
import type { MPlotDocument } from "./types.js";

export function createViewer(
  target: HTMLElement | string,
  document: MPlotDocument,
  options?: ViewerOptions,
): MPlotViewer {
  const element =
    typeof target === "string"
      ? window.document.querySelector<HTMLElement>(target)
      : target;
  if (!element) throw new Error(`MPlot target not found: ${String(target)}`);
  return new MPlotViewer(element, document, options);
}
