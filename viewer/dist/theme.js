export const themes = {
    light: { background: "#f3f1eb", panel: "#fffefb", foreground: "#171713", muted: "#5f5e57", grid: "#d8d5cc", accent: "#1f5a94", selection: "#a65a16", fontFamily: "Charter, 'Bitstream Charter', 'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif" },
    dark: { background: "#171714", panel: "#211f1b", foreground: "#f1eee5", muted: "#aaa69c", grid: "#464239", accent: "#78a9d4", selection: "#e2a45f", fontFamily: "Charter, 'Bitstream Charter', 'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif" },
};
export function resolveTheme(theme = "auto") {
    const dark = typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;
    if (typeof theme === "string")
        return themes[theme === "auto" ? (dark ? "dark" : "light") : theme];
    return { ...themes.light, ...theme };
}
//# sourceMappingURL=theme.js.map