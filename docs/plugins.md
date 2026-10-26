# Viewer plugins

MPlot plugins extend rendering without putting executable code in an artifact. An artifact may declare requirements, but a viewer must never install or execute a plugin merely because an artifact requests it.

## Artist namespaces

Built-in artist types are reserved under `mplot.*`. Third-party types must use a reverse-DNS namespace controlled by the plugin author, for example:

```text
org.example.spectrogram
```

Each artist includes a `schema_version`. Treat the combination of type name and schema version as the compatibility boundary. Validate `props` and `data` before rendering, and do not reinterpret an unknown schema as the latest known schema.

## Degraded rendering

Unknown, unavailable, disabled, or invalid artists must remain visible as placeholders. A useful placeholder identifies the artist type and ID and explains why it could not be rendered. Never silently drop an artist: absence can materially change the scientific meaning of a figure.

Viewers should preserve unknown artist records when loading and resaving documents where possible.

## Plugin safety checklist

A plugin is installed software and has the privileges of the viewer process. Plugin authors should:

- treat documents, properties, strings, and array bytes as untrusted input;
- validate schemas, dimensions, decoded sizes, and numeric ranges;
- cap memory, decompression, recursion, and rendering work;
- avoid dynamic code evaluation and HTML injection;
- avoid network access during rendering unless the user explicitly enables it;
- render an error placeholder instead of crashing the complete document;
- declare supported artist schema versions explicitly.

Plugin distributors should publish integrity-protected releases and a security contact. Viewer operators should pin and review plugins as they would any other application dependency.

## Compatibility

Pre-1.0 plugin APIs may change between minor MPlot versions. Keep format decoding separate from renderer-specific code, test unsupported schema behavior, and state the supported MPlot and artist schema versions in plugin release notes.
