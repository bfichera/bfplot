import type { Theme, ThemeName } from "./types.js";

export const themes: Record<"light" | "dark", Theme> = {
  light: { background: "#f5f7fb", panel: "#ffffff", foreground: "#182230", muted: "#687386", grid: "#dce2ea", accent: "#246bfd", selection: "#ffb000", fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif" },
  dark: { background: "#0e131b", panel: "#161d28", foreground: "#ecf1f8", muted: "#9aa8ba", grid: "#303b4a", accent: "#73a5ff", selection: "#ffc247", fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif" },
};

export function resolveTheme(theme: ThemeName | Partial<Theme> = "auto"): Theme {
  const dark = typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;
  if (typeof theme === "string") return themes[theme === "auto" ? (dark ? "dark" : "light") : theme];
  return { ...themes.light, ...theme };
}
