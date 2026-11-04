#!/bin/bash
# Fails when a macOS installer package lists an install script more than once (midst-editor issue 16;
# the double preinstall run of #353).
#
#     tools/check_pkg_scripts_listed_once.sh release/build/Midst-0.9.4-arm64.pkg [more.pkg ...]
#
# Why: the 0.9.3 and 0.9.4 packages list preinstall twice in PackageInfo, once as the app bundle's
# script (component-id=...) and once as the package's own script, and macOS Installer runs every
# entry. So preinstall ran twice in each install, in the same sandbox. The preinstall's completion
# marker makes the second run harmless, but a script the installer runs twice is a defect in the
# package, and the guard should not be the only thing standing between it and a poet's apps.
#
# How: in every PackageInfo, each kind of script (preinstall, postinstall) must be listed at most once.
#
# CONTROL, every run: two throwaway packages are built here from the same scripts directory, one
# whose component plist also names the preinstall as the bundle's script (how a package comes to
# list it twice) and one that does not. The detector must tell them apart. If it cannot, the result
# means nothing and the exit status is 2.
#
# Exit 0: every script is listed once. 1: at least one is listed more than once. 2: the check could
# not run. macOS only.
set -euo pipefail
[ $# -ge 1 ] || { echo "usage: $0 <installer.pkg> [more.pkg ...]" >&2; exit 2; }
for tool in pkgbuild pkgutil plutil; do
  command -v "$tool" > /dev/null || { echo "$0: $tool not found (this check runs on macOS)" >&2; exit 2; }
done

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# Prints the number of PackageInfo files in the package that list some kind of script more than once,
# followed by what they list twice, one "<PackageInfo dir> <kind> <count>" per line on stderr. A
# product archive (what electron-builder makes) holds one component package per directory; a component
# package holds PackageInfo at its top. Both are covered by searching the expanded tree.
listing_twice() {
  local out="$work/expanded.$RANDOM$RANDOM"
  pkgutil --expand "$1" "$out" > /dev/null || { echo "$0: could not expand $1" >&2; return 2; }
  local infos
  # Fails closed: a find that fails part-way has listed only some of the tree, so its silence about
  # the rest is not a clean result.
  infos=$(find "$out" -name PackageInfo -type f) || { echo "$0: find failed under the expanded $1" >&2; return 2; }
  [ -n "$infos" ] || { echo "$0: no PackageInfo inside $1" >&2; return 2; }
  local n=0 info dups
  while IFS= read -r info; do
    # Script entries are elements named after their kind, inside <scripts>: <preinstall .../>.
    # Fails closed: an awk that fails prints nothing, which must not read as "no duplicates".
    dups=$(awk '/<scripts>/ { inside = 1 } /<\/scripts>/ { inside = 0 }
               inside && match($0, /<(pre|post)install[ \/>]/) {
                 kind = substr($0, RSTART + 1, RLENGTH - 2); count[kind]++ }
               END { for (k in count) if (count[k] > 1) print k, count[k] }' "$info") \
      || { echo "$0: awk failed (exit $?) reading $info" >&2; return 2; }
    if [ -n "$dups" ]; then
      n=$((n + 1))
      while IFS= read -r line; do
        echo "  $(basename "$(dirname "$info")"): $line entries" >&2
      done <<< "$dups"
    fi
  done <<< "$infos"
  echo "$n"
}

# The control: the same empty app and the same scripts directory, packaged both ways.
app="$work/root/Control.app/Contents"
mkdir -p "$app/MacOS" "$work/scripts"
cat > "$app/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>invalid.example.scripts-control</string>
<key>CFBundleName</key><string>Control</string>
<key>CFBundleExecutable</key><string>Control</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>0.0.1</string>
<key>CFBundleVersion</key><string>0.0.1</string>
</dict></plist>
PLIST
printf '#!/bin/sh\n' > "$app/MacOS/Control"
printf '#!/bin/sh\nexit 0\n' > "$work/scripts/preinstall"
chmod +x "$app/MacOS/Control" "$work/scripts/preinstall"
pkgbuild --analyze --root "$work/root" "$work/component.plist" > /dev/null
cp "$work/component.plist" "$work/component_once.plist"
cp "$work/component.plist" "$work/component_twice.plist"
plutil -insert 0.BundlePreInstallScriptPath -string preinstall "$work/component_twice.plist"
for mode in once twice; do
  pkgbuild --root "$work/root" --identifier invalid.example.scripts-control --scripts "$work/scripts" \
    --component-plist "$work/component_$mode.plist" --install-location /Applications \
    "$work/control_$mode.pkg" > /dev/null
done
# The control's "listed twice" detail is expected and kept quiet; if the inspection itself fails,
# its error is shown before the exit 2.
seen_twice=$(listing_twice "$work/control_twice.pkg" 2> "$work/control.err") || { cat "$work/control.err" >&2; exit 2; }
seen_once=$(listing_twice "$work/control_once.pkg" 2> "$work/control.err") || { cat "$work/control.err" >&2; exit 2; }
if [ "$seen_twice" != 1 ] || [ "$seen_once" != 0 ]; then
  echo "$0: CONTROL FAILED. A package listing preinstall twice read as $seen_twice and one listing it" \
    "once as $seen_once (expected 1 and 0), so nothing can be concluded about the real package." >&2
  exit 2
fi

status=0
for pkg in "$@"; do
  [ -f "$pkg" ] || { echo "$0: no such file: $pkg" >&2; exit 2; }
  n=$(listing_twice "$pkg")
  if [ "$n" = 0 ]; then
    echo "$(basename "$pkg"): every install script is listed once (control holds)"
  else
    echo "$(basename "$pkg"): a script is LISTED MORE THAN ONCE in $n component package(s), so the" \
      "installer runs it more than once in a single install (#353)." >&2
    status=1
  fi
done
exit "$status"
