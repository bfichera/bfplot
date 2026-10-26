# Contributing to MPlot

Thank you for helping improve MPlot.

## Before starting

For substantial format or public API changes, open an issue first so compatibility and ownership can be discussed. Security vulnerabilities follow [`SECURITY.md`](SECURITY.md), not the public issue tracker.

Read [`ARCHITECTURE.md`](ARCHITECTURE.md) before changing behavior. Its artifact layout, hashing, artist protocol, and safety statements are contract-level requirements.

## Repository areas

- `crates/`: Rust format/store, validation, packing, serving, streams, and CLI.
- Python package sources: Matplotlib extraction, provenance, plugin registry, typed arrays, and public Python API.
- Browser/viewer sources: dependency-light UI and renderers.
- `docs/`, `.github/`, and `scripts/`: documentation, automation, and release/smoke tooling.

Keep a change focused and avoid unrelated formatting or generated-file churn.

## Development checks

Install the toolchains needed by the component you change, then run:

```sh
./scripts/smoke.sh
```

The smoke script detects present components and runs their standard checks. Before submitting, also run focused tests for changed behavior. Changes to parsing or storage should include malformed-input and limit tests; renderer changes should test visible fallback for unsupported artists.

Documentation should use relative links and examples that can be copied. Do not document uncommitted interfaces as stable.

## Compatibility and safety

- Hash exact stored bytes and verify before decode.
- Preserve canonical JSON requirements.
- Never add artifact-triggered code execution or automatic plugin installation.
- Keep network serving loopback-only by default.
- Normalize archive and object paths and apply resource limits.
- Treat unknown artist types/schema versions visibly and losslessly where practical.

A format contract change requires updates to architecture and format documentation, compatibility tests, and an explicit versioning decision.

## Pull requests

Explain the problem and approach, identify compatibility/security effects, and list tests performed. Add release notes when user-visible behavior changes. By submitting a contribution, you agree that it may be licensed under either Apache-2.0 or MIT, at the user's option, as described in the repository license files.
