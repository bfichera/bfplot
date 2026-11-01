# What BFPlot is (and isn't)

BFPlot is a format for interactive plots, with a viewer and a Python implementation that saves Matplotlib figures. A result holds plot structure and numerical arrays, identified by one hash, and is opened in a browser viewer. It is built for scripts, the command line and version control.

It is **not**:

- **a replacement for Matplotlib.** Matplotlib still makes and styles the figure.
- **a notebook system.** Notebook integration is not a goal.
- **a reproducibility or provenance tool.** A result records no metadata about how it was made, and can't recreate code or data you didn't keep. Its hash tells you whether two results are identical.
- **finished.** BFPlot is young, so check the plots that matter to you.

## Principles

1. Saving a plot is one function call.
2. Data is never dropped silently. Unsupported artists and corrupt arrays fail visibly.
3. Files are inspectable: the manifest is TOML and the document is JSON.
4. Arrays are compressed and content-addressed, and every result has one hash: equal hashes mean identical results.
5. Results never execute code. Exporters and renderers ship with BFPlot.
6. Results fit into ordinary software projects and Git.
