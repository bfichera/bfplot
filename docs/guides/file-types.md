# Choosing a file type

Every MPlot output holds one result: all the figures you saved together, an optional animation, and metadata. A result can live on disk in two forms. They contain the same scientific information; they are simply convenient for different jobs.

MPlot uses your path exactly as given. If the name does not end in `.mplot`, it warns you but still writes exactly that path.

## Result directories: pleasant for projects and Git

```python
mplot.savefig("results/experiment.mplot", fig)
```

This is the default. It creates:

```text
results/experiment.mplot/
├── manifest.toml      ← small, readable; commit this
├── .gitignore         ← written by MPlot, contains "/objects/"
└── objects/sha256/…   ← this result's numerical data only
```

The TOML manifest is small and readable. Numerical arrays live in the `objects/` folder, and nothing is shared with other results. Copying, zipping, or deleting the folder copies, zips, or deletes the whole result.

Use this form when you are actively working on an analysis, comparing outputs, or keeping manifests in version control. See [Using MPlot with Git](version-control.md).

## Single files: pleasant for people and archives

```python
mplot.savefig("experiment.mplot", fig, layout="file")
```

This creates one self-contained packed file with the same manifest and object hashes. Use it when you want to:

- email a result;
- attach it to a release;
- copy it to another machine;
- archive a final output.

## Convert whenever you like

```console
$ mplot pack results/experiment.mplot shared/experiment.mplot
$ mplot unpack shared/experiment.mplot restored/experiment.mplot
```

Packing and unpacking preserve the object hashes. The numerical data does not change just because its luggage did. `mplot view`, `mplot serve`, and `mplot verify` accept both forms.

!!! tip "A useful rule of thumb"
    **Directories while you work, single files when you share.**

## Saving over an old result

Saving to a path that already holds an MPlot result (in either form, or an empty directory) replaces it. The new result is fully built first and only then swapped in, so a crash halfway through leaves the old one alone. Replacing a directory also drops the data of the old version.

If the path holds something that is *not* an MPlot result—a folder with your own files, a plain text file—MPlot refuses to touch it and raises `FileExistsError`. It checks this when the save starts, before any expensive work.

## Older artifacts

Earlier versions of MPlot wrote a `*.mplot.toml` manifest next to a shared hidden `.mplot/objects/` folder. MPlot no longer writes this form, but it can still view, verify, and pack it:

```console
$ mplot pack old.mplot.toml new.mplot
```
