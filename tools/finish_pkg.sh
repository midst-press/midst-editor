#!/bin/bash
# Adds the older-Midst handling (issue 16) to a macOS package built by `npm run package`, in place:
# the installer warning, and the opt-in "Delete the older version of Midst" choice with its
# payload-free package (installer/remove-previous). The rename itself is already in the app's own
# package, from installer/pkg-scripts (package.json build.pkg.scripts).
#
#     tools/finish_pkg.sh <Midst-x.y.z-arm64.pkg> [<Developer ID Installer identity> <keychain>]
#
# With an identity it signs the rebuilt package; notarise it AFTER this, never before, because a
# rebuilt package is a new file. Without one the result is unsigned, as electron-builder's was.
#
# It also tells both the warning and the rename which version this package installs (the
# Distribution's product version): a Midst.app at any other version is kept, not written over.
#
# Exit 0: rebuilt, and the result was read back and holds both packages, the check, the choice and
# the version in both places.
# 1: failed; the original package is left as it was. 2: usage.
set -uo pipefail

here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/.." && pwd)
fail() { echo "finish_pkg: FAILED: $*" >&2; exit 1; }

[ $# -eq 1 ] || [ $# -eq 3 ] || { echo "usage: $0 <Midst.pkg> [<installer identity> <keychain>]" >&2; exit 2; }
pkg=$1
[ -f "$pkg" ] || fail "$pkg is not a file"
for tool in pkgutil pkgbuild productbuild node; do
  command -v "$tool" > /dev/null || fail "$tool is not installed"
done

work=$(mktemp -d "${TMPDIR:-/tmp}/finish_pkg.XXXXXX") || fail "could not make a work directory"
trap 'rm -rf "$work"' EXIT

pkgutil --expand "$pkg" "$work/x" || fail "pkgutil --expand $pkg"
[ -d "$work/x/press.Midst.MidstApp.pkg" ] || fail "$pkg holds no press.Midst.MidstApp.pkg component"
[ -f "$work/x/press.Midst.MidstApp.pkg/Scripts/preinstall" ] \
  || fail "the app's component has no preinstall script: is build.pkg.scripts set in package.json?"

version=$(sed -n 's/.*<product id="press.Midst.MidstApp" version="\([^"]*\)".*/\1/p' "$work/x/Distribution")
[ -n "$version" ] || fail "no product version in the Distribution"
[[ "$version" =~ ^[0-9A-Za-z.+-]+$ ]] || fail "unexpected product version \"$version\" in the Distribution"

# The preinstall keeps any Midst.app that is not exactly this version, so it has to know it.
printf '%s\n' "$version" > "$work/x/press.Midst.MidstApp.pkg/Scripts/midst-installing-version" \
  || fail "could not write the version for the preinstall"

mkdir "$work/pkgs" || fail "mkdir"
pkgutil --flatten "$work/x/press.Midst.MidstApp.pkg" "$work/pkgs/press.Midst.MidstApp.pkg" \
  || fail "pkgutil --flatten the app's component"
pkgbuild --nopayload --scripts "$root/installer/remove-previous" \
  --identifier press.Midst.MidstApp.remove-previous --version "$version" \
  "$work/pkgs/press.Midst.MidstApp.remove-previous.pkg" > "$work/pkgbuild.log" 2>&1 \
  || { cat "$work/pkgbuild.log" >&2; fail "pkgbuild the remove-previous package"; }
node "$here/installer_distribution.cjs" "$work/x/Distribution" "$work/Distribution" "$version" \
  || fail "editing the Distribution"

sign=()
[ $# -eq 3 ] && sign=(--sign "$2" --keychain "$3")
resources=()
[ -d "$work/x/Resources" ] && resources=(--resources "$work/x/Resources")
productbuild --distribution "$work/Distribution" --package-path "$work/pkgs" "${resources[@]+"${resources[@]}"}" "${sign[@]+"${sign[@]}"}" \
  "$work/out.pkg" > "$work/productbuild.log" 2>&1 \
  || { cat "$work/productbuild.log" >&2; fail "productbuild"; }

# Read the result back rather than trusting the steps above.
pkgutil --expand "$work/out.pkg" "$work/check" || fail "the rebuilt package does not expand"
for want in 'installation-check script="midstPreviousCheck()"' 'customize="allow"' \
  'choice id="press.Midst.MidstApp.remove-previous"' 'start_selected="false"' \
  "const MIDST_INSTALLING_VERSION = '$version';"; do
  grep -qF "$want" "$work/check/Distribution" || fail "the rebuilt Distribution lacks: $want"
done
[ -f "$work/check/press.Midst.MidstApp.pkg/Scripts/preinstall" ] || fail "the rebuilt package lost the rename script"
read_back=$(tr -d '[:space:]' < "$work/check/press.Midst.MidstApp.pkg/Scripts/midst-installing-version" 2> /dev/null)
[ "$read_back" = "$version" ] \
  || fail "the rebuilt package's preinstall would read version \"$read_back\", not $version"
[ -f "$work/check/press.Midst.MidstApp.remove-previous.pkg/Scripts/postinstall" ] \
  || fail "the rebuilt package lacks the remove-previous script"
if [ $# -eq 3 ]; then
  pkgutil --check-signature "$work/out.pkg" > "$work/sig.log" 2>&1 || { cat "$work/sig.log" >&2; fail "the rebuilt package is not signed"; }
fi

mv -f "$work/out.pkg" "$pkg" || fail "could not replace $pkg"
echo "finish_pkg: $pkg now warns about an older Midst and offers to delete it (opt-in)"
