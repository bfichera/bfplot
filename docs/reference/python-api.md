# Python API

Most scripts only need `bfplot.savefig()` or `bfplot.result()`.

## Paths, layouts, and overwriting

These rules apply to every function that writes a result:

- **One output is one result.** It holds all figures saved together, an optional animation, and metadata.
- **The path is used exactly as given.** No suffix is added or rewritten. If the name does not end in `.bfplot`, BFPlot warns but still writes exactly that path.
- **`layout="directory"`** (the default) writes a result directory with a readable `manifest.toml`. **`layout="file"`** writes one self-contained packed file. See [Choosing a file type](../guides/file-types.md).
- **Existing results are replaced.** A BFPlot result at the path (either layout, or an empty directory) is replaced only after the new result is fully built. Anything else at the path raises `FileExistsError`, checked when the save starts, before expensive work.

## `bfplot.savefig`

```python
bfplot.savefig(
    path,
    figure=None,
    *,
    name=None,
    layout="directory",
    provenance=True,
    preview=True,
)
```

Save one or more Matplotlib figures as one BFPlot result.

| Argument | Meaning |
| --- | --- |
| `path` | Output path, used exactly as given. |
| `figure` | A Matplotlib `Figure`, an iterable of figures, or `None` for all open figures. |
| `name` | A string for one figure, or a list with one name per figure (`None` entries allowed). |
| `layout` | `"directory"` (default) or `"file"`. |
| `provenance` | `True` for automatic metadata, `False` for none, or a dictionary of additional values. |
| `preview` | End the manifest with a rough text drawing of the figures, as TOML comments. `bfplot.result()`, `bfplot.animation()`, `bfplot.save_animation()` and `bfplot.compile()` take the same argument. |

Returns the output as a `pathlib.Path`.

```python
output = bfplot.savefig("results/experiment.bfplot", fig, name="experiment")
```

## `bfplot.result`

```python
bfplot.result(path, *, layout="directory", provenance=True, preview=True)
```

Collect several figures, at most one animation, and metadata into one result. Returns a `bfplot.Result`, best used as a context manager:

```python
with bfplot.result("results/fit.bfplot") as result:
    result.add(fig_spectrum, name="spectrum")
    result.add(fig_residuals, name="residuals")
    with result.animation(fig_evolution, name="evolution", fps=12) as anim:
        for t in times:
            update(t)
            anim.capture()
    result.metadata["chi2"] = chi2
```

Nothing is written until the `with` block ends. If the block raises, nothing is written and any previous result at the path is left untouched. An empty result raises `ValueError`.

### `Result.add`

```python
result.add(figure=None, *, name=None)
```

Capture the figure’s state at that moment. Later changes to the figure do not affect what was captured. `figure` and `name` work as in `bfplot.savefig()`.

### `Result.animation`

```python
result.animation(figure=None, *, name=None, fps=30, loop=True)
```

Record a timeline for some figures of the result; call `capture()` on the returned recording after each update. A result holds at most one animation, and other figures stay static. An animation that is still open is closed when the result closes.

### `Result.metadata`

A dictionary of your own metadata. Values are checked when assigned: NumPy scalars and arrays and `Path` objects are converted, nested dictionaries are allowed, and unsupported objects raise `TypeError` immediately. The values are stored under `[provenance.extra]` in the manifest, together with any `provenance={...}` dictionary.

### `Result.names`

The names of the figures captured so far, in result order.

### Figure names

Names must be non-empty and unique within a result; mistakes raise an error at `add()` time. If you do not give a name, a figure’s Matplotlib label (`plt.figure("spectrum")`) is used when it is unique. The viewer shows the name as the figure heading when the figure has no title. A figure’s title is its `suptitle()`.

## `bfplot.animation`

```python
bfplot.animation(
    path,
    figure=None,
    *,
    fps=30,
    layout="directory",
    provenance=True,
    loop=True,
)
```

Record changes to existing Matplotlib figures as one animated result:

```python
with bfplot.animation("results/wave.bfplot", fig, fps=30) as recording:
    for phase in phases:
        line.set_ydata(np.sin(x + phase))
        recording.capture()
```

## `bfplot.save_animation`

```python
bfplot.save_animation(
    path,
    figure,
    frames,
    update,
    *,
    fps=30,
    layout="directory",
    provenance=True,
    loop=True,
)
```

Call `update(frame)` for each item in `frames` and capture the resulting figure state. Returns the output path.

## `bfplot.translate` and `bfplot.compile`

```python
bfplot.translate(figure=None, *, metadata=None)
bfplot.compile(bfir, path, *, layout="directory")
```

`translate` turns Matplotlib figures into a validated `bfplot.BfirDocument`, BFPlot's intermediate representation. `compile` writes a BFIR document as one result at exactly `path`. `savefig` is the two combined. Producers in other languages can write BFIR directly; its schema is `src/bfplot/bfir.schema.json`.

## `bfplot.show`

```python
bfplot.show(
    figure=None,
    *,
    path=None,
    open_browser=True,
    layout="directory",
)
```

Save a result and ask the installed BFPlot CLI to open it. If `path` is omitted, BFPlot creates a temporary packed file.

```python
bfplot.show(fig)
```

Set `open_browser=False` to create the output without launching the CLI.

## Additional artist types

BFPlot does not load third-party exporters or renderers. To support another Matplotlib artist, send a pull request that implements and tests both sides in BFPlot.
