#!/bin/bash
# Fails unless the app component carries the expected-version its postinstall checks against, equal
# byte for byte to the version the package says it installs (midst-editor issue 16, rollback).
#
#     tools/check_pkg_expected_version.sh release/build/Midst-0.9.5-arm64.pkg [more.pkg ...]
#
# Why: the app's postinstall decides whether the new Midst is in place by comparing Midst.app's
# CFBundleShortVersionString with the expected-version file beside it in the component's Scripts. If
# that file is missing, the check cannot pass and every install rolls back; if it names another
# version, a wrong app passes, or a right one is rolled back. finish_pkg writes it from the
# Distribution's <product version>; this reads the built package to see that it did.
#
# How: expand the package; the Distribution's <product ... version="V">; the app component (the one
# whose PackageInfo lists a bundle) holds Scripts/expected-version, whose bytes are exactly V, with
# no newline.
#
# CONTROL, every run: three throwaway product archives are built here, with expected-version equal
# to the product version, different from it, and equal plus a newline. The detector must pass the
# first and fail the other two. If it cannot, the result means nothing and the exit status is 2.
#
# Exit 0: every package carries the right expected-version. 1: at least one does not. 2: the check
# could not run. macOS only.
set -euo pipefail
[ $# -ge 1 ] || { echo "usage: $0 <installer.pkg> [more.pkg ...]" >&2; exit 2; }
for tool in pkgbuild productbuild pkgutil; do
  command -v "$tool" > /dev/null || { echo "$0: $tool not found (this check runs on macOS)" >&2; exit 2; }
done

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# Prints "ok" or what is wrong, for one package. Returns 2 if the package cannot be read at all.
verdict() {
  local out="$work/expanded.$RANDOM$RANDOM"
  pkgutil --expand "$1" "$out" > /dev/null || { echo "$0: could not expand $1" >&2; return 2; }
  [ -f "$out/Distribution" ] || { echo "no Distribution (not a product archive)"; return 0; }
  local product
  product=$(grep -o '<product [^>]*>' "$out/Distribution" | sed -n 's/.* version="\([^"]*\)".*/\1/p' | head -n 1)
  [ -n "$product" ] || { echo "the Distribution names no <product version>"; return 0; }
  # The app component: the one whose PackageInfo lists a bundle.
  local comp="" info
  while IFS= read -r info; do
    if grep -q '<bundle ' "$info"; then comp=$(dirname "$info"); fi
  done < <(find "$out" -name PackageInfo -type f)
  [ -n "$comp" ] || { echo "no component installs an app"; return 0; }
  local file="$comp/Scripts/expected-version"
  [ -f "$file" ] || { echo "$(basename "$comp") has no Scripts/expected-version"; return 0; }
  # Compared as bytes: a trailing newline is a mismatch, as it is to the postinstall.
  if cmp -s "$file" <(printf '%s' "$product"); then
    echo ok
  else
    echo "$(basename "$comp") expected-version is $(od -An -c "$file" | tr -s ' ' | head -c 80), the package installs \"$product\""
  fi
}

# The controls: one empty app, packaged three ways.
app="$work/root/Control.app/Contents"
mkdir -p "$app/MacOS"
cat > "$app/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>invalid.example.expected-version-control</string>
<key>CFBundleName</key><string>Control</string>
<key>CFBundleExecutable</key><string>Control</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>0.0.1</string>
<key>CFBundleVersion</key><string>0.0.1</string>
</dict></plist>
PLIST
printf '#!/bin/sh\n' > "$app/MacOS/Control"
chmod +x "$app/MacOS/Control"
control() { # <name> <expected-version bytes>: builds $work/<name>.pkg, a product archive at version 0.0.1
  local scripts="$work/scripts-$1" parts="$work/parts-$1"
  mkdir -p "$scripts" "$parts"
  printf '#!/bin/sh\nexit 0\n' > "$scripts/postinstall"
  chmod +x "$scripts/postinstall"
  printf '%s' "$2" > "$scripts/expected-version"
  pkgbuild --root "$work/root" --identifier invalid.example.expected-version-control --version 0.0.1 \
    --scripts "$scripts" --install-location /Applications "$parts/control.pkg" > /dev/null
  cat > "$work/dist-$1.xml" <<XML
<?xml version="1.0" encoding="utf-8"?>
<installer-gui-script minSpecVersion="1">
    <product id="invalid.example.expected-version-control" version="0.0.1"/>
    <title>Control</title>
    <choices-outline><line choice="default"/></choices-outline>
    <choice id="default" title="Control"><pkg-ref id="invalid.example.expected-version-control"/></choice>
    <pkg-ref id="invalid.example.expected-version-control" version="0.0.1">control.pkg</pkg-ref>
</installer-gui-script>
XML
  productbuild --distribution "$work/dist-$1.xml" --package-path "$parts" "$work/$1.pkg" > /dev/null
}
control right "0.0.1"
control wrong "0.0.2"
control newline $'0.0.1\n'
seen_right=$(verdict "$work/right.pkg")
seen_wrong=$(verdict "$work/wrong.pkg")
seen_newline=$(verdict "$work/newline.pkg")
if [ "$seen_right" != ok ] || [ "$seen_wrong" = ok ] || [ "$seen_newline" = ok ]; then
  echo "$0: CONTROL FAILED. Matching, different and newline-terminated expected-version read as" \
    "\"$seen_right\", \"$seen_wrong\", \"$seen_newline\" (expected ok, then two failures)," \
    "so nothing can be concluded about the real package." >&2
  exit 2
fi

status=0
for pkg in "$@"; do
  [ -f "$pkg" ] || { echo "$0: no such file: $pkg" >&2; exit 2; }
  v=$(verdict "$pkg")
  if [ "$v" = ok ]; then
    echo "$(basename "$pkg"): the app component's expected-version is the version it installs (control holds)"
  else
    echo "$(basename "$pkg"): WRONG expected-version: $v. The app's postinstall would roll back a good install or pass a wrong one." >&2
    status=1
  fi
done
exit "$status"
