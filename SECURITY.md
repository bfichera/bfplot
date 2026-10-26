# Security policy

## Supported versions

MPlot is pre-1.0. Security fixes are provided for the latest released version only. Users should upgrade promptly; older development snapshots may not receive fixes.

## Reporting a vulnerability

Please do **not** open a public issue for a suspected vulnerability. Use GitHub's private vulnerability reporting for `mplot-dev/mplot` (the repository's **Security → Report a vulnerability** page). Include:

- affected version or commit;
- affected component (Rust CLI/core, Python extraction, viewer, plugin API, or packaging);
- reproduction steps or a minimal artifact, if safe to share;
- expected impact and any known mitigations.

If private reporting is unavailable, contact the repository maintainers privately through their verified GitHub profiles and ask for a secure reporting channel. Do not send a live exploit or sensitive artifact over an unencrypted public channel.

Maintainers will acknowledge a report as soon as practical, investigate it, and coordinate disclosure and a release. Please allow time for a fix before publishing details.

## Security boundaries

MPlot artifacts are untrusted data. They never authorize executable Python/native code or automatic plugin installation. Implementations are expected to:

- verify each object's SHA-256 digest before decoding it;
- normalize and confine paths while reading split or packed artifacts;
- reject malformed manifests, documents, array metadata, and non-finite JSON;
- enforce limits on file size, allocation, decompression ratio, nesting, and render work;
- visibly degrade when an artist or plugin is unsupported;
- bind serving endpoints to loopback unless the operator explicitly chooses otherwise.

Content hashes provide integrity, not publisher authenticity. Use a trusted external signature/distribution mechanism when authenticity matters.

Installed plugins are trusted application code, not artifact content. Review and pin them as normal software dependencies. Exposing a server beyond loopback can make artifact data and parser attack surfaces remotely accessible; use authentication, transport security, isolation, and resource limits appropriate to the deployment.
