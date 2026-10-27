# Provenance and metadata

A plot is much more useful when you know where it came from. MPlot records practical context automatically and lets you add the scientific details it cannot infer.

## What MPlot records

MPlot 0.9.9 records:

- creation time in UTC;
- the producing Git commit when the script or working directory is in a Git repository;
- Python implementation and version;
- operating system and platform information;
- MPlot, Matplotlib, NumPy, and Zstandard versions;
- command-line arguments;
- script path;
- working directory;
- the current user.

This information lives in the manifest, where it can be inspected and diffed.

## Add your own context

```python
mplot.savefig(
    "results/calibration.mplot",
    fig,
    provenance={
        "sample": "crystal-17",
        "temperature_kelvin": 83.5,
        "laser_power_mw": 12.0,
        "note": "background-subtracted calibration run",
    },
)
```

Use short keys and values that another scientist—or future you—can understand without consulting your memory.

With [`mplot.result()`](../reference/python-api.md#mplotresult), you can also add metadata as your script goes. Values are checked when you assign them, and nested dictionaries are fine:

```python
with mplot.result("results/fit.mplot") as result:
    result.add(fig, name="fit")
    result.metadata["chi2"] = chi2
```

Both `provenance={...}` and `result.metadata` end up under `[provenance.extra]` in the manifest.

## Disable provenance

```python
mplot.savefig("anonymous_plot.mplot", fig, provenance=False)
```

This omits environment and user details while retaining baseline processing metadata: the creation time and, when available, the producing Git commit.

## Be careful with private information

The default provenance includes absolute paths, working directory, and username. Inspect a manifest before publishing it outside your organization.

!!! warning
    MPlot 0.9.9 does not yet include a dedicated public-redaction command. Review manifests manually before sharing sensitive outputs.

## What provenance cannot do

MPlot 0.9.9 records source and working-directory *paths*, but it does not copy source code, Git patches, dependency lockfiles, or input datasets into the artifact.

Provenance is helpful context, not a time machine. Truly reproducible science still requires preserving the code, inputs, parameters, and environment needed to rerun the analysis.
