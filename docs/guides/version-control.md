# Using MPlot with Git

MPlot’s result directories are designed to keep the useful, readable part of a scientific output in Git without asking Git to become a high-performance numerical database.

## Commit your results

No `.gitignore` setup is needed. Each result directory contains its own `.gitignore` that ignores its `objects/` folder, so:

```console
$ git add analysis.py results/
```

stages your code plus the small manifests:

```text
analysis.py
results/
└── calibration.mplot/
    ├── manifest.toml
    └── .gitignore
```

The manifest records the document hash and provenance, so a diff still tells you that an output changed. Large compressed arrays remain outside ordinary Git history.

!!! warning "Git keeps the manifest, not the data"
    A fresh clone has manifests without their numerical data. Re-run the pipeline to recreate it, or share the result directory or a packed file another way. Do not delete the only copy of important data.

## Verify an output

```console
$ mplot verify results/calibration.mplot
verified 12 objects (22907 bytes)
```

Verification checks the manifest, schemas, references, and SHA-256 identity of each object. A changed or corrupted byte causes a failure instead of quietly becoming tomorrow’s unexplained anomaly.

## Archive a final result

When an analysis is ready to preserve or release:

```console
$ mplot pack results/calibration.mplot releases/calibration.mplot
$ mplot verify releases/calibration.mplot
```

You can store the packed file in a release system, object store, institutional archive, or Git LFS.

## Readable diffs for packed files

Git already diffs a result directory’s `manifest.toml` as text. If you commit packed files, teach Git to show their manifests too:

```text title=".gitattributes"
*.mplot diff=mplot
```

```console
$ git config diff.mplot.textconv "mplot manifest"
```

## What the hashes mean

Hashes provide **integrity**, not **authenticity**. They tell you that bytes still match their recorded identity. They do not prove who created those bytes. Sign release artifacts through a trusted external system if authorship matters.
