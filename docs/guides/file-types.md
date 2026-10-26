# Choosing a file type

MPlot can save your figure in two forms. They contain the same scientific information; they are simply convenient for different jobs.

## Split artifacts: pleasant for projects and Git

```python
mplot.savefig("results/experiment", fig)
```

This creates:

```text
results/
├── experiment.mplot.toml
└── .mplot/
    └── objects/
        └── sha256/
```

The TOML manifest is small and readable. Numerical arrays live in a content-addressed object store where identical data can be reused.

Use this form when you are actively working on an analysis, comparing outputs, or keeping manifests in version control.

## Packed artifacts: pleasant for people and archives

```python
mplot.savefig("experiment.mplot", fig)
```

This creates one self-contained file. Use it when you want to:

- email an artifact;
- attach it to a release;
- copy it to another machine;
- archive a final output;
- avoid explaining why the hidden `.mplot` directory matters.

## Convert whenever you like

```console
$ mplot pack experiment.mplot.toml experiment.mplot
$ mplot unpack experiment.mplot restored/experiment.mplot.toml
```

Packing and unpacking preserve the object hashes. The numerical data does not change just because its luggage did.

!!! tip "A useful rule of thumb"
    **Split while you work. Pack when you share.**
