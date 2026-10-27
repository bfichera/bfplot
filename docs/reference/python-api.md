# Python API

The Python API is intentionally small. Most scripts only need `mplot.savefig()` or `mplot.result()`.

## Paths, layouts, and overwriting

These rules apply to every function that writes a result:

- **One output is one result.** It holds all figures saved together, an optional animation, and metadata.
- **The path is used exactly as given.** No suffix is added or rewritten. If the name does not end in `.mplot`, MPlot warns but still writes exactly that path.
- **`layout="directory"`** (the default) writes a result directory with a readable `manifest.toml`. **`layout="file"`** writes one self-contained packed file. See [Choosing a file type](../guides/file-types.md).
- **Existing results are replaced.** An MPlot result at the path (either layout, or an empty directory) is replaced only after the new result is fully built. Anything else at the path raises `FileExistsError`, checked when the save starts, before expensive work.

## `mplot.savefig`

```python
mplot.savefig(
    path,
    figure=None,
    *,
    name=None,
    layout="directory",
    provenance=True,
)
```

Save one or more Matplotlib figures as one MPlot result.

| Argument | Meaning |
| --- | --- |
| `path` | Output path, used exactly as given. |
| `figure` | A Matplotlib `Figure`, an iterable of figures, or `None` for all open figures. |
| `name` | A string for one figure, or a list with one name per figure (`None` entries allowed). |
| `layout` | `"directory"` (default) or `"file"`. |
| `provenance` | `True` for automatic metadata, `False` for none, or a dictionary of additional values. |

Returns the output as a `pathlib.Path`.

```python
output = mplot.savefig("results/experiment.mplot", fig, name="experiment")
```

## `mplot.result`

```python
mplot.result(path, *, layout="directory", provenance=True)
```

Collect several figures, at most one animation, and metadata into one result. Returns an `mplot.Result`, best used as a context manager:

```python
with mplot.result("results/fit.mplot") as result:
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

Capture the figure’s state at that moment. Later changes to the figure do not affect what was captured. `figure` and `name` work as in `mplot.savefig()`.

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

Names must be non-empty and unique within a result; mistakes raise an error at `add()` time. If you do not give a name, a figure’s Matplotlib label (`plt.figure("spectrum")`) is used when it is unique. The viewer shows the name as the figure heading when the figure has no title.

## `mplot.animation`

```python
mplot.animation(
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
with mplot.animation("results/wave.mplot", fig, fps=30) as recording:
    for phase in phases:
        line.set_ydata(np.sin(x + phase))
        recording.capture()
```

## `mplot.save_animation`

```python
mplot.save_animation(
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

## `mplot.compile`

```python
mplot.compile(mir, path, *, layout="directory")
```

Compile a validated MIR document, such as the output of `mplot.translate(fig)`, into one result at exactly `path`.

## `mplot.show`

```python
mplot.show(
    figure=None,
    *,
    path=None,
    open_browser=True,
    layout="directory",
)
```

Save a result and ask the installed MPlot CLI to open it. If `path` is omitted, MPlot creates a temporary packed file.

```python
mplot.show(fig)
```

Set `open_browser=False` to create the output without launching the CLI.

## `mplot.stream`

```python
mplot.stream(path, *, provenance=True)
```

Create an append-only sequence of figure frames. Each frame is a packed file inside `<path>.mplot-stream/`.

```python
with mplot.stream("runs/detector") as stream:
    stream.append(fig)
```

`Stream.append()` and `Stream.send()` are aliases. Both accept an optional `timestamp` keyword.

## Additional artist types

MPlot does not load third-party artist exporters or viewer renderers. To add support for another Matplotlib artist, please submit a pull request that implements and tests both sides in MPlot itself.
