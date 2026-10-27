# What MPlot is (and isn't)

MPlot saves Matplotlib figures as interactive results: plot structure, numerical arrays and provenance, opened in a local browser viewer. It is built for scripts, the command line and version control.

It is **not**:

- **a replacement for Matplotlib.** Matplotlib still makes and styles the figure.
- **a notebook system.** Notebook integration is not a goal.
- **a reproducibility machine.** A result cannot recreate code or data that were never kept.
- **finished.** 0.9.9 is a release candidate; check the plots that matter to you.

## Principles

1. Saving a plot is one function call.
2. Data never disappears silently: unsupported artists and corrupt arrays fail visibly.
3. Files are inspectable: the manifest is TOML and the document is JSON.
4. Arrays are compressed and content-addressed.
5. Results never execute code. Exporters and renderers ship with MPlot.
6. Results fit into ordinary software projects and Git.
