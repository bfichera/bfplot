export { BFPlotViewer } from "./viewer.js";
export { ViewerModel } from "./model.js";
export { createScale, formatTick } from "./scales.js";
export { resolveTheme, themes } from "./theme.js";
export { normalizeDocument, normalizeArtistData, isArrayReference } from "./normalize.js";
export { createHttpArrayResolver, decodeArray, loadDocument } from "./loader.js";
import { BFPlotViewer } from "./viewer.js";
export function createViewer(target, document, options) {
    const element = typeof target === "string"
        ? window.document.querySelector(target)
        : target;
    if (!element)
        throw new Error(`BFPlot target not found: ${String(target)}`);
    return new BFPlotViewer(element, document, options);
}
//# sourceMappingURL=index.js.map