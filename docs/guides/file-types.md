# Choosing a file type

A result can be saved as a directory or as one file. Both hold the same data.

## Directories (default)

```python
mplot.savefig("results/experiment.mplot", fig)
```

```text
results/experiment.mplot/
├── manifest.toml      ← small and readable; commit this
├── .gitignore         ← "/objects/"
└── objects/sha256/…   ← this result's data
```

Use directories while you work and when you keep results in [Git](version-control.md). Copying or deleting the folder copies or deletes the whole result.

## Single files

```python
mplot.savefig("experiment.mplot", fig, layout="file")
```

Use one file to email, archive or copy a result to another machine.

## Converting

```console
$ mplot pack results/experiment.mplot shared/experiment.mplot
$ mplot unpack shared/experiment.mplot restored/experiment.mplot
```

Hashes do not change. `mplot view`, `serve` and `verify` accept both forms.

## Paths and overwriting

MPlot writes exactly the path you give it and warns if the name does not end in `.mplot`.

Saving over an existing result, in either form, replaces it. The new result is built first and swapped in only when complete, so a crash leaves the old one intact. If the path holds anything else, such as a folder of your own files, MPlot raises `FileExistsError` before doing any work.
