#!/usr/bin/env bash
# Intel Macs: ONNX Runtime stopped shipping x86_64 macOS builds after 1.23, so Prism loads
# this pinned, checksum-verified 1.23.2 dylib at runtime (ort `load-dynamic`).
# Prints the path of the extracted libonnxruntime.dylib.
#
# Usage: build/fetch-onnxruntime-intel.sh [dest-dir]   (default: target/onnxruntime-x64)
set -euo pipefail
VERSION=1.23.2
SHA256=d10359e16347b57d9959f7e80a225a5b4a66ed7d7e007274a15cae86836485a6
dest="${1:-target/onnxruntime-x64}"
lib="$dest/libonnxruntime.dylib"
if [[ ! -f "$lib" ]]; then
  mkdir -p "$dest"
  tgz="$dest/ort.tgz"
  curl -fsSL -o "$tgz" "https://github.com/microsoft/onnxruntime/releases/download/v$VERSION/onnxruntime-osx-x86_64-$VERSION.tgz"
  echo "$SHA256  $tgz" | shasum -a 256 -c - >&2
  tar -xzf "$tgz" -C "$dest"
  cp "$dest/onnxruntime-osx-x86_64-$VERSION/lib/libonnxruntime.$VERSION.dylib" "$lib"
  rm -rf "$tgz" "$dest/onnxruntime-osx-x86_64-$VERSION"
fi
echo "$(cd "$dest" && pwd)/libonnxruntime.dylib"
