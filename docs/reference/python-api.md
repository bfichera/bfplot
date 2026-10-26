# Python API

The Python API is intentionally small. Most scripts only need `mplot.savefig()`.

## `mplot.savefig`

```python
mplot.savefig(
    path,
    figure=None,
    *,
    packed=None,
    provenance=True,
)
```

Save one or more Matplotlib figures as an MPlot artifact.

| Argument | Meaning |
| --- | --- |
| `path` | Output path. A `.mplot` suffix selects packed output; other names become `.mplot.toml`. |
| `figure` | A Matplotlib `Figure`, an iterable of figures, or `None` for all open figures. |
| `packed` | Override output detection with `True` or `False`. |
| `provenance` | `True` for automatic metadata, `False` for none, or a dictionary of additional values. |

Returns the final output as a `pathlib.Path`.

```python
output = mplot.savefig("results/experiment", fig)
```

## `mplot.show`

```python
mplot.show(
    figure=None,
    *,
    path=None,
    open_browser=True,
    packed=None,
)
```

Save an artifact and ask the installed MPlot CLI to open it. If `path` is omitted, MPlot creates a temporary packed artifact.

```python
mplot.show(fig)
```

Set `open_browser=False` to create the output without launching the CLI.

## `mplot.stream`

```python
mplot.stream(path, *, provenance=True)
```

Create an append-only sequence of packed figure frames.

```python
with mplot.stream("runs/detector") as stream:
    stream.append(fig)
```

`Stream.append()` and `Stream.send()` are aliases. Both accept an optional `timestamp` keyword.

## `mplot.register_artist`

```python
mplot.register_artist(
    type_name,
    artist_class,
    extractor,
    *,
    requirement=None,
)
```

Register a Python exporter for a custom Matplotlib artist. Type names must use a non-MPlot reverse-DNS namespace such as `org.example.spectrum`.

See the [plugin guide](../plugins.md) for a complete example.
