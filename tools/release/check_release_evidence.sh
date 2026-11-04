#!/bin/bash
# Refuses a release whose install test is not recorded (issue 414, item 4). The point is to catch a
# forgotten step, not a forged one (Stuart, 4 Nov). Whether a screenshot shows the right thing is for
# a person to look at; the ticked checklist item is that person's word.
#
#     tools/release/check_release_evidence.sh <evidence dir> <pkg sha256> <releasing.md>
#
# The evidence dir holds the attachments of the Gitea release PR (tools/release/release.sh fetches
# them). It must hold:
#   - install-test.log: tools/check_installed_package.sh's whole output, with
#     "check_installed_package: PASSED <pkg> sha256 <the pkg's sha256>" and
#     "check_installed_package: previous release <version>: PASSED";
#   - manifest.txt: "sha256 <the pkg's sha256>", and every "- [ ] **<title>**" item of releasing.md's
#     install-test checklist, ticked: "- [x] **<title>**";
#   - every screenshot releasing.md names (`<name>.png`), each non-empty and a real PNG.
#
# Exit 0: all there. 1: something is missing; every missing thing is listed. 2: an input cannot be read.
set -uo pipefail

say() { echo "check_release_evidence: $*" >&2; }
[ $# -eq 3 ] || { say "usage: $0 <evidence dir> <pkg sha256> <releasing.md>"; exit 2; }
dir=${1%/} sha=$2 doc=$3
[[ "$sha" =~ ^[0-9a-f]{64}$ ]] || { say "not a sha256: $sha"; exit 2; }
[ -r "$doc" ] || { say "cannot read $doc"; exit 2; }
[ -d "$dir" ] || { say "REFUSED: no evidence directory $dir"; exit 1; }

# What releasing.md requires, from its install-test section only.
section=$(awk '/^## The macOS install test/ { on = 1; next } /^## / { on = 0 } on' "$doc") \
  || { say "cannot read the install-test section of $doc"; exit 2; }
titles=$(sed -n 's/^- \[ \] \*\*\(.*\)\*\*.*/\1/p' <<< "$section")
shots=$(grep -oE '`[A-Za-z0-9._-]+\.png`' <<< "$section" | tr -d '`' | sort -u)
[ -n "$titles" ] || { say "no checklist items (\"- [ ] **title**\") in the install-test section of $doc"; exit 2; }
[ -n "$shots" ] || { say "no screenshots (\`name.png\`) named in the install-test section of $doc"; exit 2; }

missing=()
log="$dir/install-test.log"
if [ ! -s "$log" ]; then
  missing+=("install-test.log (the whole output of tools/check_installed_package.sh)")
else
  grep -qE "^check_installed_package: PASSED .* sha256 $sha\$" "$log" \
    || missing+=("in install-test.log, a PASSED line for sha256 $sha (it is FAILED, or for another package)")
  grep -qE '^check_installed_package: previous release [^ ]+: PASSED$' "$log" \
    || missing+=("in install-test.log, a PASSED install over the previous release")
fi

manifest="$dir/manifest.txt"
if [ ! -s "$manifest" ]; then
  missing+=("manifest.txt (the sha256 and the ticked checklist)")
else
  grep -qxF "sha256 $sha" "$manifest" || missing+=("in manifest.txt, the line: sha256 $sha")
  while IFS= read -r title; do
    grep -qF -- "- [x] **$title**" "$manifest" || missing+=("in manifest.txt, ticked: - [x] **$title**")
  done <<< "$titles"
fi

while IFS= read -r shot; do
  f="$dir/$shot"
  if [ ! -s "$f" ]; then
    missing+=("$shot")
  elif [ "$(head -c 8 "$f" | od -An -tx1 | tr -d ' \n')" != 89504e470d0a1a0a ]; then
    missing+=("$shot as a real PNG (the file there is not one)")
  fi
done <<< "$shots"

if [ ${#missing[@]} -eq 0 ]; then
  echo "check_release_evidence: $dir holds a passing install test of sha256 $sha, the ticked checklist and every screenshot"
  exit 0
fi
say "REFUSED. Missing from the release PR's attachments (see docs/releasing.md):"
for m in "${missing[@]}"; do say "  - $m"; done
exit 1
