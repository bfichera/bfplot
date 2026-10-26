# Live plots

Some experiments do not finish politely before you want to look at them. MPlot can save a sequence of complete figure frames as an append-only stream.

```python
import mplot

with mplot.stream("runs/detector") as stream:
    for batch in experiment:
        update_figure(batch)
        stream.append(fig)
```

This creates:

```text
runs/detector.mplot-stream/
├── index.json
└── frames/
    ├── 00000000.mplot
    ├── 00000001.mplot
    └── ...
```

The index is replaced atomically, so readers see complete committed frames rather than half-written files.

## Record explicit times

```python
stream.append(fig, timestamp=measurement_time)
```

If you do not provide a timestamp, MPlot uses the current time.

## Close the stream safely

The context-manager form is recommended because it marks the stream closed even when the loop exits normally:

```python
with mplot.stream("runs/detector") as stream:
    stream.append(fig)
```

You can also manage it manually:

```python
stream = mplot.stream("runs/detector")
stream.append(fig)
stream.close()
```

MPlot 0.9.9 streams complete packed frames. More granular append-only numerical streams and richer live viewer updates are planned beyond this release candidate.
