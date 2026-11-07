#!/usr/bin/env bash
# Render every app icon from the SVG masters in design/logo (needs Google Chrome; the macOS 26+
# icon also needs Xcode's actool).
#   python3 design/logo/make.py && scripts/render-icons.sh
#
#  src-tauri/icons/*            legacy icons (icns/ico/png) for macOS ≤15, Windows, Linux
#  design/logo/Prism.icon       Icon Composer bundle (solid fill + mark layer)
#  src-tauri/icons/Assets.car   compiled Prism.icon; with CFBundleIconName it stops macOS 26+
#                               drawing the icon on a grey plate
set -euo pipefail
cd "$(dirname "$0")/.."
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

render() { # <svg> <out.png>
  cat > "$TMP/page.html" <<HTML
<!doctype html><html><body style="margin:0;background:transparent">
<img src="file://$PWD/$1" width="1024" height="1024" style="display:block">
</body></html>
HTML
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --user-data-dir="$TMP/profile" \
    --default-background-color=00000000 --window-size=1024,1024 \
    --screenshot="$PWD/$2" "file://$TMP/page.html" >/dev/null 2>&1
}

render design/logo/prism-app-icon.svg src-tauri/icons/source.png
render design/logo/mark.svg design/logo/Prism.icon/Assets/mark.png

npx tauri icon src-tauri/icons/source.png -o src-tauri/icons >/dev/null
rm -rf src-tauri/icons/{android,ios,Square*.png,StoreLogo.png,64x64.png}

xcrun actool design/logo/Prism.icon --compile "$TMP" \
  --app-icon Prism --include-all-app-icons \
  --platform macosx --target-device mac --minimum-deployment-target 13.0 \
  --output-partial-info-plist "$TMP/partial.plist" \
  --notices --warnings --errors --output-format human-readable-text >/dev/null
cp "$TMP/Assets.car" src-tauri/icons/Assets.car
echo "icons rendered → src-tauri/icons (+ Assets.car for macOS 26+)"
