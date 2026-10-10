#!/opt/homebrew/bin/bash
# Dogfood the B -> C converter: convert the real archive with the current converter, open every result
# in the built app (e2e/dogfood-corpus.spec.ts), and judge it with deterministic oracles.
#
# Runs ONLY on the machine holding the archive. Poem text never reaches the terminal, a repository or a
# CI log: everything poem-bearing lives in one temp directory, which is deleted on exit (including on
# INT and TERM), and stale ones from a killed run are swept at the start. All tool output goes to log
# files inside it; this script prints only counts, indices (P01..) and verdicts.
#
# Usage: tools/dogfood_corpus.sh <midst-format checkout> [archive dir]
#        KEEP=1 keeps the temp directory for inspection (it still holds poems: delete it yourself).
set -uo pipefail
FORMAT=${1:?usage: tools/dogfood_corpus.sh <midst-format checkout> [archive dir]}
ARCHIVE=${2:-/Volumes/StarTechEvo990/midst-archive/poems}
EDITOR=$(cd "$(dirname "$0")/.." && pwd)
PY=/opt/homebrew/bin/python3
HELP="$EDITOR/tools/dogfood_corpus.py"
LOGFILE="$HOME/Library/Logs/midst/main.log"
PREFIX="${TMPDIR:-/tmp}/midst-dogfood-"

for stale in "$PREFIX"*; do [ -e "$stale" ] && { rm -rf "$stale"; echo "swept a stale run directory"; }; done
W=$(mktemp -d "${PREFIX}XXXXXX") || exit 2
LOG_BEFORE=$( [ -f "$LOGFILE" ] && stat -f %z "$LOGFILE" || echo 0 )
cleanup() {
  # Restore the app's persistent log to its size before the run, whatever the run did to it.
  [ -f "$LOGFILE" ] && [ "$(stat -f %z "$LOGFILE")" -gt "$LOG_BEFORE" ] && truncate -s "$LOG_BEFORE" "$LOGFILE"
  rm -rf "$EDITOR/test-results"
  if [ "${KEEP:-0}" = 1 ]; then echo "KEPT $W (it holds poems; delete it when done)"; else rm -rf "$W"; fi
}
trap cleanup EXIT
trap 'exit 130' INT TERM
mkdir -p "$W/logs" "$W/converted"
step() { local name=$1; shift; if "$@" > "$W/logs/$name.log" 2>&1; then echo "$name: ok"; else echo "$name: FAILED (log kept only with KEEP=1)"; exit 1; fi; }

step build-app npm --prefix "$EDITOR" run build
step build-harness env MIDST_EDITOR_SRC="$EDITOR" npm --prefix "$FORMAT" run build:harness
touch "$W/marker"
( cd "$FORMAT" && MIDST_CORPUS="$ARCHIVE" MIDST_OUT="$W/converted" node conformance/verify_all.cjs ) > "$W/logs/convert.log" 2>&1
rc_convert=$?
# The summary line ONLY. verify_all also prints one line per poem, starting with its file name.
summary_line=$(grep -E '^PASS [0-9]+ +FAIL [0-9]+ +ERROR [0-9]+ +of [0-9]+$' "$W/logs/convert.log")
echo "conversion: ${summary_line:-NO SUMMARY LINE} (exit $rc_convert)"
zips=$("$PY" -c 'import os,sys; print(sum(f.endswith(".midst.zip") for _,_,fs in os.walk(sys.argv[1]) for f in fs))' "$ARCHIVE")
converted=$("$PY" -c 'import os,sys; print(sum(f.endswith(".converted.midst") for f in os.listdir(sys.argv[1])))' "$W/converted")
echo "conversion: $converted converted of $zips archive files"
if [ "$rc_convert" -ne 0 ] || ! [[ "$summary_line" =~ FAIL\ 0\ +ERROR\ 0 ]] || [ "$converted" -ne "$zips" ]; then
  echo "conversion: STOPPING. Every archive file must convert and verify before the app is judged."; exit 1
fi
if ! "$PY" "$HELP" census "$W/converted"; then
  [ "${ALLOW_UNSUPPORTED:-0}" = 1 ] || { echo "census: STOPPING (ALLOW_UNSUPPORTED=1 to continue and see what the app does)"; exit 1; }
fi
"$PY" "$HELP" manifest "$W/converted" "$W" || { echo "manifest: STOPPING (a control could not be built)"; exit 1; }
"$PY" "$HELP" probe "$W" "$EDITOR" || exit 1

( cd "$EDITOR" && MIDST_DOGFOOD_MANIFEST="$W/manifest.json" npx playwright test e2e/dogfood-corpus.spec.ts \
    --reporter=list --output="$W/pw-output" ) > "$W/logs/playwright.log" 2>&1
echo "playwright: exit $?"
echo
"$PY" "$HELP" summary "$W"; rc_summary=$?
echo
"$PY" "$HELP" leaks "$W" "$LOGFILE" "$LOG_BEFORE" "$W/marker" "$EDITOR" "$FORMAT"; rc_leaks=$?
exit $(( rc_summary || rc_leaks ))
