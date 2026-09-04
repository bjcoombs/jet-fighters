#!/bin/sh
# Run Blender headless on the console build script. Set BLENDER to point at a binary
# that is not on PATH; the macOS app bundle is tried as the fallback.
set -e
cd "$(dirname "$0")/../.."
BLENDER="${BLENDER:-$(command -v blender || true)}"
if [ -z "$BLENDER" ] && [ -x /Applications/Blender.app/Contents/MacOS/Blender ]; then
  BLENDER=/Applications/Blender.app/Contents/MacOS/Blender
fi
if [ -z "$BLENDER" ]; then
  echo "blender not found: install Blender 4.2+ or set BLENDER=/path/to/blender" >&2
  exit 1
fi
exec "$BLENDER" --background --python tools/model/build_console.py -- "$@"
