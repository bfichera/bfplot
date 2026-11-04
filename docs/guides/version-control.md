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

The manifest records the result's hash, so a diff shows exactly when an output changed: if the hash line is unchanged, so is every figure and array. It also ends with a rough text drawing of every figure, so you can see roughly what changed in a diff:

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

## Verify

```console
$ bfplot verify results/calibration.bfplot
verified 12 objects (22907 bytes)
sha256:769fe0976cfeecf73414d7b467013c6cde561405bce6c5af5828836e03016e37
```

This checks the manifest, the document and the SHA-256 of every object, then prints the hash. To compare two results, see [Comparing results](comparing.md).
