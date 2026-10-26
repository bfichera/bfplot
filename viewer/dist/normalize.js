const record = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};
const list = (value) => Array.isArray(value) ? value : [];
const text = (value, fallback = "") => typeof value === "string" ? value : fallback;
const pair = (value) => Array.isArray(value) && value.length >= 2 && value.slice(0, 2).every((item) => typeof item === "number") ? [value[0], value[1]] : undefined;
const quad = (value) => Array.isArray(value) && value.length >= 4 && value.slice(0, 4).every((item) => typeof item === "number") ? value.slice(0, 4) : undefined;
const scale = (value) => ["linear", "log", "symlog", "date", "category"].includes(String(value)) ? value : "linear";
function rgba(value) {
    if (!Array.isArray(value) || value.length < 3 || !value.slice(0, 3).every((item) => typeof item === "number"))
        return value;
    const [r, g, b, a = 1] = value;
    const channel = (item) => Math.round(Math.max(0, Math.min(1, item)) * 255);
    return `rgba(${channel(r)}, ${channel(g)}, ${channel(b)}, ${Math.max(0, Math.min(1, a))})`;
}
function normalizeProps(value) {
    const props = { ...record(value) };
    for (const key of ["color", "facecolor", "edgecolor"])
        if (key in props)
            props[key] = rgba(props[key]);
    for (const key of ["facecolors", "edgecolors"])
        if (Array.isArray(props[key]))
            props[key] = props[key].map(rgba);
    if (props.size !== undefined && props.fontsize === undefined)
        props.fontsize = props.size;
    if (props.horizontalalignment !== undefined && props.align === undefined) {
        props.align = props.horizontalalignment === "center" ? "middle" : props.horizontalalignment === "right" ? "end" : "start";
    }
    return props;
}
function normalizeAxis(rawValue, figureId) {
    const raw = record(rawValue), props = record(raw.props), source = { ...props, ...raw };
    const x = record(source.x), y = record(source.y), z = record(source.z);
    const projection = source.projection === "3d" ? "3d" : "2d";
    const xlim = pair(source.xlim) ?? pair(x.limits), ylim = pair(source.ylim) ?? pair(y.limits), zlim = pair(source.zlim) ?? pair(z.limits), position = quad(source.position) ?? quad(source.bounds);
    const colorbarRaw = record(source.colorbar), colorbarLimits = pair(colorbarRaw.limits);
    const colorbar = source.role === "colorbar" ? {
        orientation: colorbarRaw.orientation === "horizontal" ? "horizontal" : "vertical",
        ...(text(colorbarRaw.label) ? { label: text(colorbarRaw.label) } : {}),
        ...(colorbarLimits ? { limits: colorbarLimits } : {}),
        ticks: list(colorbarRaw.ticks).map(Number), ticklabels: list(colorbarRaw.ticklabels).map(String),
        ...(text(colorbarRaw.cmap) ? { cmap: text(colorbarRaw.cmap) } : {}),
        colors: list(colorbarRaw.colors), ...(text(colorbarRaw.mappable) ? { mappable: text(colorbarRaw.mappable) } : {}),
    } : undefined;
    return {
        id: text(source.id), figure_id: figureId,
        ...(source.role === "colorbar" && colorbar ? { role: "colorbar", colorbar } : source.role === "inset" ? { role: "inset" } : {}),
        ...(text(source.parent_axes_id) ? { parent_axes_id: text(source.parent_axes_id) } : {}),
        ...(text(source.title) ? { title: text(source.title) } : {}),
        ...(text(source.xlabel ?? x.label) ? { xlabel: text(source.xlabel ?? x.label) } : {}),
        ...(text(source.ylabel ?? y.label) ? { ylabel: text(source.ylabel ?? y.label) } : {}),
        ...(text(source.zlabel ?? z.label) ? { zlabel: text(source.zlabel ?? z.label) } : {}),
        ...(xlim ? { xlim } : {}),
        ...(ylim ? { ylim } : {}),
        ...(zlim ? { zlim } : {}),
        xscale: scale(source.xscale ?? x.scale), yscale: scale(source.yscale ?? y.scale), zscale: scale(source.zscale ?? z.scale), projection,
        ...(position ? { position } : {}),
        props: {
            ...normalizeProps(props),
            ...(source.view && typeof source.view === "object" ? { view: source.view } : {}),
            xaxis: { ticks: list(source.xticks ?? x.ticks).map(Number), ticklabels: list(source.xticklabels ?? x.ticklabels).map(String), date_epoch: text(source.xdate_epoch ?? x.date_epoch), date_format: text(source.xdate_format ?? x.date_format) },
            yaxis: { ticks: list(source.yticks ?? y.ticks).map(Number), ticklabels: list(source.yticklabels ?? y.ticklabels).map(String), date_epoch: text(source.ydate_epoch ?? y.date_epoch), date_format: text(source.ydate_format ?? y.date_format) },
        },
    };
}
function normalizeArtist(rawValue, axesId) {
    const raw = record(rawValue);
    return {
        type: text(raw.type, "mplot.unknown"), schema_version: Number(raw.schema_version ?? 1), id: text(raw.id),
        axes_id: text(raw.axes_id, axesId), props: normalizeProps(raw.props), data: { ...record(raw.data) },
    };
}
/** Accepts both the nested artifact schema emitted by Python/Rust and the viewer's flat schema. */
export function normalizeDocument(value) {
    const raw = record(value), figures = [], axes = [], artists = [];
    for (const [figureIndex, figureValue] of list(raw.figures).entries()) {
        const figureRaw = record(figureValue), props = record(figureRaw.props), source = { ...props, ...figureRaw };
        const figureId = text(source.id, `figure-${figureIndex}`), axisIds = [];
        for (const [axisIndex, axisValue] of list(source.axes).entries()) {
            if (typeof axisValue === "string") {
                axisIds.push(axisValue);
                continue;
            }
            const axis = normalizeAxis(axisValue, figureId);
            if (!axis.id)
                axis.id = `${figureId}-axes-${axisIndex}`;
            axisIds.push(axis.id);
            axes.push(axis);
            const axisRaw = record(axisValue), axisSource = { ...record(axisRaw.props), ...axisRaw };
            for (const artistValue of list(axisSource.artists))
                artists.push(normalizeArtist(artistValue, axis.id));
        }
        const sizeInches = pair(source.size_inches), dpi = Number(source.dpi ?? 100);
        figures.push({ id: figureId, ...(text(source.title) ? { title: text(source.title) } : {}), axes: axisIds, ...(pair(source.size) ? { size: pair(source.size) } : sizeInches ? { size: [sizeInches[0] * dpi, sizeInches[1] * dpi] } : {}), props: normalizeProps(props) });
    }
    for (const axisValue of list(raw.axes)) {
        const axis = normalizeAxis(axisValue, text(record(axisValue).figure_id));
        if (!axes.some((item) => item.id === axis.id))
            axes.push(axis);
    }
    for (const artistValue of list(raw.artists)) {
        const artist = normalizeArtist(artistValue, text(record(artistValue).axes_id));
        if (!artists.some((item) => item.id === artist.id))
            artists.push(artist);
    }
    const metadata = { ...record(raw.metadata) };
    delete metadata.plugin_requirements;
    delete metadata.plugins;
    return {
        figures, axes, artists,
        links: list(raw.links), selections: list(raw.selections),
        ...(text(raw.title) ? { title: text(raw.title) } : {}), metadata,
    };
}
const arrayShape = (value) => {
    const shape = record(value).shape;
    return Array.isArray(shape) && shape.every((item) => Number.isInteger(item)) ? shape : undefined;
};
const numbers = (value) => Array.isArray(value) || ArrayBuffer.isView(value) ? Array.from(value, Number) : [];
const rows = (value, width) => {
    if (!Number.isSafeInteger(width) || width <= 0)
        return [];
    const flat = numbers(value), result = [];
    for (let i = 0; i + width <= flat.length; i += width)
        result.push(flat.slice(i, i + width));
    return result;
};
/** Adapts producer-specific array layouts after object references have been resolved. */
export function normalizeArtistData(type, source, resolved) {
    const data = { ...resolved };
    if (data.xy !== undefined) {
        const points = rows(data.xy, arrayShape(source.xy)?.[1] ?? 2);
        data.x = points.map((point) => point[0]);
        data.y = points.map((point) => point[1]);
    }
    if (type === "mplot.histogram" && data.left !== undefined) {
        const left = numbers(data.left), bottom = numbers(data.bottom), width = numbers(data.width), height = numbers(data.height);
        data.rects = left.map((x, index) => [x, bottom[index] ?? 0, width[index] ?? 0, height[index] ?? 0]);
    }
    if (data.position !== undefined) {
        const position = numbers(data.position);
        data.x = position[0] ?? 0;
        data.y = position[1] ?? 0;
    }
    if (data.path !== undefined && data.vertices === undefined) {
        data.vertices = rows(data.path, arrayShape(source.path)?.[1] ?? 2);
    }
    if (data.vertices !== undefined && data.path_lengths !== undefined) {
        const vertices = rows(data.vertices, arrayShape(source.vertices)?.[1] ?? 2), lengths = numbers(data.path_lengths), codes = numbers(data.path_codes), paths = [], pathCodes = [];
        let offset = 0;
        for (const length of lengths) {
            paths.push(vertices.slice(offset, offset + length));
            if (codes.length)
                pathCodes.push(codes.slice(offset, offset + length));
            offset += length;
        }
        data.paths = paths;
        if (pathCodes.length)
            data.path_codes = pathCodes;
    }
    else if (data.vertices !== undefined && (ArrayBuffer.isView(data.vertices) || !Array.isArray(data.vertices))) {
        data.vertices = rows(data.vertices, arrayShape(source.vertices)?.[1] ?? 2);
    }
    if (data.segments !== undefined) {
        const shape = arrayShape(source.segments), width = shape?.[shape.length - 1] ?? 2, segmentLength = shape?.[shape.length - 2] ?? 2;
        const points = rows(data.segments, width);
        data.paths = Array.from({ length: Math.ceil(points.length / segmentLength) }, (_, i) => points.slice(i * segmentLength, (i + 1) * segmentLength));
    }
    if (data.error_segments !== undefined) {
        const points = rows(data.error_segments, 2);
        data.error_paths = Array.from({ length: Math.ceil(points.length / 2) }, (_, i) => points.slice(i * 2, i * 2 + 2));
    }
    if (data.cap_segments !== undefined) {
        const points = rows(data.cap_segments, 2);
        data.cap_paths = Array.from({ length: Math.ceil(points.length / 2) }, (_, i) => points.slice(i * 2, i * 2 + 2));
    }
    const valueShape = arrayShape(source.values);
    if (valueShape)
        data.shape = valueShape;
    return data;
}
export function isArrayReference(value) {
    const candidate = record(value);
    return typeof candidate.object === "string" && candidate.object.startsWith("sha256:") && typeof candidate.dtype === "string" && Array.isArray(candidate.shape);
}
//# sourceMappingURL=normalize.js.map