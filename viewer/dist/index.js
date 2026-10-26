export { MPlotViewer } from "./viewer.js";
export { ViewerModel } from "./model.js";
export { createScale, formatTick } from "./scales.js";
export { resolveTheme, themes } from "./theme.js";
export { normalizeDocument, normalizeArtistData, isArrayReference } from "./normalize.js";
export { createHttpArrayResolver, decodeArray, loadDocument } from "./loader.js";
import { MPlotViewer } from "./viewer.js";
export function createViewer(target, document, options) {
    const element = typeof target === "string" ? window.document.querySelector(target) : target;
    if (!element)
        throw new Error(`MPlot target not found: ${String(target)}`);
    return new MPlotViewer(element, document, options);
}
//# sourceMappingURL=index.js.map