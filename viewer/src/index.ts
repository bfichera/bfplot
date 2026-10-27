export { BFPlotViewer, type ViewerOptions } from "./viewer.js";
export { ViewerModel } from "./model.js";
export type { ArtistRenderer, RenderContext } from "./renderers.js";
export { createScale, formatTick, type Scale } from "./scales.js";
export { resolveTheme, themes } from "./theme.js";
export { normalizeDocument, normalizeArtistData, isArrayReference } from "./normalize.js";
export { createHttpArrayResolver, decodeArray, loadDocument, type LoadOptions } from "./loader.js";
export type * from "./types.js";

import { BFPlotViewer, type ViewerOptions } from "./viewer.js";
import type { BFPlotDocument } from "./types.js";

export function createViewer(
  target: HTMLElement | string,
  document: BFPlotDocument,
  options?: ViewerOptions,
): BFPlotViewer {
  const element =
    typeof target === "string"
      ? window.document.querySelector<HTMLElement>(target)
      : target;
  if (!element) throw new Error(`BFPlot target not found: ${String(target)}`);
  return new BFPlotViewer(element, document, options);
}
