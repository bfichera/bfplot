# Using BFPlot with Snakemake

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

## Reproducible files

Results contain no timestamps, paths or other metadata, so the same figures always give byte-identical results with the same hash. To check that a rerun reproduced a result, compare hashes:

```python
rule check_fit:
    input: new="figures/{sample}/fit.bfplot", reference="reference/{sample}/fit.bfplot"
    output: touch("checks/{sample}/fit.same")
    shell: "bfplot compare {input.reference} {input.new}"
```

`bfplot compare` exits with status 1 when the results differ, failing the job and listing the differences.
