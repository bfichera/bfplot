# Releasing BFPlot

A release is a `vX.Y.Z` tag. Pushing it runs `.github/workflows/release.yml`, which compiles the `bfplot` app once per platform and ships those binaries everywhere:

| Where | What | Published |
| --- | --- | --- |
| PyPI | `bfplot-cli`: the app as wheels for 8 platforms, plus an sdist. `bfplot`: the pure-Python writer. | When `PUBLISH_PYPI` is `true`. `bfplot-cli` goes first, so `bfplot` never appears without its app. |
| GitHub release | `bfplot-<target>.tar.gz` (+ `.sha256`) for macOS and Linux, x86_64 and arm64; `install.sh`; `uninstall.sh`. | Always, for a tag. |
| crates.io | `bfplot-core` and `bfplot-cli`, the Rust source. | When `PUBLISH_CRATES` is `true`. `bfplot-core` goes first. |

Pull requests that touch packaging run the same workflow without publishing: every package is built and test-installed, and `install.sh` / `uninstall.sh` are run against the freshly built archives.

`install.sh` downloads from `releases/latest`, so it always gets the newest non-pre-release. Its URL never changes:

```text
https://github.com/bfplot-dev/bfplot/releases/latest/download/install.sh
```

## One-time setup

Nothing below exists yet; do it once before the first release.

1. **GitHub repository.** Create `bfplot-dev/bfplot` and push `main`. Enable GitHub Pages with "GitHub Actions" as the source (for `docs.yml`).
2. **PyPI.** On <https://pypi.org/manage/account/publishing/>, add a *pending* trusted publisher for **each** of `bfplot` and `bfplot-cli`:
   - owner `bfplot-dev`, repository `bfplot`, workflow `release.yml`, environment `pypi`.
3. **crates.io.** The first version of each crate must be published by hand, because trusted publishing can only be set up for an existing crate:

   ```console
   $ bash scripts/stage-crates.sh
   $ cargo login
   $ cargo publish --locked --allow-dirty -p bfplot-core
   $ cargo publish --locked --allow-dirty -p bfplot-cli
   ```

   Then, for both crates, add a trusted publisher in the crate's settings on crates.io: repository `bfplot-dev/bfplot`, workflow `release.yml`, environment `crates-io`. Later releases are published by CI.
4. **Environments and switches.** In the repository settings, create the environments `pypi` and `crates-io` (adding required reviewers gives a manual approval step before each upload). Then create these Actions *variables*:
   - `PUBLISH_PYPI` = `true`
   - `PUBLISH_CRATES` = `true` (after step 3)

   While a variable is unset, tag builds still create the GitHub release but skip that upload.

## Each release

1. Set the new version everywhere, then check it:

   ```console
   $ python scripts/check_versions.py 1.0.0
   ```

   This lists every place that needs updating: `Cargo.toml`, the `bfplot-core` dependency in `crates/bfplot-cli/Cargo.toml`, `Cargo.lock` (run `cargo update -w`), `pyproject.toml` (the version and the `bfplot-cli==` pin), `src/bfplot/__init__.py`, the fallback in `src/bfplot/provenance.py`, and `viewer/package.json` (run `npm --prefix viewer install` to update the lockfile).

   Also update the version in the docs (`README.md`, `docs/index.md`, `docs/getting-started/installation.md`, ...).
2. If the result format changed in a way older readers would misread, raise `FORMAT_VERSION` in `crates/bfplot-core/src/format.rs` and `src/bfplot/artifact.py` together, and describe the change in `docs/format.md`.
3. Do a local dry run. It builds everything for this machine into `release-dist/`, tries `install.sh` and `uninstall.sh` against the result, and publishes nothing:

   ```console
   $ python -m pip install --group release
   $ scripts/release.sh 1.0.0
   ```

4. Commit, merge to `main`, then tag and push:

   ```console
   $ git tag v1.0.0
   $ git push origin v1.0.0
   ```

5. Watch the workflow. If a publish step fails partway, fix the cause and rerun only the failed jobs; PyPI and crates.io never accept the same version twice, so do not retag a version that was already uploaded.

A pre-release uses a tag such as `v1.0.0-rc.1` (Cargo) with `1.0.0rc1` in `pyproject.toml`; `check_versions.py` treats them as equal. It becomes a GitHub pre-release, which `install.sh` skips unless asked for it with `BFPLOT_VERSION=1.0.0-rc.1`.
