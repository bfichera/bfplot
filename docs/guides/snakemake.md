# Using BFPlot with Snakemake

Each rule output is one result. A result directory must be declared with `directory()`:

```python
rule plot_fit:
    input: "results/{sample}/fit.npz"
    output: directory("figures/{sample}/fit.bfplot")
    script: "scripts/plot_fit.py"
```

```python
import bfplot

...

with bfplot.result(snakemake.output[0]) as result:
    result.add(fig, name="fit")
```

For a plain file output, drop `directory()` and pass `layout="file"`. BFPlot never guesses the layout from the rule.

A failed job writes nothing, and reruns replace the previous result.

## Verification step

```python
rule verify_fit:
    input: "figures/{sample}/fit.bfplot"
    output: touch("checks/{sample}/fit.verified")
    shell: "bfplot verify {input}"
```

## Reproducible files

Set `SOURCE_DATE_EPOCH` to fix `created_utc`. The same job in the same environment then writes identical bytes. Default provenance includes the platform, user and working directory, so pass `provenance=False` if the files should be identical across machines.
