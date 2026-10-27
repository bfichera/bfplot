# What MPlot is (and isn’t)

## What is MPlot?

MPlot is a way to save Matplotlib figures as interactive scientific artifacts. It keeps the plot structure and numerical arrays, records useful provenance, and provides a fast local viewer.

It is designed around ordinary Python scripts:

```python
mplot.savefig("result.mplot", fig)
```

and ordinary command-line tools:

```console
$ mplot view result.mplot
```

## What MPlot is not

### It is not a replacement for Matplotlib

Matplotlib still creates and styles the figure. MPlot exports the result into a portable interactive format.

### It is not a notebook system

MPlot intentionally targets scripts, files, command-line workflows, and version control. Notebook integration is not a project goal.

### It is not an automatic reproducibility machine

MPlot records useful context, but an artifact cannot reconstruct code, input datasets, secrets, or external services that were never preserved.

### It is not an excuse to skip validation

Version 0.9.9 is a release candidate. Test the artists, axis scales, file sizes, and workflows that matter to your science before treating it as final archival infrastructure.

## Project principles

1. **The simple thing stays simple.** Saving a plot should be one obvious function call.
2. **Scientific data does not disappear silently.** Unsupported artists and corrupt arrays fail visibly.
3. **Files remain inspectable.** Metadata is TOML and plot structure is JSON.
4. **Large data is handled deliberately.** Arrays are compressed and content-addressed.
5. **Artifacts do not execute code.** Artist exporters and renderers ship with MPlot; artifacts cannot extend them.
6. **Scripts and version control come first.** Outputs should fit cleanly into a real scientific software project.
