# Security policy

## Reporting a vulnerability

Please **do not** open a public issue. Use GitHub's private vulnerability reporting for `bfplot-dev/bfplot` (**Security → Report a vulnerability**). Include the version or commit, the component (Rust core/CLI, Python package, viewer), reproduction steps or a minimal result if safe to share, and the likely impact.

If private reporting is unavailable, contact a maintainer privately through a verified GitHub profile and ask for a secure channel.

BFPlot is pre-1.0; fixes go into the latest release only.

## Untrusted results

A result is data, never code, but parsers and renderers must still treat it as untrusted input. BFPlot:

- verifies every object's SHA-256 before decoding it;
- keeps paths inside the result directory;
- rejects malformed manifests, documents, array metadata and non-finite JSON;
- shows unsupported artists visibly instead of hiding them;
- does not load third-party exporters or renderers;
- binds the server to loopback unless told otherwise.

Hashes provide integrity, not authenticity. Use an external signature when authorship matters.

## Serving remotely

`bfplot serve --bind` on a public interface exposes the result and the parsers to the network, without authentication or TLS. Put it behind an authenticated reverse proxy with access controls.
