# How to contribute to MPlot

First: thank you! Scientific software gets better when the people who actually use it report confusing behavior, improve an example, add a test, or fix the thing that has been annoying them all week.

You do not need to arrive with a giant Rust feature. Documentation fixes and small reproducible bug reports are extremely useful.

## Before you start

For a small bug fix, test, or documentation improvement, feel free to get started.

For a new public API, artist schema, or file-format change, please open an issue first. These choices affect compatibility, and a short discussion can save everybody from implementing the same idea twice.

Security vulnerabilities should follow [`SECURITY.md`](SECURITY.md) instead of the public issue tracker.

If your change affects artifact behavior, read [`ARCHITECTURE.md`](ARCHITECTURE.md). It is less cheerful than this page because it defines the precise hashing, storage, artist, and safety contracts.

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

## Setting up a development checkout

You will need Python 3.10 or newer, Rust, and Node.js for viewer development.

```console
$ python -m venv .venv
$ . .venv/bin/activate
$ python -m pip install -e '.[test]'
$ npm install --prefix viewer
```

Then run everything:

```console
$ ./scripts/smoke.sh
```

The smoke script checks Rust formatting, tests, and lints; compiles and tests the Python package; and type-checks, tests, and builds the viewer.

If you only changed one component, focused tests are faster while you work:

```console
$ cargo test --workspace
$ python -m pytest
$ npm --prefix viewer test
```

Run the complete smoke script before submitting the change.

## What makes a good test?

A good test explains the behavior you care about and fails for the bug you fixed.

- Parser and storage changes should include malformed and truncated inputs.
- Numerical changes should test dtype, shape, non-finite values, and empty arrays.
- Renderer changes should test ordinary output and the visible fallback for bad data.
- Plugin changes should test unsupported schema versions.
- Format changes need a packed/split round trip and compatibility fixture.

Please do not rely only on a screenshot. A screenshot can tell us that pixels moved; a semantic test can tell us whether the data remained correct.

## A few rules that are not negotiable

MPlot handles scientific artifacts, sometimes from untrusted sources. Please preserve these boundaries:

- Verify the SHA-256 hash before decoding an object.
- Keep canonical JSON deterministic.
- Never let an artifact trigger code execution or automatic plugin installation.
- Keep network serving on loopback unless the user explicitly chooses otherwise.
- Normalize paths and enforce file, allocation, and decompression limits.
- Show unsupported artists visibly instead of quietly dropping them.

If a change needs to alter one of these rules, it needs a format/security discussion and an explicit versioning decision.

## Documentation

Documentation should be friendly, accurate, and easy to copy from. Lead with the task the user came to accomplish. Explain jargon when it is unavoidable. A person should not need to understand content-addressed storage before seeing:

```python
mplot.savefig("my_plot", fig)
```

Also, please do not document planned functionality as if it already works. Honest limitations are much more useful than impressive fiction.

## Pull requests

Tell us:

- what problem you are solving;
- what approach you took;
- whether compatibility or security behavior changes;
- which tests you ran.

Add release notes for user-visible changes. By submitting a contribution, you agree that it may be licensed under either Apache-2.0 or MIT, at the user’s option, as described in the repository license files.

Thanks again for helping. We hope working on MPlot is fun—or at least more fun than debugging a mysteriously empty Matplotlib axes!
