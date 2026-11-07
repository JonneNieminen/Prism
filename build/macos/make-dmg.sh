#!/usr/bin/env bash
# Drag-to-install DMG from a built Prism.app: the app, an Applications shortcut and
# "READ ME FIRST.txt" with the one-time command for unnotarized builds.
#
# Usage: build/macos/make-dmg.sh <Prism.app> <version> <rid: osx-arm64|osx-x64> <output-dir>
set -euo pipefail

src="$1"; version="$2"; rid="$3"; out="$4"
here="$(cd "$(dirname "$0")" && pwd)"
case "$rid" in
  osx-arm64) arch="Apple silicon" ;;
  osx-x64)   arch="Intel" ;;
  *)         arch="$rid" ;;
esac

stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT
ditto "$src" "$stage/Prism.app"

# Unsigned builds: make sure the whole bundle carries a valid ad-hoc signature.
if ! codesign --verify --deep --strict "$stage/Prism.app" 2>/dev/null; then
  echo "Bundle signature doesn't verify; applying an ad-hoc signature."
  codesign --force --deep --sign - "$stage/Prism.app"
  codesign --verify --deep --strict "$stage/Prism.app"
fi

ln -s /Applications "$stage/Applications"
sed -e "s/{{VERSION}}/$version/g" -e "s/{{ARCH}}/$arch/g" "$here/READ ME FIRST.txt" > "$stage/READ ME FIRST.txt"

mkdir -p "$out"
dmg="$out/Prism-$version-$rid.dmg"
rm -f "$dmg"
if diskutil image create from --help >/dev/null 2>&1; then
  diskutil image create from --format UDZO --volumeName "Prism $version" "$stage" "$dmg" >/dev/null 2>&1
else # macOS before 26
  hdiutil create -volname "Prism $version" -srcfolder "$stage" -fs HFS+ -format UDZO -ov "$dmg" >/dev/null
fi
echo "Created $dmg"
