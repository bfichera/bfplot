# Security policy

Most people can simply use MPlot normally. This page is for reporting a security problem or operating MPlot around untrusted files and public networks.

## Found a vulnerability?

Please **do not** open a public issue yet. Use GitHub’s private vulnerability reporting for `mplot-dev/mplot` under **Security → Report a vulnerability**.

A helpful report includes:

- the affected MPlot version or commit;
- the affected component (Rust core/CLI, Python exporter, viewer, plugin API, or packaging);
- reproduction steps or a minimal artifact, if it is safe to share;
- the likely impact and any known workaround.

If private GitHub reporting is unavailable, contact a maintainer privately through a verified GitHub profile and ask for a secure reporting channel. Please do not email a live exploit or sensitive scientific artifact over an unencrypted public channel.

We will acknowledge reports as soon as practical, investigate them, and coordinate a fix and disclosure. Please give us time to prepare a release before publishing details.

## Which versions receive fixes?

MPlot is currently pre-1.0. Security fixes are provided for the latest released version. Please upgrade promptly; older development snapshots may not receive patches.

## What MPlot trusts—and what it does not

An MPlot artifact is data, not code. Opening one never authorizes executable Python/native code or automatic plugin installation.

That does not make every file harmless. Parsers and renderers still need to treat artifacts as untrusted input. MPlot implementations should:

- verify every object’s SHA-256 hash before decoding it;
- keep paths confined to the intended artifact or object-store directory;
- reject malformed manifests, schemas, array metadata, and non-finite JSON;
- limit file sizes, allocations, decompression, nesting, and rendering work;
- show unsupported artists visibly rather than hiding them;
- bind servers to loopback unless the operator explicitly chooses another interface.

Hashes provide integrity: they tell you whether bytes still match their recorded identity. They do not prove who created the artifact. Use a trusted external signature when authenticity matters.

Installed plugins are ordinary trusted application code and have the privileges of the process loading them. Review and pin them just as you would any other dependency.

## Serving plots remotely

The safe default is local:

```console
$ mplot serve result.mplot.toml
```

Binding to a public interface exposes the artifact data and parser surface to the network. If you choose to do that, use authentication, TLS, isolation, access controls, and resource limits appropriate for your environment. “It was only supposed to be up for five minutes” is, unfortunately, not a security mechanism.
