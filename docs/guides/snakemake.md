# Using BFPlot with Snakemake

Each rule output is one result. A result directory must be declared with `directory()`:

```python title="Snakefile"
rule plot_fit:
    input: "results/{sample}/fit.npz"
    output: directory("figures/{sample}/fit.bfplot")
    script: "scripts/plot_fit.py"
```

```python title="scripts/plot_fit.py"
import bfplot

...

with bfplot.result(snakemake.output[0]) as result:
    result.add(fig, name="fit")
```

For a plain file output, drop `directory()` and pass `layout="file"`. BFPlot never guesses the layout from the rule.

A failed job writes nothing, and reruns replace the previous result.

## Verification step

```python title="Snakefile"
rule verify_fit:
    input: "figures/{sample}/fit.bfplot"
    output: touch("checks/{sample}/fit.verified")
    shell: "bfplot verify {input}"
```

## Reproducible files

Set `SOURCE_DATE_EPOCH` to fix `created_utc`; the same job in the same environment then writes identical bytes. Default provenance includes the platform, user and working directory, so use `provenance=False` for files that are identical across machines.
