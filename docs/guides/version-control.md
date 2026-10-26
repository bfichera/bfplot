# Using MPlot with Git

MPlot’s split format is designed to keep the useful, readable part of a scientific output in Git without asking Git to become a high-performance numerical database.

## Ignore the object store

Add this to `.gitignore`:

```gitignore
.mplot/objects/
.mplot/cache/
```

Commit your analysis code and manifests:

```text
analysis.py
results/
└── calibration.mplot.toml
```

The manifest records the document hash and provenance, so a diff still tells you that an output changed. Large compressed arrays remain outside ordinary Git history.

!!! warning "Do not delete the only copy of your data"
    Ignoring `.mplot/objects/` means Git does not preserve those objects. Back them up separately, use shared storage, or pack important final outputs into `.mplot` files.

## Verify an output

```console
$ mplot verify results/calibration.mplot.toml
verified 12 objects (22907 bytes)
```

Verification checks the manifest, schemas, references, and SHA-256 identity of each object. A changed or corrupted byte causes a failure instead of quietly becoming tomorrow’s unexplained anomaly.

## Archive a final result

When an analysis is ready to preserve or release:

```console
$ mplot pack results/calibration.mplot.toml releases/calibration.mplot
$ mplot verify releases/calibration.mplot
```

You can store the packed file in a release system, object store, institutional archive, or Git LFS.

## What the hashes mean

Hashes provide **integrity**, not **authenticity**. They tell you that bytes still match their recorded identity. They do not prove who created those bytes. Sign release artifacts through a trusted external system if authorship matters.
