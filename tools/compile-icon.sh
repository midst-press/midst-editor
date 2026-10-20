#!/bin/bash
# Compile the Icon Composer .icon to Assets.car for macOS 26 (midst-editor #63).
# Run from the repository root. Requires Xcode 26+ (actool).
# Records source/output/tool-version in assets/icon-manifest.json on each run.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
ICON_DIR="$REPO_ROOT/assets/Icon.icon"
OUTPUT_DIR="$REPO_ROOT/assets"
MANIFEST="$REPO_ROOT/assets/icon-manifest.json"

if [ ! -d "$ICON_DIR" ]; then
  echo "error: $ICON_DIR not found" >&2
  exit 1
fi

# Source hash: sorted relative paths + bytes of the entire .icon bundle (including icon.json)
SOURCE_HASH=$(cd "$ICON_DIR" && find . -type f | sort | while read -r f; do printf '%s\0' "$f"; cat "$f"; done | shasum -a 256 | cut -d' ' -f1)
echo "source hash: $SOURCE_HASH"

# Tool version
ACTOOL_VERSION=$(xcrun actool --version 2>/dev/null | python3 -c "import sys,plistlib; d=plistlib.load(sys.stdin.buffer); print(d['com.apple.actool.version']['short-bundle-version'])" 2>/dev/null || echo "unknown")

# Compile
TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

xcrun actool "$ICON_DIR" \
  --compile "$TMPDIR" \
  --app-icon Icon \
  --platform macosx \
  --minimum-deployment-target 26.0 \
  --output-partial-info-plist "$TMPDIR/PartialInfo.plist"

if [ ! -f "$TMPDIR/Assets.car" ] || [ ! -s "$TMPDIR/Assets.car" ]; then
  echo "error: Assets.car was not produced or is empty" >&2
  exit 1
fi

cp "$TMPDIR/Assets.car" "$OUTPUT_DIR/Assets.car"
OUTPUT_HASH=$(shasum -a 256 "$OUTPUT_DIR/Assets.car" | cut -d' ' -f1)
echo "compiled: $OUTPUT_DIR/Assets.car"
echo "output hash: $OUTPUT_HASH"

# Write manifest
cat > "$MANIFEST" << MANIFEST
{
  "source_hash": "$SOURCE_HASH",
  "output_hash": "$OUTPUT_HASH",
  "tool": "actool",
  "tool_version": "$ACTOOL_VERSION",
  "xcode": "$(xcodebuild -version 2>/dev/null | head -1 || echo 'unknown')",
  "compiled_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
MANIFEST
echo "manifest: $MANIFEST"
