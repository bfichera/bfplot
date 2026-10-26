const finiteDomain = (domain) => {
    const a = Number.isFinite(domain[0]) ? domain[0] : 0;
    const b = Number.isFinite(domain[1]) ? domain[1] : 1;
    return a === b ? [a - 0.5, b + 0.5] : [a, b];
};
function niceTicks(domain, count = 6) {
    const [a, b] = finiteDomain(domain);
    const reverse = b < a;
    const lo = Math.min(a, b), hi = Math.max(a, b);
    const rough = (hi - lo) / Math.max(1, count);
    const power = 10 ** Math.floor(Math.log10(rough));
    const error = rough / power;
    const step = (error >= 7.5 ? 10 : error >= 3.5 ? 5 : error >= 1.5 ? 2 : 1) * power;
    const result = [];
    for (let value = Math.ceil(lo / step) * step; value <= hi + step * 1e-8; value += step) {
        result.push(Number(value.toPrecision(12)));
    }
    return reverse ? result.reverse() : result;
}
export function createScale(type = "linear", domain, range) {
    const [d0, d1] = finiteDomain(domain);
    const [r0, r1] = range;
    const symlog = (x) => Math.sign(x) * Math.log1p(Math.abs(x));
    const symexp = (x) => Math.sign(x) * Math.expm1(Math.abs(x));
    const transform = type === "log" ? (x) => Math.log10(Math.max(Number.MIN_VALUE, x))
        : type === "symlog" ? symlog : (x) => x;
    const untransform = type === "log" ? (x) => 10 ** x : type === "symlog" ? symexp : (x) => x;
    const t0 = transform(d0), t1 = transform(d1);
    const span = t1 - t0 || 1;
    const scale = ((value) => r0 + ((transform(value) - t0) / span) * (r1 - r0));
    scale.invert = (pixel) => untransform(t0 + ((pixel - r0) / (r1 - r0 || 1)) * span);
    scale.ticks = (count = 6) => {
        if (type === "symlog") {
            const lo = Math.min(d0, d1), hi = Math.max(d0, d1), largest = Math.max(Math.abs(lo), Math.abs(hi));
            const powers = Array.from({ length: Math.max(0, Math.floor(Math.log10(largest)) + 1) }, (_, index) => 10 ** index);
            const ticks = [...powers.map((value) => -value).reverse(), 0, ...powers].filter((value) => value >= lo && value <= hi);
            return d1 < d0 ? ticks.reverse() : ticks;
        }
        if (type !== "log")
            return niceTicks([d0, d1], count);
        const lo = Math.ceil(Math.log10(Math.min(d0, d1)));
        const hi = Math.floor(Math.log10(Math.max(d0, d1)));
        const ticks = Array.from({ length: Math.max(0, hi - lo + 1) }, (_, i) => 10 ** (lo + i));
        return d1 < d0 ? ticks.reverse() : ticks;
    };
    return scale;
}
export function formatTick(value, type = "linear", dateFormat = "%b %d") {
    if (type === "date") {
        dateFormat ||= "%b %d";
        const date = new Date(value * 86_400_000);
        const monthShort = new Intl.DateTimeFormat(undefined, { month: "short", timeZone: "UTC" }).format(date);
        const replacements = { "%Y": String(date.getUTCFullYear()), "%m": String(date.getUTCMonth() + 1).padStart(2, "0"), "%b": monthShort, "%d": String(date.getUTCDate()).padStart(2, "0") };
        return Object.entries(replacements).reduce((text, [token, replacement]) => text.replaceAll(token, replacement), dateFormat);
    }
    const magnitude = Math.abs(value);
    if ((magnitude !== 0 && magnitude < 1e-3) || magnitude >= 1e5)
        return value.toExponential(2);
    return new Intl.NumberFormat(undefined, { maximumSignificantDigits: 6 }).format(value);
}
//# sourceMappingURL=scales.js.map