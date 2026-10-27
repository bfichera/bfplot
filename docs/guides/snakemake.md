# Using MPlot with Snakemake

MPlot fits naturally into a Snakemake workflow: each rule output is one result.

## Declare result directories

With the default directory layout, a result is a folder, so the rule must declare its output with `directory()`:

```python title="Snakefile"
rule plot_fit:
    input: "results/{sample}/fit.npz"
    output: directory("figures/{sample}/fit.mplot")
    script: "scripts/plot_fit.py"
```

```python title="scripts/plot_fit.py"
import mplot

...

with mplot.result(snakemake.output[0]) as result:
    result.add(fig, name="fit")
```

!!! tip "Snakemake says the output is a directory?"
    That means `directory()` is missing from the rule. Add it and you are done.

## Prefer a plain file?

Pass `layout="file"` and declare a normal output, without `directory()`:

```python
with mplot.result(snakemake.output[0], layout="file") as result:
    result.add(fig, name="fit")
```

MPlot does not guess the layout from the Snakemake rule; you choose it explicitly.

## Reruns and failures

Snakemake deletes outputs before rerunning a job, and MPlot replaces existing results anyway, so reruns just work. With `mplot.result()`, a job that fails writes nothing, so Snakemake never sees a half-finished result.

## Check your outputs

`mplot verify` makes a handy check step:

```python title="Snakefile"
rule verify_fit:
    input: "figures/{sample}/fit.mplot"
    output: touch("checks/{sample}/fit.verified")
    shell: "mplot verify {input}"
```

## Reproducible packed files

Set `SOURCE_DATE_EPOCH` to fix the recorded `created_utc`. Rerunning the same job in the same environment then produces a byte-for-byte identical packed file. Provenance still records details such as the platform, user and working directory, so results made on different machines differ in their manifests; pass `provenance=False` if you need identical files everywhere.
