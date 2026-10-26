import temml from "./temml.js";
import { svg } from "./svg.js";
const mathPattern = /\$([^$]+)\$/g;
export const hasMath = (text) => /\$[^$]+\$/.test(text);
export function mathHTML(text) {
    let offset = 0, result = "";
    for (const match of text.matchAll(mathPattern)) {
        const index = match.index ?? 0;
        result += escapeHTML(text.slice(offset, index));
        try {
            result += temml.renderToString((match[1] ?? "").replaceAll("\\mathdefault", "\\mathrm"), { displayMode: false, throwOnError: false });
        }
        catch {
            result += escapeHTML(match[0]);
        }
        offset = index + match[0].length;
    }
    return result + escapeHTML(text.slice(offset));
}
export function plotText(attributes, text, className) {
    if (!hasMath(text)) {
        const element = svg("text", { ...attributes, class: className });
        element.textContent = text;
        return element;
    }
    const x = Number(attributes.x ?? 0), y = Number(attributes.y ?? 0), anchor = String(attributes["text-anchor"] ?? "start");
    const width = Math.max(80, text.length * 11), height = 34;
    const left = anchor === "middle" ? x - width / 2 : anchor === "end" ? x - width : x;
    const foreign = svg("foreignObject", { ...attributes, x: left, y: y - 24, width, height, class: `${className} mplot-math` });
    foreign.removeAttribute("text-anchor");
    foreign.removeAttribute("font-size");
    const container = document.createElement("div");
    container.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
    container.className = `mplot-math-content mplot-math-content--${anchor}`;
    container.innerHTML = mathHTML(text);
    foreign.append(container);
    return foreign;
}
function escapeHTML(text) {
    const element = document.createElement("span");
    element.textContent = text;
    return element.innerHTML;
}
//# sourceMappingURL=math.js.map