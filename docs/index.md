---
template: home.html
hide:
  - navigation
  - toc
---

<div class="bfplot-intro" markdown>

## One new line

Make figures with Matplotlib as usual, then save them with `bfplot.savefig()` instead of as a PNG or PDF.

```python title="analysis.py" hl_lines="12"
import matplotlib.pyplot as plt
import numpy as np
import bfplot

x = np.linspace(0, 2 * np.pi, 2_000)
y = np.sin(x)

fig, ax = plt.subplots()
ax.plot(x, y, label="signal")
ax.legend()

bfplot.savefig("results/sine_wave.bfplot", fig)
```

```console
$ bfplot view results/sine_wave.bfplot
```

</div>

<div class="bfplot-feature-grid">
  <article class="bfplot-feature">
    <span class="bfplot-feature__icon">⌕</span>
    <h3>Stay interactive</h3>
    <p>Zoom, pan, inspect values, compare lines and export the view you want.</p>
  </article>
  <article class="bfplot-feature">
    <span class="bfplot-feature__icon">#</span>
    <h3>Know what you saved</h3>
    <p>Arrays are compressed, content-addressed and checked with SHA-256.</p>
  </article>
  <article class="bfplot-feature">
    <span class="bfplot-feature__icon">↗</span>
    <h3>Share without flattening</h3>
    <p>Git-friendly result directories while you work, one packed file to share.</p>
  </article>
  <article class="bfplot-feature">
    <span class="bfplot-feature__icon">⌁</span>
    <h3>Remember the context</h3>
    <p>Creation time, Git commit, versions, the command line and your own notes.</p>
  </article>
</div>

!!! note "BFPlot 0.9.9 is a release candidate"
    Please try it on real plots and tell us what behaves strangely.

## Supported plots

<div class="bfplot-support-list">
<span>Lines</span><span>Scatter</span><span>Images</span><span>Error bars</span><span>Filled regions</span><span>Histograms</span><span>Contours</span><span>Text</span><span>Patches</span><span>3D plots</span>
</div>

Anything else is shown as a visible placeholder, never silently dropped. To support another artist, open an issue or a pull request.

## Next steps

<div class="bfplot-next-grid">
<a href="getting-started/installation/">
<strong>Install</strong>
<span><code>pip install bfplot</code>: the Python package and the app.</span>
</a>
<a href="getting-started/first-plot/">
<strong>Save a plot</strong>
<span>Your first interactive result.</span>
</a>
<a href="guides/version-control/">
<strong>Use Git</strong>
<span>Commit manifests, not arrays.</span>
</a>
<a href="project/contributing/">
<strong>Contribute</strong>
<span>Add an artist type or fix a bug.</span>
</a>
</div>
