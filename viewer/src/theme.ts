import type { Theme, ThemeName } from "./types.js";

const paperFont = "'CMU Serif', 'Latin Modern Roman', 'Computer Modern', serif";

export const themes: Record<"light" | "dark", Theme> = {
  light: { background: "#ffffff", panel: "#ffffff", foreground: "#181713", muted: "#68655d", grid: "#dddcd7", accent: "#7b191c", selection: "#9a5617", fontFamily: paperFont },
  dark: { background: "#171714", panel: "#211f1b", foreground: "#f1eee5", muted: "#aaa69c", grid: "#464239", accent: "#c27678", selection: "#e2a45f", fontFamily: paperFont },
};

export function resolveTheme(theme: ThemeName | Partial<Theme> = "auto"): Theme {
  if (typeof theme === "string") return themes[theme === "dark" ? "dark" : "light"];
  return { ...themes.light, ...theme };
}
