#!/bin/zsh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$ROOT/Product"
SOURCE="$DIST/InstaLibrary-Source"
ZIP="$DIST/InstaLibrary-Source.zip"

rm -rf "$SOURCE"
mkdir -p "$SOURCE"

for item in .agents assets docs packaging tests tools vendor web; do
  rsync -a \
    --exclude '.DS_Store' --exclude '__pycache__' --exclude '*.pyc' \
    --exclude '.git' --exclude '*.tsbuildinfo' \
    --exclude 'node_modules' --exclude 'dist' --exclude '.wrangler' --exclude '.vinext' \
    "$ROOT/$item" "$SOURCE/"
done

for file in INSTA360_WIFI_DESKTOP_PLAN.md RUN_READONLY_PROBE.md WEB_APP.md requirements.txt; do
  cp "$ROOT/$file" "$SOURCE/"
done

cp "$ROOT/docs/insta-library-implementation.html" "$SOURCE/README.html"
cp "$ROOT/README.md" "$SOURCE/README.md"
cp "$ROOT/docs/DEVELOPMENT.md" "$SOURCE/DEVELOPMENT.md"

rm -f "$ZIP"
ditto -c -k --sequesterRsrc --keepParent "$SOURCE" "$ZIP"
print "Created $ZIP"
