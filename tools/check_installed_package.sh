#!/bin/bash
# Install regression test for a macOS package of Midst (issue 66). Run it on every candidate
# before release; docs/releasing.md says where it sits.
#
#     tools/check_installed_package.sh [--previous <previous release's pkg>] <Midst-x.y.z-arm64.pkg> [expected version]
#
# The package is the artifact of a GitHub `package` run. The expected version defaults to the one
# in release/app/package.json of this checkout. It first prints what it is testing: the package's
# SHA-256, this script's commit, the macOS version and the time; the PASSED/FAILED line repeats the SHA-256. No administrator rights are needed: it installs
# for all users, into /Applications, the only place the package installs (issue 16), so it needs
# passwordless sudo: run it in a throwaway VM or account. What it cannot do (a click through the
# installer's windows) is a manual step in docs/releasing.md.
#
# What it checks, one line per step:
#   1  the package: signed, accepted by Gatekeeper, NOT relocatable, NOT version-checked, each install
#      script listed once, the app's expected-version equal to the version it installs, and holding the
#      expected version and bundle identifier. If any of these fails, nothing is installed.
#   2  control: on this Mac, today, a relocatable package really does update a copy elsewhere and
#      a fixed one really does not. Done with an empty app under an invalid.example identifier.
#      Without it, step 3's "the old copy was left alone" could pass only because the installer
#      never saw the old copy.
#   3a install on a Mac with no Midst: it is in /Applications at the expected version and opens a
#      poem; it is then removed, so step 3 starts as before.
#   3p only with --previous: the previous release is installed, then this package over it, unticked
#      (the previous one is kept as "Midst <its version>"), then again, ticked (it is deleted). The app
#      opens a poem after each. Everything is then removed, so step 3 starts as before.
#   3  install for all users, with an older Midst placed elsewhere first and a stand-in "Midst
#      Beta" in /Applications: the new one is in /Applications at the expected version, the copy
#      elsewhere was not updated in its place, and the stand-in was kept as "Midst Beta 0.0.3".
#      Then a second install with "Delete the Midst that’s already installed" ticked, and a new stand-in
#      (0.0.4): the new stand-in and the Midst the first install wrote are deleted, and the 0.0.3
#      kept by the first install is not. Then three more installs over our own Midst, at 0.1.0, at
#      99.0.0 and at the expected version itself: each is kept, named with its version (3b-3d).
#   4  the installed app launches, opens a synthetic poem, and quits when asked.
#   5  everything this test put on the Mac is removed again.
#
# It REFUSES TO START if a Midst (any of the names above) is already in /Applications or
# ~/Applications, or one is running,
# so it can never touch a real install. It launches the app with its own --user-data-dir, so the
# account's own Midst settings and poems are not read or written, and it removes only what was
# not there before it started. One thing it does add to: if ~/Library/Logs/Midst already exists
# (Midst has been used on this account before), the app appends its start-up lines to the log there.
#
# Exit 0: every step passed. 1: a step failed. 2: the test could not run (nothing is concluded).
set -uo pipefail

APP_NAME=Midst.app
BUNDLE_ID=press.Midst.MidstApp
CONTROL_ID=invalid.example.midst-install-control
LSREGISTER=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister

here=$(cd "$(dirname "$0")" && pwd)
cannot() { echo "CANNOT RUN: $*" >&2; exit 2; }
usage="usage: $0 [--previous <previous release's pkg>] <Midst.pkg> [expected version]"
previous=
if [ "${1:-}" = --previous ]; then
  [ $# -ge 2 ] || cannot "$usage"
  previous=$2
  shift 2
fi
[ $# -ge 1 ] && [ $# -le 2 ] || cannot "$usage"
pkg=$1
[ "$(uname -s)" = Darwin ] || cannot "this test runs on macOS"
for tool in pkgutil pkgbuild productbuild installer spctl plutil open pgrep python3; do
  command -v "$tool" > /dev/null || cannot "$tool not found"
done
[ -x "$LSREGISTER" ] || cannot "lsregister not found at $LSREGISTER"
[ -f "$pkg" ] || cannot "no such file: $pkg"
[ -z "$previous" ] || [ -f "$previous" ] || cannot "no such file: $previous"
[ -n "${HOME:-}" ] && [ -d "$HOME" ] || cannot "HOME is not a directory"
want=${2:-$(plutil -extract version raw -o - "$here/../release/app/package.json" 2> /dev/null)}
[[ "$want" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || cannot "expected version \"$want\" is not MAJOR.MINOR.PATCH"

# What this run tested, so that its output is a record of it (#414).
pkg_sha=$(shasum -a 256 "$pkg" | cut -d' ' -f1)
[[ "$pkg_sha" =~ ^[0-9a-f]{64}$ ]] || cannot "could not compute the SHA-256 of $pkg"
script_commit=$(git -C "$here" rev-parse HEAD 2> /dev/null) || script_commit="unknown (not a git checkout)"
if [ "${script_commit#unknown}" = "$script_commit" ] && ! git -C "$here" diff --quiet HEAD -- . 2> /dev/null; then
  script_commit="$script_commit, with local changes in tools/"
fi
echo "package   $(basename "$pkg") sha256 $pkg_sha"
echo "script    commit $script_commit"
echo "macOS     $(sw_vers -productVersion 2> /dev/null || echo unknown) ($(sw_vers -buildVersion 2> /dev/null || echo unknown))"
echo "date      $(date -u '+%Y-%m-%d %H:%M:%S UTC')"

user_apps="$HOME/Applications"
installed="/Applications/$APP_NAME"
beta="/Applications/Midst Beta.app"
# Each app the installer keeps is named with its version (#16): these are the ones this test makes.
kept_beta3="/Applications/Midst Beta 0.0.3.app"
kept_beta4="/Applications/Midst Beta 0.0.4.app"
kept_low="/Applications/Midst 0.1.0.app"
kept_high="/Applications/Midst 99.0.0.app"
kept_want="/Applications/Midst $want.app"
kept_prev= # "Midst <previous version>.app", set in step 1 when --previous is given
prev_version=
previous_result= # PASSED or FAILED once step 3p has run
REMOVE_ID=$BUNDLE_ID.remove-previous
sudo -n true 2> /dev/null || cannot "it installs for all users, so it needs passwordless sudo (an admin account in a throwaway VM)"
# Any Midst at all, kept or not, under any name this test could make or meet.
for existing in "$installed" "$user_apps/$APP_NAME" "$beta" /Applications/Midst\ *.app "$user_apps"/Midst\ *.app; do
  [ ! -e "$existing" ] && [ ! -L "$existing" ] || cannot "a Midst is already installed at $existing; this test will not touch it. Run it on a Mac (or account) without Midst."
done
[ -z "$(pgrep -x Midst)" ] || cannot "a Midst is running; quit it first"

# What exists before the test, so that only what the test adds is removed afterwards.
residue=(
  "$HOME/Library/Preferences/$BUNDLE_ID.plist"
  "$HOME/Library/Saved Application State/$BUNDLE_ID.savedState"
  "$HOME/Library/Logs/Midst"
  "$HOME/Library/Application Support/Midst"
  "$HOME/Library/Caches/$BUNDLE_ID"
  "$HOME/Library/Caches/$BUNDLE_ID.ShipIt"
  "$HOME/Library/HTTPStorages/$BUNDLE_ID"
)
before=()
for path in "${residue[@]}"; do [ -e "$path" ] && before+=("$path"); done
had_user_apps=no; [ -d "$user_apps" ] && had_user_apps=yes
had_receipt=no; pkgutil --pkg-info "$BUNDLE_ID" > /dev/null 2>&1 && had_receipt=yes
had_remove_receipt=no; pkgutil --pkg-info "$REMOVE_ID" > /dev/null 2>&1 && had_remove_receipt=yes

# Both are created, and checked, before the clean-up trap exists: with either one empty the
# clean-up's paths would start at the root of the disk.
work=$(mktemp -d) && [ -d "$work" ] || cannot "could not make a temporary directory"
# Folders in the home directory, not under the temporary directory: the installer has to be able
# to find the copies in them, as it would find a poet's old copy.
elsewhere=$(mktemp -d "$HOME/midst-install-test.XXXXXX") && [ -d "$elsewhere" ] \
  || { rm -rf "$work"; cannot "could not make a folder in $HOME (is the disk full?)"; }
failures=0
installed_by_test=no
app_pid=

pass() { echo "ok    $*"; }
fail() { echo "FAIL  $*"; failures=$((failures + 1)); }
skip() { echo "not run  $*"; }
version_of() {
  [ -f "$1/Contents/Info.plist" ] || { echo absent; return; }
  plutil -extract CFBundleShortVersionString raw -o - "$1/Contents/Info.plist" 2> /dev/null || echo unreadable
}

cleanup() {
  local left=0 path
  if [ -n "$app_pid" ] && kill -0 "$app_pid" 2> /dev/null; then kill -KILL "$app_pid" 2> /dev/null; fi
  if [ "$installed_by_test" = yes ]; then
    for path in "$installed" "$beta" "$kept_beta3" "$kept_beta4" "$kept_low" "$kept_high" "$kept_want" ${kept_prev:+"$kept_prev"}; do "$LSREGISTER" -u "$path" > /dev/null 2>&1; done
    sudo -n rm -rf "$installed" "$beta" "$kept_beta3" "$kept_beta4" "$kept_low" "$kept_high" "$kept_want" ${kept_prev:+"$kept_prev"}
    [ "$had_receipt" = yes ] || sudo -n pkgutil --forget "$BUNDLE_ID" > /dev/null 2>&1
    [ "$had_remove_receipt" = yes ] || sudo -n pkgutil --forget "$REMOVE_ID" > /dev/null 2>&1
  fi
  "$LSREGISTER" -u "$user_apps/MidstInstallControl.app" > /dev/null 2>&1
  rm -rf "$HOME/Applications/MidstInstallControl.app"
  pkgutil --volume "$HOME" --forget "$CONTROL_ID" > /dev/null 2>&1
  case "$elsewhere" in
    "$HOME"/midst-install-test.*)
      for path in "$elsewhere"/*/*.app; do [ -e "$path" ] && "$LSREGISTER" -u "$path" > /dev/null 2>&1; done
      rm -rf "$elsewhere"
      ;;
  esac
  [ -n "$work" ] && rm -rf "$work"
  for path in "${residue[@]}"; do
    case " ${before[*]-} " in *" $path "*) continue ;; esac
    case "$path" in "$HOME"/Library/*) rm -rf "$path" ;; esac
  done
  [ "$had_user_apps" = yes ] || rmdir "$user_apps" 2> /dev/null
  for path in "$installed" "$beta" "$kept_beta3" "$kept_beta4" "$kept_low" "$kept_high" "$kept_want" ${kept_prev:+"$kept_prev"} "$user_apps/MidstInstallControl.app" "$elsewhere"; do
    [ -e "$path" ] && { echo "FAIL  5 clean-up: $path is still there"; left=1; }
  done
  [ "$left" = 0 ] && echo "ok    5 clean-up: everything the test installed is removed"
  return "$left"
}
finish() {
  cleanup || failures=$((failures + 1))
  trap - EXIT
  # Fixed formats: the release check reads these two lines (#414).
  case "$previous_result" in
    PASSED | FAILED) echo "check_installed_package: previous release $prev_version: $previous_result" ;;
    *) echo "check_installed_package: previous release: not run" ;;
  esac
  if [ "$failures" = 0 ]; then echo "check_installed_package: PASSED $(basename "$pkg") sha256 $pkg_sha"; exit 0; fi
  echo "$failures step(s) failed"
  echo "check_installed_package: FAILED $(basename "$pkg") sha256 $pkg_sha"
  exit 1
}
trap 'cleanup > /dev/null 2>&1' EXIT
give_up() { echo "CANNOT RUN: $*" >&2; cleanup > /dev/null 2>&1; trap - EXIT; exit 2; }

# --- 1. the package itself -------------------------------------------------------------------
if pkgutil --check-signature "$pkg" > "$work/signature.txt" 2>&1 && grep -q 'Developer ID Installer' "$work/signature.txt"; then
  pass "1 signed: $(grep -m1 'Developer ID Installer' "$work/signature.txt" | sed 's/^ *[0-9]*\. //')"
else
  fail "1 signed: pkgutil --check-signature does not show a Developer ID Installer signature"
fi
if spctl --assess --type install "$pkg" > "$work/gatekeeper.txt" 2>&1; then
  pass "1 Gatekeeper accepts the package"
else
  fail "1 Gatekeeper rejects the package: $(tr '\n' ' ' < "$work/gatekeeper.txt")"
fi
"$here/check_pkg_not_relocatable.sh" "$pkg" > "$work/relocatable.txt" 2>&1
case $? in
  0) pass "1 not relocatable" ;;
  1) fail "1 the package is RELOCATABLE: it would update a copy of Midst found anywhere and put nothing in Applications" ;;
  *) give_up "the relocation check could not run: $(tr '\n' ' ' < "$work/relocatable.txt")" ;;
esac
"$here/check_pkg_not_version_checked.sh" "$pkg" > "$work/version-checked.txt" 2>&1
case $? in
  0) pass "1 not version-checked" ;;
  1) fail "1 the package is VERSION-CHECKED: over a newer Midst it keeps that one and writes nothing, leaving no Midst in Applications" ;;
  *) give_up "the version-check check could not run: $(tr '\n' ' ' < "$work/version-checked.txt")" ;;
esac
"$here/check_pkg_scripts_listed_once.sh" "$pkg" > "$work/scripts-once.txt" 2>&1
case $? in
  0) pass "1 each install script is listed once" ;;
  1) fail "1 an install script is LISTED MORE THAN ONCE, so the installer runs it more than once: $(tr '\n' ' ' < "$work/scripts-once.txt")" ;;
  *) give_up "the script-listing check could not run: $(tr '\n' ' ' < "$work/scripts-once.txt")" ;;
esac
"$here/check_pkg_expected_version.sh" "$pkg" > "$work/expected-version.txt" 2>&1
case $? in
  0) pass "1 the app's expected-version is the version it installs" ;;
  1) fail "1 the app's expected-version is WRONG, so its postinstall would roll back a good install or pass a wrong one: $(tr '\n' ' ' < "$work/expected-version.txt")" ;;
  *) give_up "the expected-version check could not run: $(tr '\n' ' ' < "$work/expected-version.txt")" ;;
esac
pkgutil --expand "$pkg" "$work/expanded" > /dev/null 2>&1 || give_up "could not expand $pkg"
bundle_line=$(grep -h '<bundle path=' "$work"/expanded/*/PackageInfo 2> /dev/null)
inside_version=$(printf '%s' "$bundle_line" | sed -n 's/.*CFBundleShortVersionString="\([^"]*\)".*/\1/p')
inside_id=$(printf '%s' "$bundle_line" | sed -n 's/.* id="\([^"]*\)".*/\1/p')
if [ "$inside_version" = "$want" ]; then pass "1 holds version $want"; else fail "1 holds version \"$inside_version\", expected $want"; fi
if [ "$inside_id" = "$BUNDLE_ID" ]; then pass "1 bundle identifier $BUNDLE_ID"; else fail "1 bundle identifier is \"$inside_id\", expected $BUNDLE_ID"; fi
if [ -n "$previous" ]; then
  pkgutil --expand "$previous" "$work/previous-expanded" > /dev/null 2>&1 || give_up "could not expand the previous release $previous"
  prev_version=$(grep -h '<bundle path=' "$work"/previous-expanded/*/PackageInfo 2> /dev/null \
    | sed -n 's/.*CFBundleShortVersionString="\([^"]*\)".*/\1/p')
  [[ "$prev_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || give_up "the previous release's version \"$prev_version\" is not MAJOR.MINOR.PATCH"
  [ "$prev_version" != "$want" ] || give_up "the previous release is version $want, the same as this package"
  kept_prev="/Applications/Midst $prev_version.app"
  echo "previous  $(basename "$previous") sha256 $(shasum -a 256 "$previous" | cut -d' ' -f1), version $prev_version"
fi
if [ "$failures" != 0 ]; then
  skip "2 to 4: the package failed its own checks, so it was not installed"
  finish
fi

# --- 2. control: relocation is visible on this Mac --------------------------------------------
# stub <dir> <app name> <identifier> <version>: an empty app bundle.
stub() {
  mkdir -p "$1/$2/Contents/MacOS"
  cat > "$1/$2/Contents/Info.plist" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>$3</string>
<key>CFBundleName</key><string>${2%.app}</string>
<key>CFBundleExecutable</key><string>${2%.app}</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>$4</string>
<key>CFBundleVersion</key><string>$4</string>
</dict></plist>
PLIST
  printf '#!/bin/sh\n' > "$1/$2/Contents/MacOS/${2%.app}"
  chmod +x "$1/$2/Contents/MacOS/${2%.app}"
}
control_app=MidstInstallControl.app
stub "$work/control-root" "$control_app" "$CONTROL_ID" 0.0.2
pkgbuild --analyze --root "$work/control-root" "$work/control.plist" > /dev/null 2>&1 || give_up "pkgbuild --analyze failed"
# control_install <true|false>: install the control app from a package that is, or is not,
# relocatable, with a 0.0.1 copy elsewhere. Prints "<version elsewhere> <version in ~/Applications>".
control_install() {
  local mode=$1 dir="$elsewhere/control-$1"
  stub "$dir" "$control_app" "$CONTROL_ID" 0.0.1
  "$LSREGISTER" -f "$dir/$control_app" > /dev/null 2>&1
  cp "$work/control.plist" "$work/control-$mode.plist"
  plutil -replace 0.BundleIsRelocatable -bool "$mode" "$work/control-$mode.plist"
  pkgbuild --root "$work/control-root" --identifier "$CONTROL_ID" --version 0.0.2 \
    --component-plist "$work/control-$mode.plist" --install-location /Applications \
    "$work/control-component-$mode.pkg" > /dev/null 2>&1 || return 1
  productbuild --synthesize --package "$work/control-component-$mode.pkg" "$work/control-$mode.xml" > /dev/null 2>&1 || return 1
  # The same three install domains electron-builder gives the real package.
  python3 - "$work/control-$mode.xml" << 'PY' || return 1
import sys
path = sys.argv[1]
text = open(path).read()
marker = "<options "
assert marker in text and "<domains" not in text
open(path, "w").write(text.replace(marker, '<domains enable_anywhere="true" enable_currentUserHome="true" enable_localSystem="true"/>\n    ' + marker, 1))
PY
  productbuild --distribution "$work/control-$mode.xml" --package-path "$work" "$work/control-$mode.pkg" > /dev/null 2>&1 || return 1
  installer -pkg "$work/control-$mode.pkg" -target CurrentUserHomeDirectory > /dev/null 2>&1 || return 1
  echo "$(version_of "$dir/$control_app") $(version_of "$user_apps/$control_app")"
  "$LSREGISTER" -u "$dir/$control_app" > /dev/null 2>&1
  "$LSREGISTER" -u "$user_apps/$control_app" > /dev/null 2>&1
  rm -rf "$dir" "$HOME/Applications/MidstInstallControl.app"
  pkgutil --volume "$HOME" --forget "$CONTROL_ID" > /dev/null 2>&1
}
relocated=$(control_install true) || give_up "the relocatable control package could not be built or installed"
fixed=$(control_install false) || give_up "the fixed control package could not be built or installed"
if [ "$relocated" = "0.0.2 absent" ] && [ "$fixed" = "0.0.1 0.0.2" ]; then
  pass "2 control: a relocatable package updated the copy elsewhere; a fixed one installed to ~/Applications and left it alone"
else
  give_up "CONTROL FAILED. Relocatable gave \"$relocated\" (expected \"0.0.2 absent\") and fixed gave \"$fixed\" (expected \"0.0.1 0.0.2\"), as <copy elsewhere> <~/Applications>. On this Mac the installer did not behave as the relocation test assumes, so step 3 would prove nothing."
fi

# launch_and_open <step>: launch the installed app on a synthetic poem with its own user data,
# check that it opened the poem, and quit it, reporting under <step>. (Body not indented: it holds
# python heredocs.)
launch_and_open() {
poem="$work/install-test-poem-$1.midst"
userdata="$work/userdata-$1"
python3 - "$poem" << 'PY'
import json, sys
body = "zq xv"
history = [{"inserted": ("<p>%s</p>" % c) if i == 0 else c, "front": i + 4, "end": i + 4,
            "t": "2026-01-01T00:00:%02d.000Z" % i, "pos": i + 2} for i, c in enumerate(body)]
open(sys.argv[1], "w").write("midstVersion: 1\n" + json.dumps({"text": "<p>%s</p>" % body, "history": history}))
PY
open -n -a "$installed" "$poem" --args "--user-data-dir=$userdata" > "$work/open.txt" 2>&1 \
  || fail "$1 open could not start the app: $(tr '\n' ' ' < "$work/open.txt")"
opened=no
app_pid=
for _ in $(seq 1 60); do
  [ -n "$app_pid" ] || app_pid=$(pgrep -f -- "$installed/Contents/MacOS/Midst --user-data-dir=$userdata" | head -1)
  if [ -f "$userdata/config.json" ] && python3 - "$userdata/config.json" "$poem" << 'PY'
import json, os, sys
try:
    name = json.load(open(sys.argv[1])).get("filename")
except ValueError:
    sys.exit(1)
sys.exit(0 if name and os.path.realpath(name) == os.path.realpath(sys.argv[2]) else 1)
PY
  then opened=yes; break; fi
  sleep 1
done
if [ -n "$app_pid" ]; then pass "$1 the app launched (process $app_pid)"; else fail "$1 the app did not launch: no Midst process appeared"; fi
if [ "$opened" = yes ]; then pass "$1 it opened the synthetic poem"; else fail "$1 it did not open the synthetic poem within 60 seconds"; fi
if [ -n "$app_pid" ]; then
  kill -TERM "$app_pid" 2> /dev/null
  gone=no
  for _ in $(seq 1 20); do kill -0 "$app_pid" 2> /dev/null || { gone=yes; break; }; sleep 1; done
  if [ "$gone" = yes ]; then pass "$1 it quit when asked"; else
    fail "$1 it was still running 20 seconds after being asked to quit"
    kill -KILL "$app_pid" 2> /dev/null
  fi
  app_pid=
fi
}

# --- 3. install for all users, with an older Midst elsewhere and a stand-in in /Applications --
decoy="$elsewhere/older"
stub "$decoy" "$APP_NAME" "$BUNDLE_ID" 0.0.1
"$LSREGISTER" -f "$decoy/$APP_NAME" > /dev/null 2>&1
# stand_in: an empty "Midst Beta" in /Applications, as Stuart found on a Mac (GitHub #47).
stand_in() {
  stub "$work/beta-$1" "Midst Beta.app" invalid.example.midst-beta "$1" \
    && sudo -n ditto "$work/beta-$1/Midst Beta.app" "$beta"
}
# The opt-in delete, through the real package: tick the choice, as a poet would in Customize.
cat > "$work/delete-choice.plist" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><array><dict>
<key>attributeSetting</key><integer>1</integer>
<key>choiceAttribute</key><string>selected</string>
<key>choiceIdentifier</key><string>$REMOVE_ID</string>
</dict></array></plist>
PLIST
installed_by_test=yes
# 3a, the plain path: a Mac with no Midst at all (Cyril, 4 Nov: the main road first). The app must be
# in Applications at the expected version and open a poem. Then it is removed again, so step 3 starts
# from no Midst in Applications, as it always has.
# A clean install only if there really is no Midst: anything named Midst*.app makes it an upgrade.
for existing in /Applications/Midst*.app; do
  if [ -e "$existing" ] || [ -L "$existing" ]; then give_up "3a needs a Mac with no Midst, but $existing is in /Applications"; fi
done
# The log is ours to write, not root's.
# shellcheck disable=SC2024
if sudo -n installer -pkg "$pkg" -target / > "$work/install-clean.txt" 2>&1; then
  pass "3a installer on a Mac with no Midst reported success"
else
  fail "3a installer on a Mac with no Midst failed: $(tr '\n' ' ' < "$work/install-clean.txt")"
fi
if [ "$(version_of "$installed")" = "$want" ]; then
  pass "3a Midst $want is in /Applications"
  launch_and_open 3a
else
  fail "3a /Applications holds Midst \"$(version_of "$installed")\" after a clean install, expected $want"
fi
"$LSREGISTER" -u "$installed" > /dev/null 2>&1
sudo -n rm -rf "$installed" || give_up "could not remove the clean install before step 3"

# 3p, over the real previous release (#414): install it, then this package, unticked and then ticked.
# install_over_previous <label> [choices plist]: install the previous release, then this package over it.
install_over_previous() {
  # The logs are ours to write, not root's.
  # shellcheck disable=SC2024
  sudo -n installer -pkg "$previous" -target / > "$work/previous-$1.txt" 2>&1 \
    || give_up "3p could not install the previous release: $(tr '\n' ' ' < "$work/previous-$1.txt")"
  [ "$(version_of "$installed")" = "$prev_version" ] \
    || give_up "3p the previous release left Midst \"$(version_of "$installed")\" in /Applications, expected $prev_version"
  # shellcheck disable=SC2024
  if sudo -n installer -pkg "$pkg" -target / ${2:+-applyChoiceChangesXML "$2"} > "$work/over-previous-$1.txt" 2>&1; then
    pass "3p $1: installer over the previous release $prev_version reported success"
  else
    fail "3p $1: installer over the previous release $prev_version failed: $(tr '\n' ' ' < "$work/over-previous-$1.txt")"
  fi
}
# remove_both: take this package's Midst and the kept previous one out of /Applications again.
remove_both() {
  "$LSREGISTER" -u "$installed" > /dev/null 2>&1
  "$LSREGISTER" -u "$kept_prev" > /dev/null 2>&1
  sudo -n rm -rf "$installed" "$kept_prev" || give_up "3p could not remove the apps it installed"
}
if [ -z "$previous" ]; then
  skip "3p over the previous release: no --previous package was given"
else
  failures_before_3p=$failures
  install_over_previous unticked
  if [ "$(version_of "$installed")" = "$want" ] && [ "$(version_of "$kept_prev")" = "$prev_version" ]; then
    pass "3p unticked: Midst $want is in /Applications and $prev_version was kept as \"Midst $prev_version\""
    launch_and_open 3p-unticked
  else
    fail "3p unticked: Midst $(version_of "$installed"), Midst $prev_version kept $(version_of "$kept_prev") (expected $want and $prev_version)"
  fi
  remove_both
  install_over_previous ticked "$work/delete-choice.plist"
  if [ "$(version_of "$installed")" = "$want" ] && [ ! -e "$kept_prev" ]; then
    pass "3p ticked: Midst $want is in /Applications and the previous release $prev_version is deleted"
    launch_and_open 3p-ticked
  else
    fail "3p ticked: Midst $(version_of "$installed"), Midst $prev_version kept $(version_of "$kept_prev") (expected $want and absent)"
  fi
  remove_both
  if [ "$failures" = "$failures_before_3p" ]; then previous_result=PASSED; else previous_result=FAILED; fi
fi

stand_in 0.0.3 || give_up "could not put a stand-in Midst Beta in /Applications"
# The log is ours to write, not root's.
# shellcheck disable=SC2024
if sudo -n installer -pkg "$pkg" -target / > "$work/install.txt" 2>&1; then
  pass "3 installer reported success"
else
  fail "3 installer failed: $(tr '\n' ' ' < "$work/install.txt")"
fi
got=$(version_of "$installed")
if [ "$got" = "$want" ]; then pass "3 Midst $want is in /Applications"; else fail "3 /Applications holds Midst \"$got\", expected $want"; fi
if [ ! -e "$beta" ] && [ "$(version_of "$kept_beta3")" = 0.0.3 ]; then
  pass "3 the stand-in Midst Beta was kept as \"Midst Beta 0.0.3\""
else
  fail "3 the stand-in Midst Beta was not kept as \"Midst Beta 0.0.3\" (Midst Beta: $(version_of "$beta"); Midst Beta 0.0.3: $(version_of "$kept_beta3"))"
fi
got_id=absent
[ -f "$installed/Contents/Info.plist" ] && got_id=$(plutil -extract CFBundleIdentifier raw -o - "$installed/Contents/Info.plist" 2> /dev/null || echo unreadable)
if [ "$got_id" = "$BUNDLE_ID" ]; then pass "3 installed bundle identifier $BUNDLE_ID"; else fail "3 installed bundle identifier is \"$got_id\""; fi
old=$(version_of "$decoy/$APP_NAME")
if [ "$old" = 0.0.1 ]; then pass "3 the older copy elsewhere was left alone"; else fail "3 the older copy elsewhere is now \"$old\": the installer updated it in place"; fi
"$LSREGISTER" -u "$decoy/$APP_NAME" > /dev/null 2>&1
rm -rf "$decoy"

stand_in 0.0.4 || give_up "could not put a second stand-in Midst Beta in /Applications"
# The log is ours to write, not root's.
# shellcheck disable=SC2024
if sudo -n installer -pkg "$pkg" -target / -applyChoiceChangesXML "$work/delete-choice.plist" > "$work/install-delete.txt" 2>&1; then
  pass "3 installer with the delete choice ticked reported success"
else
  fail "3 installer with the delete choice ticked failed: $(tr '\n' ' ' < "$work/install-delete.txt")"
fi
if [ ! -e "$beta" ] && [ ! -e "$kept_beta4" ] && [ ! -e "$kept_want" ] && [ "$(version_of "$kept_beta3")" = 0.0.3 ] \
  && [ "$(version_of "$installed")" = "$want" ]; then
  pass "3 the ticked delete removed only what this install kept (Midst Beta 0.0.4, Midst $want)"
else
  fail "3 after the ticked delete: Midst Beta $(version_of "$beta"), Midst Beta 0.0.4 $(version_of "$kept_beta4"), Midst $want kept $(version_of "$kept_want"), Midst Beta 0.0.3 $(version_of "$kept_beta3"), Midst $(version_of "$installed") (expected absent, absent, absent, 0.0.3, $want)"
fi

# --- 3b-3d. ours is kept at any version, the same version included, named with it (#16) -------
# GitHub #47 and Stuart (4 Nov): a new install never writes over any Midst. In /Applications now: Midst
# $want (installed above) and "Midst Beta 0.0.3" (the first stand-in). Each step puts a
# stand-in of OUR OWN Midst (our identifier) where the real one is, then installs again.
# ours_at <version>: replace /Applications/Midst.app with an empty Midst of ours at <version>.
ours_at() {
  stub "$work/ours-$1" "$APP_NAME" "$BUNDLE_ID" "$1" \
    && sudo -n rm -rf "$installed" \
    && sudo -n ditto "$work/ours-$1/$APP_NAME" "$installed"
}
# install_again <log name>: the plain install, as a poet runs it.
install_again() {
  # The log is ours to write, not root's.
  # shellcheck disable=SC2024
  sudo -n installer -pkg "$pkg" -target / > "$work/$1.txt" 2>&1
}
ours_at 0.1.0 || give_up "could not put a lower-version Midst of ours in /Applications"
if install_again install-lower; then pass "3b installer over our own Midst 0.1.0 reported success"; else fail "3b installer over our own Midst 0.1.0 failed: $(tr '\n' ' ' < "$work/install-lower.txt")"; fi
if [ "$(version_of "$kept_low")" = 0.1.0 ] && [ "$(version_of "$installed")" = "$want" ]; then
  pass "3b our own Midst at a lower version (0.1.0) was kept as \"Midst 0.1.0\""
else
  fail "3b our own Midst 0.1.0 was not kept (Midst 0.1.0: $(version_of "$kept_low"); Midst: $(version_of "$installed"); expected 0.1.0 and $want)"
fi
ours_at 99.0.0 || give_up "could not put a higher-version Midst of ours in /Applications"
if install_again install-higher; then pass "3c installer over our own Midst 99.0.0 reported success"; else fail "3c installer over our own Midst 99.0.0 failed: $(tr '\n' ' ' < "$work/install-higher.txt")"; fi
if [ "$(version_of "$kept_high")" = 99.0.0 ] && [ "$(version_of "$installed")" = "$want" ]; then
  pass "3c our own Midst at a higher version (99.0.0) was kept as \"Midst 99.0.0\""
else
  fail "3c our own Midst 99.0.0 was not kept (Midst 99.0.0: $(version_of "$kept_high"); Midst: $(version_of "$installed"); expected 99.0.0 and $want)"
fi
if install_again install-same; then pass "3d installer over Midst $want (the same version) reported success"; else fail "3d installer over Midst $want failed: $(tr '\n' ' ' < "$work/install-same.txt")"; fi
if [ "$(version_of "$installed")" = "$want" ] && [ "$(version_of "$kept_want")" = "$want" ] \
  && [ "$(version_of "$kept_beta3")" = 0.0.3 ] && [ "$(version_of "$kept_low")" = 0.1.0 ] && [ "$(version_of "$kept_high")" = 99.0.0 ]; then
  pass "3d a same-version reinstall kept Midst $want as \"Midst $want\""
else
  fail "3d after a same-version reinstall: Midst $(version_of "$installed"), Midst $want kept $(version_of "$kept_want") (expected $want and $want; earlier kept copies 0.0.3, 0.1.0, 99.0.0: $(version_of "$kept_beta3"), $(version_of "$kept_low"), $(version_of "$kept_high"))"
fi
# --- 4. launch, open a synthetic poem, quit ---------------------------------------------------
if [ "$got" != "$want" ]; then
  skip "4 launch: the app is not installed where expected"
  finish
fi
launch_and_open 4
finish
