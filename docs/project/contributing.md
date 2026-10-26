# How to contribute

First: thank you! Scientific software gets better when the people who actually use it report confusing behavior, improve an example, add a test, or fix the thing that has been annoying them all week.

You do not need to arrive with a giant Rust feature. Documentation fixes and small reproducible bug reports are extremely useful.

## Before you start

For a small bug fix, test, or documentation improvement, feel free to get started.

For a new public API, artist schema, or file-format change, please open an issue first. These choices affect compatibility, and a short discussion can save everybody from implementing the same idea twice.

Security vulnerabilities should follow the [security policy](security.md) instead of the public issue tracker. If your change affects artifact behavior, read the [architecture contract](architecture.md).

## Finding your way around

```text
crates/          Rust format, verification, packing, server, streams, and CLI
src/mplot/       Python API, Matplotlib extraction, provenance, and plugins
viewer/          Browser interface and artist renderers
docs/            Friendly explanations of formats and plugins
tests/           Python and integration tests
scripts/         Smoke checks and release helpers
```

Try to keep changes focused. A patch that fixes contour rendering is much easier to review when it does not also reformat half the repository.

## Set up a development checkout

```console
$ python -m venv .venv
$ . .venv/bin/activate
$ python -m pip install -e '.[test,docs]'
$ npm install --prefix viewer
$ ./scripts/smoke.sh
```

Focused tests are faster while you work:

```console
$ cargo test --workspace
$ python -m pytest
$ npm --prefix viewer test
$ mkdocs build --strict
```

Run the complete smoke script before submitting code.

## What makes a good test?

- Parser and storage changes include malformed and truncated inputs.
- Numerical changes test dtype, shape, non-finite values, and empty arrays.
- Renderer changes test ordinary output and visible fallback behavior.
- Plugin changes test unsupported schema versions.
- Format changes include packed/split round trips and compatibility fixtures.

Please do not rely only on a screenshot. A screenshot tells us that pixels moved; a semantic test can tell us whether the data remained correct.

## A few non-negotiable rules

- Verify SHA-256 before decoding an object.
- Keep canonical JSON deterministic.
- Never let an artifact trigger code execution or automatic plugin installation.
- Keep network serving on loopback unless the user explicitly chooses otherwise.
- Normalize paths and enforce file, allocation, and decompression limits.
- Show unsupported artists visibly instead of quietly dropping them.

## Documentation

Documentation should be friendly, accurate, and easy to copy from. Lead with the task the user came to accomplish. A person should not need to understand content-addressed storage before seeing:

```python
mplot.savefig("my_plot", fig)
```

Please do not document planned functionality as if it already works. Honest limitations are much more useful than impressive fiction.

## Pull requests

Tell us what problem you are solving, what approach you took, whether compatibility or security changes, and which tests you ran. Add release notes for user-visible changes.

By submitting a contribution, you agree that it may be licensed under either Apache-2.0 or MIT, at the user’s option. Thanks again for helping!
