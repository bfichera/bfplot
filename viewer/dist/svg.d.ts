export declare const SVG_NS = "http://www.w3.org/2000/svg";
export declare function svg<K extends keyof SVGElementTagNameMap>(name: K, attributes?: Record<string, string | number | undefined>): SVGElementTagNameMap[K];
export declare function cssColor(value: unknown, fallback: string): string;
export declare function numeric(value: unknown): number[];
export declare function pairs(x: unknown, y: unknown): Array<[number, number, number]>;
