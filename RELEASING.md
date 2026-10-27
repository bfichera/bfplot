# Releasing BFPlot

A release is a `vX.Y.Z` tag. Pushing it starts two workflows:

| Workflow | Builds | Publishes (when enabled) |
| --- | --- | --- |
| `python-release.yml` | `bfplot-cli` wheels for 8 platforms and its sdist; the `bfplot` wheel and sdist; the crates | PyPI: `bfplot-cli`, then `bfplot`. crates.io: `bfplot-core`, then `bfplot-cli`. |
| `release.yml` (cargo-dist) | App archives, `sha256.sum`, shell and PowerShell installers, Homebrew formula | The GitHub release, then `bfplot.rb` to `bfplot-dev/homebrew-tap`. |

Pull requests that touch packaging run both workflows without publishing: `python-release.yml` builds and test-installs everything, and `release.yml` runs `dist plan`.

## One-time setup

Nothing below exists yet; do it once before the first release.

1. **GitHub repository.** Create `bfplot-dev/bfplot` and push `main`. Enable GitHub Pages with "GitHub Actions" as the source (for `docs.yml`).
2. **PyPI.** On <https://pypi.org/manage/account/publishing/>, add a *pending* trusted publisher for **each** of `bfplot` and `bfplot-cli`:
   - owner `bfplot-dev`, repository `bfplot`, workflow `python-release.yml`, environment `pypi`.
3. **crates.io.** The first version of each crate must be published by hand, because trusted publishing can only be set up for an existing crate:

   ```console
   $ bash scripts/stage-crates.sh
   $ cargo login
   $ cargo publish --locked --allow-dirty -p bfplot-core
   $ cargo publish --locked --allow-dirty -p bfplot-cli
   ```

   Then, for both crates, add a trusted publisher in the crate's settings on crates.io: repository `bfplot-dev/bfplot`, workflow `python-release.yml`, environment `crates-io`. Later releases are published by CI.
4. **Homebrew tap.** Create the public repository `bfplot-dev/homebrew-tap` (it can be empty). Create a fine-grained token with *Contents: read and write* on that repository only, and store it in `bfplot-dev/bfplot` as the Actions secret `HOMEBREW_TAP_TOKEN`.
5. **Environments and switches.** In the repository settings, create the environments `pypi` and `crates-io` (adding required reviewers gives a manual approval step before each upload). Then create these Actions *variables*:
   - `PUBLISH_PYPI` = `true`
   - `PUBLISH_CRATES` = `true` (after step 3)

   While a variable is unset, tag builds still run but skip that upload.

## Each release

1. Set the new version everywhere, then check it:

   ```console
   $ python scripts/check_versions.py 1.0.0
   ```

   This lists every place that needs updating: `Cargo.toml`, the `bfplot-core` dependency in `crates/bfplot-cli/Cargo.toml`, `Cargo.lock` (run `cargo update -w`), `pyproject.toml` (the version and the `bfplot-cli==` pin), `src/bfplot/__init__.py`, the fallback in `src/bfplot/provenance.py`, and `viewer/package.json` (run `npm --prefix viewer install` to update the lockfile).

   Also update the version in the docs (`README.md`, `docs/index.md`, `docs/getting-started/installation.md`, ...).
2. If the result format changed in a way older readers would misread, raise `FORMAT_VERSION` in `crates/bfplot-core/src/format.rs` and `src/bfplot/artifact.py` together, and describe the change in `docs/format.md`.
3. Do a local dry run. It builds everything for this machine into `release-dist/` and publishes nothing:

   ```console
   $ python -m pip install --group release
   $ scripts/release.sh 1.0.0
   ```

4. Commit, merge to `main`, then tag and push:

   ```console
   $ git tag v1.0.0
   $ git push origin v1.0.0
   ```

5. Watch both workflows. If a publish step fails partway, fix the cause and rerun only the failed jobs; PyPI and crates.io never accept the same version twice, so do not retag a version that was already uploaded.

A pre-release uses a tag such as `v1.0.0-rc.1` (Cargo) with `1.0.0rc1` in `pyproject.toml`; `check_versions.py` treats them as equal. cargo-dist marks it as a GitHub pre-release and skips the Homebrew update.

## Changing the build

- `dist-workspace.toml` configures cargo-dist. After editing it, regenerate the workflow with the same cargo-dist version (`cargo-dist-version` in that file): `dist generate`. Do not edit `release.yml` by hand; `dist` checks that it is up to date.
- `.github/build-setup.yml` holds the steps cargo-dist runs before building (staging the license texts and viewer).
- `python-release.yml` is maintained by hand.
