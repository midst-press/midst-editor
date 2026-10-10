#!/bin/bash
# Prints one version's entry from CHANGELOG.md (the lines under "# <version>", up to the next
# "# " heading), for use as release notes. Fails if there is no entry, or it is empty, so a
# release cannot go out without one.
#
#     tools/changelog_section.sh 0.1.0 [CHANGELOG.md]
set -euo pipefail
[ $# -ge 1 ] || { echo "usage: $0 <version> [changelog]" >&2; exit 2; }
version=$1
file=${2:-"$(dirname "$0")/../CHANGELOG.md"}
notes=$(awk -v h="# $version" '
  $0 == h { on = 1; next }
  on && /^# / { exit }
  on { print }
' "$file" | sed -e '/./,$!d')   # drop leading blank lines
[ -n "$(printf '%s' "$notes" | tr -d '[:space:]')" ] \
  || { echo "CHANGELOG.md has no entry for $version: add one under a \"# $version\" heading" >&2; exit 1; }
printf '%s\n' "$notes"
