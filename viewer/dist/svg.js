export const SVG_NS = "http://www.w3.org/2000/svg";
export function svg(name, attributes = {}) {
    const element = document.createElementNS(SVG_NS, name);
    for (const [key, value] of Object.entries(attributes))
        if (value !== undefined)
            element.setAttribute(key, String(value));
    return element;
}
export function cssColor(value, fallback) {
    return typeof value === "string" && value.length > 0 ? value : fallback;
}
export function numeric(value) {
    if (Array.isArray(value) || ArrayBuffer.isView(value))
        return Array.from(value, Number).filter(Number.isFinite);
    return [];
}
export function pairs(x, y) {
    const xs = numeric(x), ys = numeric(y);
    return Array.from({ length: Math.min(xs.length, ys.length) }, (_, index) => [xs[index], ys[index], index]);
}
//# sourceMappingURL=svg.js.map