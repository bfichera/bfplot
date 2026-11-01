# Releasing BFPlot

## Releasing a version

1. On GitHub, open **Actions → Release → Run workflow**.
2. Type the version, such as `1.0.0`, and press **Run workflow**.

That's all. The workflow sets the version everywhere and builds and tests the app for macOS and Linux. Only if everything passes does it commit the version to `main`, tag it and create the GitHub release, with the app archives, `install.sh` and `uninstall.sh`. If anything fails, nothing is released; fix it and run it again.

Tick **Dry run** to build and test without releasing.

A version such as `1.1.0-rc.1` is a pre-release: `install.sh` ignores it unless asked for it (`BFPLOT_VERSION=1.1.0-rc.1`).

## One-time setup

Create the repository `bfichera/bfplot` and push `main`. For the documentation site, set **Settings → Pages → Source** to **GitHub Actions**. `install.sh` downloads from the release, so the repository must be public for it to work without credentials.

## Details

- If the result format changed in a way older readers would misread, raise `FORMAT_VERSION` in `crates/bfplot-core/src/format.rs` and `src/bfplot/artifact.py` together, and describe the change in `docs/format.md`, before releasing.
- `python scripts/set_version.py X.Y.Z` is what the workflow uses to set the version; `python scripts/check_versions.py` checks that every package agrees.
