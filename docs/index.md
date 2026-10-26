---
template: home.html
hide:
  - navigation
  - toc
---

<div class="mplot-intro" markdown>

## One new line. That’s the whole idea.

Keep making figures with Matplotlib exactly as you do now. When the plot is ready, save it with `mplot.savefig()` instead of flattening it into a PNG or PDF.

```python title="analysis.py" hl_lines="12"
import matplotlib.pyplot as plt
import numpy as np
import mplot

x = np.linspace(0, 2 * np.pi, 2_000)
y = np.sin(x)

fig, ax = plt.subplots()
ax.plot(x, y, label="signal")
ax.legend()

mplot.savefig("results/sine_wave", fig)
```

Then open it:

```console
$ mplot view results/sine_wave.mplot.toml
```

That’s it! If you already know Matplotlib, you already know almost everything you need to start using MPlot.

</div>

<div class="mplot-feature-grid">
  <article class="mplot-feature">
    <span class="mplot-feature__icon">⌕</span>
    <h3>Stay interactive</h3>
    <p>Zoom, pan, inspect values, select data, and export the view you actually want.</p>
  </article>
  <article class="mplot-feature">
    <span class="mplot-feature__icon">#</span>
    <h3>Know what you saved</h3>
    <p>Numerical arrays are compressed, content-addressed, and checked with SHA-256.</p>
  </article>
  <article class="mplot-feature">
    <span class="mplot-feature__icon">↗</span>
    <h3>Share without flattening</h3>
    <p>Use Git-friendly split outputs while you work, then pack everything into one file.</p>
  </article>
  <article class="mplot-feature">
    <span class="mplot-feature__icon">⌁</span>
    <h3>Remember the context</h3>
    <p>Save Python and package versions, script information, timestamps, and your own notes.</p>
  </article>
</div>

## Matplotlib goes in. A useful scientific artifact comes out.

Matplotlib’s interactive window is lovely. You can zoom into a suspicious bump, pan across a long time trace, and inspect details that disappear in a static image. Unfortunately, the usual way to save it is:

```python
plt.savefig("final_plot_REAL_v2.png")
```

That saves the *picture*, but not the useful interactive plot behind it. MPlot preserves the plot structure and numerical arrays too. It also records practical context such as the MPlot, Python, Matplotlib, NumPy, and Zstandard versions; command-line arguments; script path; working directory; platform; and creation time.

!!! note "MPlot 0.9.9 is a release candidate"
    Please try it on real scientific plots and tell us what behaves strangely. The goal is to make 1.0 boring—in the very best, reliable-software sense of the word.

## Works with the plots you already make

<div class="mplot-support-list">
<span>Lines</span><span>Scatter</span><span>Images</span><span>Error bars</span><span>Filled regions</span><span>Histograms</span><span>Contours</span><span>Text</span><span>Patches</span><span>3D plots</span>
</div>

Supported artists are implemented and reviewed in MPlot itself. If you need another artist type, please open an issue or submit a pull request. If a viewer encounters something it cannot draw, it shows a visible explanation instead of quietly making your data disappear.

## Pick your next stop

<div class="mplot-next-grid">
<a href="getting-started/installation/">
<strong>I want to install it</strong>
<span>Set up Python, the Rust CLI, and the viewer.</span>
</a>
<a href="getting-started/first-plot/">
<strong>I want to save a plot</strong>
<span>Walk through your first interactive output.</span>
</a>
<a href="guides/version-control/">
<strong>I care about Git</strong>
<span>Keep readable manifests without committing huge arrays.</span>
</a>
<a href="project/contributing/">
<strong>I need another artist</strong>
<span>Propose or contribute support to MPlot itself.</span>
</a>
</div>

## What MPlot is not

MPlot is not a replacement for Matplotlib. Matplotlib still makes the plot; MPlot saves the result in a form that remains interactive.

It is also not a notebook system. MPlot is deliberately designed for ordinary Python scripts, command-line workflows, saved outputs, and version control.

Finally, provenance is not a time machine. MPlot can preserve useful context, but it cannot recreate input data or source code that you never saved. Think of it as a very helpful lab assistant—not an omniscient one.
