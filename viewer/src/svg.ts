export const SVG_NS = "http://www.w3.org/2000/svg";

export function svg<K extends keyof SVGElementTagNameMap>(name: K, attributes: Record<string, string | number | undefined> = {}): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) if (value !== undefined) element.setAttribute(key, String(value));
  return element;
}

export function cssColor(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

export function numeric(value: unknown): number[] {
  if (Array.isArray(value) || ArrayBuffer.isView(value)) return Array.from(value as ArrayLike<unknown>, Number).filter(Number.isFinite);
  return [];
}

export function pairs(x: unknown, y: unknown): Array<[number, number, number]> {
  const xs = numeric(x), ys = numeric(y);
  return Array.from({ length: Math.min(xs.length, ys.length) }, (_, index) => [xs[index]!, ys[index]!, index]);
}
