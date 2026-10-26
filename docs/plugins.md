# Writing an MPlot plugin

Matplotlib can draw almost anything. MPlot cannot possibly know about every custom artist in every scientific codebase, so it has plugins!

A plugin teaches the Python exporter how to save your artist. A corresponding viewer renderer can teach the browser how to display it.

If the built-in artists already cover your plot, you do not need any of this. Go enjoy your afternoon.

## A tiny exporter plugin

Suppose your package defines a custom `SpectrumArtist`. Register an exporter like this:

```python
from mplot import register_artist
from my_package import SpectrumArtist


def export_spectrum(artist, context):
    return {
        "props": {
            "color": artist.color,
            "label": artist.get_label(),
        },
        "data": {
            "frequency": context.array(artist.frequency),
            "power": context.array(artist.power),
        },
    }


register_artist(
    "org.example.spectrum",
    SpectrumArtist,
    export_spectrum,
    requirement="my-mplot-plugin>=1",
)
```

After registration, an ordinary call to `mplot.savefig()` will find `SpectrumArtist` instances and save them as `org.example.spectrum` records.

The exporter returns two dictionaries:

- `props` contains small display properties such as colors and labels;
- `data` contains values and array references used by the renderer.

Use `context.array(...)` for numerical arrays. MPlot will make them contiguous, compress them with Zstandard, put them in the content store, and return the correct reference. Much easier than doing all of that yourself!

## Why the funny name?

Built-in types live under `mplot.*`. Plugins use reverse-DNS names:

```text
org.example.spectrum
io.github.yourname.band_structure
edu.university.lab.detector_map
```

The namespace keeps two unrelated plugins from both declaring that they own `spectrum`. Pick a domain or project namespace that you control.

Each artist also has a `schema_version`. Together, the type name and schema version describe the data contract. If version 2 reorganizes the arrays, a version 1 renderer should say that it cannot render the artist—not confidently draw nonsense.

## Loading plugins from installed packages

MPlot looks for Python entry points in the `mplot.plugins` group. For example, a plugin package can include:

```toml
[project.entry-points."mplot.plugins"]
spectrum = "my_package.mplot_plugin:register"
```

The referenced object can be:

- a `Plugin` instance;
- an iterable of `Plugin` instances;
- a callable that accepts the MPlot plugin registry.

A registration callable might look like this:

```python
def register(registry):
    return registry.register(
        "org.example.spectrum",
        SpectrumArtist,
        export_spectrum,
        requirement="my-mplot-plugin>=1",
    )
```

This lets users install your package normally and then call `mplot.savefig()` without adding registration boilerplate to every analysis script.

## The viewer side

Saving the artist and drawing it are separate jobs. The Python plugin writes a portable record; the browser renderer turns that record into graphics.

Viewer renderers receive the artist, resolved arrays, coordinate scales, theme, SVG group, and interaction state. See `viewer/src/renderers.ts` for the built-in examples and `MPlotViewer.registerRenderer()` for runtime registration.

If the renderer is missing, MPlot shows a visible unsupported-artist placeholder with the artist type and ID. It does **not** silently erase the artist. This is intentional: disappearing scientific data is worse than an honest error box.

## A few good plugin manners

Plugins are installed code, so they have the privileges of the Python process or viewer that loads them. Please:

- validate array shapes, dimensions, and numerical ranges;
- put limits on memory use and rendering work;
- treat labels and other strings as untrusted input;
- avoid dynamic code evaluation and unsafe HTML;
- do not access the network during rendering unless the user explicitly asks for it;
- turn one bad artist into a useful error, not a crashed document;
- state which MPlot and artist schema versions you support.

An artifact may *request* a plugin, but it never gets to install or execute one automatically. The user stays in charge.

## Testing your plugin

At minimum, test:

1. that your custom Matplotlib artist is detected;
2. that saving produces the expected type and schema version;
3. that arrays survive encode/decode without changing dtype or shape;
4. that malformed records fail visibly;
5. that an unavailable renderer produces a placeholder;
6. that old schema versions keep working—or fail with a clear explanation.

Plugin APIs may still change before MPlot 1.0. If you build something interesting, please open an issue or pull request. Custom scientific artists are exactly why this interface exists!
