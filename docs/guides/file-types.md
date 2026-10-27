# Choosing a file type

A result can be saved as a directory or as one file. Both hold the same data.

## Directories (default)

```python
bfplot.savefig("results/experiment.bfplot", fig)
```

```text
results/experiment.bfplot/
├── manifest.toml      ← small and readable; commit this
├── .gitignore         ← "/objects/"
└── objects/sha256/…   ← this result's data
```

Use directories while you work and when you keep results in [Git](version-control.md). Copying or deleting the folder copies or deletes the whole result.

## Single files

```python
bfplot.savefig("experiment.bfplot", fig, layout="file")
```

Use one file to email, archive or copy a result to another machine.

## Converting

```console
$ bfplot pack results/experiment.bfplot shared/experiment.bfplot
$ bfplot unpack shared/experiment.bfplot restored/experiment.bfplot
```

Hashes do not change. `bfplot view`, `serve` and `verify` accept both forms.

## Paths and overwriting

BFPlot writes exactly the path you give it and warns if the name does not end in `.bfplot`.

Saving over an existing result, in either form, replaces it. The new result is built first and swapped in only when complete, so a crash leaves the old one intact. If the path holds anything else, such as a folder of your own files, BFPlot raises `FileExistsError` before doing any work.
