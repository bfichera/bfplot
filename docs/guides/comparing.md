# Comparing results

Every result has one hash, such as `sha256:769fe0976cfeecf73414d7b467013c6cde561405bce6c5af5828836e03016e37`. Two results have the same hash exactly when everything needed to draw them is identical: every figure, axis, artist, style, animation frame and array, down to the last bit. Results record no timestamps, paths or other metadata, so saving the same figures again gives the same hash, on any machine.

The hash describes what was saved, not the script that made it. A different Matplotlib version may place axes or ticks slightly differently for the same script; that gives a different hash, and `bfplot compare` shows exactly which values moved.

## In Python

```python
import bfplot

bfplot.hash("results/fit.bfplot")                # read from the manifest
bfplot.hash("results/fit.bfplot", verify=True)   # check every object first
bfplot.hash(fig)                                  # hash figures without writing anything
bfplot.same("old/fit.bfplot", "new/fit.bfplot")
bfplot.same(fig, "results/fit.bfplot")            # would saving fig change the result?
bfplot.verify("results/fit.bfplot")               # raise bfplot.ResultError if damaged
```

`bfplot.hash()` and `bfplot.same()` accept result paths, Matplotlib figures (or lists of figures) and `bfplot.BfirDocument`s. `bfplot.result()` exposes the hash of what it wrote:

```python
with bfplot.result("results/fit.bfplot") as result:
    result.add(fig, name="fit")
print(result.hash)
```

## On the command line

```console
$ bfplot hash results/fit.bfplot
sha256:769fe0976cfeecf73414d7b467013c6cde561405bce6c5af5828836e03016e37
$ bfplot hash results/*.bfplot
sha256:769fe0976cfeecf73414d7b467013c6cde561405bce6c5af5828836e03016e37  results/fit.bfplot
sha256:45a78207de0c593d5621a80774482b2ba8c23bce04b6264a84474147d47f1299  results/scan.bfplot
```

`bfplot compare` reports whether two results are identical and, if not, where they differ:

```console
$ bfplot compare old/fit.bfplot new/fit.bfplot
different
  sha256:769fe0976cfeecf73414d7b467013c6cde561405bce6c5af5828836e03016e37  old/fit.bfplot
  sha256:45a78207de0c593d5621a80774482b2ba8c23bce04b6264a84474147d47f1299  new/fit.bfplot
figures[0].axes[0].artists[0].data.y: array "f8" [3] sha256:17550ce41805… -> array "f8" [3] sha256:21db8363e8ff…
figures[0].axes[0].title: "Tent" -> "Tall tent"
```

It exits with status 0 if the results are identical, 1 if they differ and 2 on error, so it works in scripts and CI. `-q` prints nothing; `--verify` checks every object of both results first.

## Trusting a hash

`bfplot hash` and `bfplot.hash(path)` read the hash from the manifest without opening the data, so they are instant. To make sure the objects really match the hash, for example after copying a result, use `bfplot verify`, `bfplot hash --verify` or `bfplot.verify()`. `bfplot serve` and `bfplot view` always verify before serving.

A hash proves the content is unchanged, not who made it. BFPlot records no provenance; if you need to know where a result came from, track it with a separate tool, keyed by the hash.
