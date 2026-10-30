# Provenance and metadata

Every result records its creation time in UTC and, when run inside a Git repository, the commit. By default BFPlot also records:

- the Python implementation and version, and the platform;
- the BFPlot, Matplotlib, NumPy and Zstandard versions;
- the command line, script path and working directory;
- the current user.

All of it is stored under `[provenance]` in the manifest, where you can read and diff it.

## Your own values

```python
bfplot.savefig(
    "results/calibration.bfplot",
    fig,
    provenance={"sample": "crystal-17", "laser_power_mw": 12.0},
)
```

or, with [`bfplot.result()`](../reference/python-api.md#bfplotresult):

```python
with bfplot.result("results/fit.bfplot") as result:
    result.add(fig, name="fit")
    result.metadata["chi2"] = chi2
```

Both end up under `[provenance.extra]`. Values are checked when assigned; nested dictionaries are allowed.

## Less provenance

```python
bfplot.savefig("plot.bfplot", fig, provenance=False)
```

keeps only the creation time and Git commit.

> Default provenance includes absolute paths and your username. Check the manifest before publishing a result.

## Limits

BFPlot records paths, not source code, patches, lockfiles or input data. Reproducing a result still requires keeping those.
