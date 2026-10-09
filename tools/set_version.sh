#!/bin/bash
# Sets the app version everywhere it is recorded, then checks the result:
#
#     tools/set_version.sh 0.2.0
#
# release/app/package.json is what the installers carry; the repository root is kept equal to it.
# Commit the four changed files together. Building on main then tags that commit v<version> once
# the macOS installer is signed and notarised (see docs/releasing.md).
set -euo pipefail
[ $# -eq 1 ] || { echo "usage: $0 <MAJOR.MINOR.PATCH>" >&2; exit 2; }
[[ $1 =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "not MAJOR.MINOR.PATCH: $1" >&2; exit 2; }
cd "$(dirname "$0")/.."
for dir in release/app .; do
  # --no-git-tag-version: no commit or tag here; tags come from signed builds.
  (cd "$dir" && npm version "$1" --no-git-tag-version --allow-same-version --ignore-scripts > /dev/null)
done
tools/check_version.sh
