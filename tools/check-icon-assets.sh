#!/bin/bash
# Verify the icon assets: source hash, output hash, and packaging configuration (midst-editor #63).
# Uses source-relative paths (portable across checkout locations). Includes icon.json in the source hash.
# Does not invoke actool or require Xcode.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
ICON_DIR="$REPO_ROOT/assets/Icon.icon"
ASSETS_CAR="$REPO_ROOT/assets/Assets.car"
MANIFEST="$REPO_ROOT/assets/icon-manifest.json"
PACKAGE_JSON="$REPO_ROOT/package.json"

ERRORS=0

# 1. Source hash: sorted relative paths + bytes of the entire .icon bundle
if [ -d "$ICON_DIR" ]; then
  SOURCE_HASH=$(cd "$ICON_DIR" && find . -type f | sort | while read -r f; do printf '%s\0' "$f"; cat "$f"; done | shasum -a 256 | cut -d' ' -f1)
  if [ -f "$MANIFEST" ]; then
    MANIFEST_SOURCE=$(python3 -c "import json; print(json.load(open('$MANIFEST'))['source_hash'])")
    if [ "$SOURCE_HASH" != "$MANIFEST_SOURCE" ]; then
      echo "FAIL: source hash changed ($SOURCE_HASH != manifest $MANIFEST_SOURCE). Run tools/compile-icon.sh to regenerate."
      ERRORS=$((ERRORS + 1))
    else
      echo "PASS: source hash matches manifest"
    fi
  else
    echo "FAIL: $MANIFEST not found (run tools/compile-icon.sh)"
    ERRORS=$((ERRORS + 1))
  fi
else
  echo "FAIL: $ICON_DIR not found"
  ERRORS=$((ERRORS + 1))
fi

# 2. Output hash: Assets.car
if [ ! -f "$ASSETS_CAR" ]; then
  echo "FAIL: $ASSETS_CAR not found"
  ERRORS=$((ERRORS + 1))
elif [ ! -s "$ASSETS_CAR" ]; then
  echo "FAIL: $ASSETS_CAR is empty"
  ERRORS=$((ERRORS + 1))
else
  OUTPUT_HASH=$(shasum -a 256 "$ASSETS_CAR" | cut -d' ' -f1)
  # Read expected from manifest if present, else use known-good
  if [ -f "$MANIFEST" ]; then
    EXPECTED_OUTPUT_HASH=$(python3 -c "import json; print(json.load(open('$MANIFEST'))['output_hash'])")
  else
    EXPECTED_OUTPUT_HASH="9d523003cff311e1e78db3e34c654db4061eb33be8c09e064425cb98591dd296"
  fi
  if [ "$OUTPUT_HASH" != "$EXPECTED_OUTPUT_HASH" ]; then
    echo "FAIL: Assets.car hash changed ($OUTPUT_HASH != $EXPECTED_OUTPUT_HASH). Run tools/compile-icon.sh to regenerate."
    ERRORS=$((ERRORS + 1))
  else
    echo "PASS: Assets.car hash matches"
  fi
fi

# 3. Manifest exists and is consistent
if [ -f "$MANIFEST" ]; then
  MANIFEST_SOURCE=$(python3 -c "import json; print(json.load(open('$MANIFEST'))['source_hash'])")
  if [ "$MANIFEST_SOURCE" != "$SOURCE_HASH" ]; then
    echo "FAIL: manifest source_hash ($MANIFEST_SOURCE) != computed source hash ($SOURCE_HASH)"
    ERRORS=$((ERRORS + 1))
  else
    echo "PASS: manifest source hash consistent"
  fi
else
  echo "FAIL: $MANIFEST not found (run tools/compile-icon.sh)"
  ERRORS=$((ERRORS + 1))
fi

# 4. Packaging configuration
if [ -f "$PACKAGE_JSON" ]; then
  # mac.icon = assets/icon.icns
  ICON=$(python3 -c "import json; print(json.load(open('$PACKAGE_JSON'))['build']['mac'].get('icon', ''))")
  if [ "$ICON" != "assets/icon.icns" ]; then
    echo "FAIL: build.mac.icon is '$ICON', expected 'assets/icon.icns'"
    ERRORS=$((ERRORS + 1))
  else
    echo "PASS: build.mac.icon = assets/icon.icns"
  fi

  # CFBundleIconName = Icon
  ICON_NAME=$(python3 -c "import json; print(json.load(open('$PACKAGE_JSON'))['build']['mac'].get('extendInfo', {}).get('CFBundleIconName', ''))")
  if [ "$ICON_NAME" != "Icon" ]; then
    echo "FAIL: build.mac.extendInfo.CFBundleIconName is '$ICON_NAME', expected 'Icon'"
    ERRORS=$((ERRORS + 1))
  else
    echo "PASS: build.mac.extendInfo.CFBundleIconName = Icon"
  fi

  # extraResources: check both from and to for Assets.car mapping
  MAPPING_OK=$(python3 -c "
import json
extra = json.load(open('$PACKAGE_JSON'))['build'].get('extraResources', [])
for e in extra:
    if isinstance(e, dict) and e.get('from', '') == 'assets/Assets.car' and e.get('to', '') == 'Assets.car':
        print('yes')
        break
else:
    print('no')
")
  if [ "$MAPPING_OK" != "yes" ]; then
    echo "FAIL: extraResources must have from=assets/Assets.car to=Assets.car (exact match)"
    ERRORS=$((ERRORS + 1))
  else
    echo "PASS: extraResources Assets.car mapping correct"
  fi
else
  echo "FAIL: $PACKAGE_JSON not found"
  ERRORS=$((ERRORS + 1))
fi

if [ $ERRORS -gt 0 ]; then
  echo "FAILED: $ERRORS check(s) failed"
  exit 1
fi
echo "ALL CHECKS PASSED"
