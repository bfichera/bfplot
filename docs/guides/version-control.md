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

The manifest records the document hash and provenance, so a diff shows when an output changed. It also ends with a rough text drawing of every figure, so you can see roughly what changed in a diff:

```toml
# Preview (approximate; regenerated on every save)
#
# ── calibration · Detector calibration ──────────────────────────────────
#  1.1┌──────────────── Response ─────────────────┐
#   s │⠐⠲⣄⡴⠒⠲⡄                         ⣠⠖⠂        │
#   i │ ⢠⠟⣆  ⠙⣆                      ⣰⠃          │
#   g │⢀⠏ ⠘⣆  ⠘⡆                   ⣰⠃            │
# -1.1└───────────────────────────────────────────┘
#     0                                         6.3
```

Lines, markers and outlines are drawn with Braille dots, and images and colorbars with ASCII shading. The drawing is only a sketch. It shows the first frame of an animation and skips fine detail. The lines are TOML comments, so readers ignore them. Pass `preview=False` to leave it out.

Note that a fresh clone has manifests but no data. Re-run the pipeline, or share the directory or a packed file some other way.

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

## Hashes are not signatures

Hashes tell you the bytes have not changed, not who made them. If authorship matters, sign releases some other way.
