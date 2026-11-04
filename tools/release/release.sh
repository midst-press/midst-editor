#!/bin/bash
# Starts a release, but only once the macOS install test for that exact package is attached to the
# Gitea release PR (issue 414). The GitHub release workflow cannot reach Gitea, so this is where it is
# enforced, and docs/releasing.md makes this the only documented way to release.
#
#     tools/release/release.sh <package run number> <Gitea release PR number>
#
# It downloads the run's macOS package and takes its sha256, fetches the PR's attachments, and runs
# tools/release/check_release_evidence.sh on them against docs/releasing.md at the run's commit. Only
# if that passes does it run `gh workflow run release -f run_id=<run>`.
#
# Needs: gh, logged in to GitHub; a Gitea token in GITEA_TOKEN or in
# ~/ai/ClaudeInstanceHomeOffices/$AI_FULL_NAME/${AI_FULL_NAME}_gitea_token.
# GITHUB_REPO (midst-press/midst-editor), GITEA_REPO (The_Kindled/midst-editor) and GITEA_URL
# (http://gitea-server:3000) override the defaults.
#
# Exit 0: the release workflow was started. 1: refused (says what is missing). 2: could not check.
set -uo pipefail

here=$(cd "$(dirname "$0")" && pwd)
say() { echo "release: $*" >&2; }
cannot() { say "CANNOT CHECK: $*"; exit 2; }

[ $# -eq 2 ] || { say "usage: $0 <package run number> <Gitea release PR number>"; exit 2; }
run=$1 pr=$2
[[ "$run" =~ ^[0-9]+$ ]] || cannot "the package run must be its number, got: $run"
[[ "$pr" =~ ^[0-9]+$ ]] || cannot "the release PR must be its number, got: $pr"
gh_repo=${GITHUB_REPO:-midst-press/midst-editor}
gitea_repo=${GITEA_REPO:-The_Kindled/midst-editor}
gitea_url=${GITEA_URL:-http://gitea-server:3000}
token=${GITEA_TOKEN:-}
if [ -z "$token" ] && [ -n "${AI_FULL_NAME:-}" ]; then
  token=$(cat "$HOME/ai/ClaudeInstanceHomeOffices/$AI_FULL_NAME/${AI_FULL_NAME}_gitea_token" 2> /dev/null) || token=""
fi
[ -n "$token" ] || cannot "no Gitea token: set GITEA_TOKEN"
for tool in gh curl jq git shasum; do command -v "$tool" > /dev/null || cannot "$tool is not installed"; done

work=$(mktemp -d "${TMPDIR:-/tmp}/midst-release.XXXXXX") || cannot "could not make a work directory"
trap 'rm -rf "$work"' EXIT

# The package being released, and the commit it was built from.
commit=$(gh run view "$run" -R "$gh_repo" --json headSha --jq .headSha) || cannot "cannot read package run $run on $gh_repo"
gh run download "$run" -R "$gh_repo" -p 'midst-macos-*' -D "$work/pkg" > "$work/download.log" 2>&1 \
  || { cat "$work/download.log" >&2; cannot "cannot download run $run's macOS package"; }
pkgs=("$work"/pkg/midst-macos-*/*.pkg)
[ ${#pkgs[@]} -eq 1 ] && [ -f "${pkgs[0]}" ] || cannot "expected one .pkg in run $run's macOS artifact, found ${#pkgs[@]}"
sha=$(shasum -a 256 "${pkgs[0]}" | cut -d' ' -f1) || cannot "cannot hash ${pkgs[0]}"
say "package run $run: $(basename "${pkgs[0]}"), sha256 $sha, commit $commit"

# A failed fetch is not yet a failure: the commit may already be here. Its error is shown if the
# read below then fails.
git -C "$here/../.." fetch --quiet origin "$commit" > "$work/git.log" 2>&1
git -C "$here/../.." show "$commit:docs/releasing.md" > "$work/releasing.md" 2>> "$work/git.log" \
  || { cat "$work/git.log" >&2; cannot "cannot read docs/releasing.md at $commit"; }

# The release PR's attachments.
api="$gitea_url/api/v1/repos/$gitea_repo/issues/$pr/assets"
code=$(curl -sS -o "$work/assets.json" -w '%{http_code}' -H "Authorization: token $token" "$api") \
  || cannot "cannot reach $api"
[ "$code" = 200 ] || cannot "$api answered HTTP $code"
mkdir "$work/evidence"
names=$(jq -r '.[].name' "$work/assets.json") || cannot "cannot read the attachment list from $api"
while IFS=$'\t' read -r name url; do
  [ -n "$name" ] || continue
  [[ "$name" =~ ^[A-Za-z0-9._-]+$ ]] || { say "ignoring attachment with an unexpected name: $name"; continue; }
  curl -sSf -o "$work/evidence/$name" -H "Authorization: token $token" "$url" || cannot "cannot download attachment $name"
done < <(jq -r '.[] | [.name, .browser_download_url] | @tsv' "$work/assets.json")
say "release PR $pr has $(wc -l <<< "$names" | tr -d ' ') attachment(s)"

"$here/check_release_evidence.sh" "$work/evidence" "$sha" "$work/releasing.md"
rc=$?
[ "$rc" = 0 ] || { say "the release was NOT started."; exit "$rc"; }

gh workflow run release -R "$gh_repo" -f run_id="$run" || { say "the evidence passed, but starting the release workflow failed"; exit 2; }
say "release workflow started for package run $run (sha256 $sha)"
