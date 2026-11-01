import type { Theme, ThemeName } from "./types.js";
export declare const themes: Record<"light" | "dark", Theme>;
export declare function resolveTheme(theme?: ThemeName | Partial<Theme>): Theme;
