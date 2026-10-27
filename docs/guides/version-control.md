# Using BFPlot with Git

Each result directory has its own `.gitignore` that ignores its `objects/` folder. Committing a result therefore commits only its manifest:

```console
$ git add analysis.py results/
```

```text
analysis.py
results/
└── calibration.bfplot/
    ├── manifest.toml
    └── .gitignore
```

The manifest records the document hash and provenance, so a diff shows when an output changed.

!!! warning "Git keeps the manifest, not the data"
    A fresh clone has manifests without data. Re-run the pipeline, or share the directory or a packed file another way.

## Verify

```console
$ bfplot verify results/calibration.bfplot
verified 12 objects (22907 bytes)
```

This checks the manifest, the document and the SHA-256 of every object.

## Archive

```console
$ bfplot pack results/calibration.bfplot releases/calibration.bfplot
$ bfplot verify releases/calibration.bfplot
```

Store the packed file in a release, an archive or Git LFS. To diff packed files in Git, see the [CLI reference](../reference/cli.md#diffing-packed-files-in-git).

## Integrity, not authenticity

Hashes show that bytes have not changed, not who made them. Sign releases externally if authorship matters.
