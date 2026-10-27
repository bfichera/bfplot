#!/usr/bin/env bash
# Copy what the published crates and the bfplot-cli sdist need from outside their
# directories: the license texts, and the built viewer that bfplot-cli embeds.
# The copies are ignored by Git; rerun this after rebuilding the viewer.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

if [[ ! -f viewer/dist/index.html ]]; then
  printf 'viewer/dist is not built; run npm --prefix viewer run build.\n' >&2
  exit 1
fi

for crate in crates/bfplot-core crates/bfplot-cli; do
  cp LICENSE-APACHE LICENSE-MIT "$crate/"
done

staged=crates/bfplot-cli/viewer
rm -rf "$staged"
mkdir -p "$staged"
# Runtime files only; source maps and type declarations belong to the npm package.
(cd viewer/dist && find . -type f ! -name '*.map' ! -name '*.d.ts' ! -name '.*') |
  while read -r file; do
    mkdir -p "$staged/$(dirname "$file")"
    cp "viewer/dist/$file" "$staged/$file"
  done

printf 'Staged %s viewer files in %s\n' "$(find "$staged" -type f | wc -l | tr -d ' ')" "$staged"
