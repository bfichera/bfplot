const scaleSignature = (axis) => ({
    x: axis.xscale ?? "linear",
    y: axis.yscale ?? "linear",
});
/** Tracks an ephemeral set of compatible line artists without changing the document. */
export class LineComparison {
    selectedIds = new Set();
    open = false;
    message = "Select lines from any figure.";
    get active() {
        return this.selectedIds.size > 0;
    }
    toggle(document, artistId) {
        if (this.selectedIds.has(artistId)) {
            this.selectedIds.delete(artistId);
            this.message = this.selectedIds.size
                ? `${this.selectedIds.size} line${this.selectedIds.size === 1 ? "" : "s"} selected.`
                : "Select lines from any figure.";
            return { selected: false };
        }
        const artist = document.artists.find((candidate) => candidate.id === artistId);
        if (!artist || artist.type !== "mplot.line") {
            return { selected: false, message: "Only 2D line artists can be compared." };
        }
        const axis = document.axes.find((candidate) => candidate.id === artist.axes_id);
        if (!axis)
            return { selected: false, message: "The line's source plot is unavailable." };
        const first = this.artists(document)[0];
        const firstAxis = first
            ? document.axes.find((candidate) => candidate.id === first.axes_id)
            : undefined;
        if (firstAxis) {
            const expected = scaleSignature(firstAxis);
            const received = scaleSignature(axis);
            if (expected.x !== received.x || expected.y !== received.y) {
                const message = `Cannot compare ${received.x}/${received.y} scales with ${expected.x}/${expected.y} scales.`;
                this.message = message;
                return { selected: false, message };
            }
        }
        this.selectedIds.add(artistId);
        this.message = `${this.selectedIds.size} line${this.selectedIds.size === 1 ? "" : "s"} selected.`;
        return { selected: true };
    }
    artists(document) {
        return document.artists.filter((artist) => artist.type === "mplot.line" && this.selectedIds.has(artist.id));
    }
    sourceAxis(document) {
        const artist = this.artists(document)[0];
        return artist
            ? document.axes.find((axis) => axis.id === artist.axes_id)
            : undefined;
    }
    clear() {
        this.selectedIds.clear();
        this.open = false;
        this.message = "Select lines from any figure.";
    }
}
export function fitLineViewport(data, xscale = "linear", yscale = "linear") {
    const values = (key, scale) => {
        const numbers = data.flatMap((item) => {
            const value = item[key];
            return Array.isArray(value) || ArrayBuffer.isView(value)
                ? Array.from(value, Number).filter(Number.isFinite)
                : [];
        });
        const valid = scale === "log" ? numbers.filter((value) => value > 0) : numbers;
        if (!valid.length)
            return scale === "log" ? [1, 10] : [0, 1];
        const low = Math.min(...valid);
        const high = Math.max(...valid);
        if (scale === "log") {
            const factor = high === low ? 1.1 : Math.pow(high / low, 0.04);
            return [low / factor, high * factor];
        }
        const padding = (high - low || Math.max(Math.abs(low), 1)) * 0.04;
        return [low - padding, high + padding];
    };
    return { x: values("x", xscale), y: values("y", yscale) };
}
//# sourceMappingURL=comparison.js.map