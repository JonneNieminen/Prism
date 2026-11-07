#!/usr/bin/env bash
# Render the app icon set from design/logo/prism-app-icon.svg (needs Google Chrome).
#   python3 design/logo/make.py && scripts/render-icons.sh
set -euo pipefail
cd "$(dirname "$0")/.."
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cat > "$TMP/icon.html" <<HTML
<!doctype html><html><body style="margin:0;background:transparent">
<img src="file://$PWD/design/logo/prism-app-icon.svg" width="1024" height="1024" style="display:block">
</body></html>
HTML
"$CHROME" --headless=new --disable-gpu --hide-scrollbars --user-data-dir="$TMP/profile" \
  --default-background-color=00000000 --window-size=1024,1024 \
  --screenshot="$PWD/src-tauri/icons/source.png" "file://$TMP/icon.html" >/dev/null 2>&1
npx tauri icon src-tauri/icons/source.png -o src-tauri/icons >/dev/null
rm -rf src-tauri/icons/{android,ios,Square*.png,StoreLogo.png,64x64.png}
echo "icons rendered → src-tauri/icons"
