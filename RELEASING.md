# Releasing BFPlot

## Releasing a version

1. On GitHub, open **Actions → Release → Run workflow**.
2. Type the version, such as `1.0.0`, and press **Run workflow**.

That's all. The workflow sets the version everywhere, builds the app for every platform and tests every package. Only if everything passes does it commit the version to `main`, tag it, create the GitHub release (with `install.sh` and `uninstall.sh`) and publish to PyPI. If anything fails, nothing is published; fix it and run it again.

Tick **Dry run** to do everything except publishing.

A version such as `1.1.0-rc.1` is a pre-release: pip and `install.sh` ignore it unless asked for it (`pip install --pre bfplot`, `BFPLOT_VERSION=1.1.0-rc.1`).

## One-time setup

Before the first release:

1. **GitHub.** Create the public repository `bfichera/bfplot` and push `main`. In **Settings → Pages**, set the source to **GitHub Actions** for the documentation site.
2. **PyPI.** Sign in to <https://pypi.org>, open [Publishing](https://pypi.org/manage/account/publishing/), and add a pending publisher for `bfplot-cli`, then the same for `bfplot`:

   | Field | Value |
   | --- | --- |
   | PyPI project name | `bfplot-cli` (then `bfplot`) |
   | Owner | `bfichera` |
   | Repository name | `bfplot` |
   | Workflow name | `release.yml` |
   | Environment name | `pypi` |

   No passwords or tokens are stored anywhere: PyPI trusts this workflow directly.

Optionally, in **Settings → Environments → pypi**, add yourself as a required reviewer to approve each upload by hand.

### crates.io (optional)

To also publish the Rust crates, create an API token at <https://crates.io/settings/tokens> (scopes `publish-new` and `publish-update`) and save it in **Settings → Secrets and variables → Actions** as `CARGO_REGISTRY_TOKEN`. Without that secret, releases skip crates.io.

## Details

- If the result format changed in a way older readers would misread, raise `FORMAT_VERSION` in `crates/bfplot-core/src/format.rs` and `src/bfplot/artifact.py` together, and describe the change in `docs/format.md`, before releasing.
- `python scripts/set_version.py X.Y.Z` is what the workflow uses to set the version; `python scripts/check_versions.py` checks that every package agrees.
- `scripts/release.sh` builds everything for your own machine into `release-dist/` and publishes nothing. It is a local dry run, not part of releasing.
- PyPI and crates.io never accept the same version twice. If a run fails after the PyPI upload (rare), release the next patch version.
