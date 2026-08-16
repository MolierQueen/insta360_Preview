#!/bin/zsh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$ROOT/Product"
CACHE="$ROOT/.build-cache/windows-x64"
NODE_VERSION="22.16.0"
PYTHON_VERSION="3.14.6"
RUNTIME_RELEASE="20260718"

PYTHON_ARCHIVE="$CACHE/cpython-windows-x64.tar.gz"
NODE_ARCHIVE="$CACHE/node-windows-x64.zip"
PYTHON_URL="https://github.com/astral-sh/python-build-standalone/releases/download/$RUNTIME_RELEASE/cpython-$PYTHON_VERSION%2B$RUNTIME_RELEASE-x86_64-pc-windows-msvc-install_only_stripped.tar.gz"
NODE_URL="https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-win-x64.zip"
APP="$DIST/Insta Library-Windows-x64"
APP_ROOT="$APP/Resources/app"
RUNTIME="$APP/Resources/runtime"

for command_name in curl ditto npm perl rsync tar unzip zip; do
  command -v "$command_name" >/dev/null || { print -u2 "missing build command: $command_name"; exit 1; }
done

if [[ ! -x "$ROOT/web/node_modules/.bin/vinext" ]]; then
  print "Installing locked web build dependencies..."
  npm_config_cache="$ROOT/.build-cache/npm" npm --prefix "$ROOT/web" ci
fi

mkdir -p "$DIST" "$CACHE"
[[ -s "$PYTHON_ARCHIVE" ]] || curl -L --fail --retry 3 --connect-timeout 20 --max-time 600 -o "$PYTHON_ARCHIVE" "$PYTHON_URL"
[[ -s "$NODE_ARCHIVE" ]] || curl -L --fail --retry 3 --connect-timeout 20 --max-time 600 -o "$NODE_ARCHIVE" "$NODE_URL"

print "Building production web bundle..."
(cd "$ROOT/web" && npm run build)

rm -rf "$APP"
mkdir -p "$APP_ROOT/tools" "$APP_ROOT/vendor/insta360-wifi-api" \
  "$APP_ROOT/python-packages" "$RUNTIME" "$APP/Resources/Licenses"

cp "$ROOT/packaging/windows/Insta Library.cmd" "$APP/Insta Library.cmd"
perl -pi -e 's/\r?\n/\r\n/g' "$APP/Insta Library.cmd"
cp "$ROOT/packaging/windows/README-使用说明.txt" "$APP/README.txt"
cp "$ROOT/packaging/licenses/NODE_LICENSE" "$APP/Resources/Licenses/Node-LICENSE"
cp "$ROOT/packaging/THIRD_PARTY_NOTICES.md" "$APP/Resources/Licenses/THIRD_PARTY_NOTICES.md"

tar -xzf "$PYTHON_ARCHIVE" -C "$RUNTIME"
NODE_EXTRACT="$CACHE/node-extract"
rm -rf "$NODE_EXTRACT"
mkdir -p "$NODE_EXTRACT"
unzip -q "$NODE_ARCHIVE" -d "$NODE_EXTRACT"
cp "$NODE_EXTRACT/node-v$NODE_VERSION-win-x64/node.exe" "$RUNTIME/node.exe"
rm -rf "$NODE_EXTRACT"

cp "$ROOT/tools/insta360_web_server.py" "$APP_ROOT/tools/"
cp "$ROOT/tools/probe_ucd2_replay_readonly.py" "$APP_ROOT/tools/"
cp "$ROOT/tools/run_bundled_app.py" "$APP_ROOT/tools/"
cp "$ROOT/tools/standalone_web_server.mjs" "$APP_ROOT/tools/"
ditto "$ROOT/web/dist" "$APP_ROOT/web-dist"
ditto "$ROOT/vendor/insta360-wifi-api/pb2" "$APP_ROOT/vendor/insta360-wifi-api/pb2"
cp "$ROOT/vendor/insta360-wifi-api/LICENSE" "$APP_ROOT/vendor/insta360-wifi-api/LICENSE"
ditto "$ROOT/packaging/python-packages" "$APP_ROOT/python-packages"
find "$APP" -name '__pycache__' -type d -prune -exec rm -rf {} +

ZIP_PATH="$DIST/Insta-Library-Windows-x64.zip"
rm -f "$ZIP_PATH"
(cd "$DIST" && zip -q -r "$(basename "$ZIP_PATH")" "$(basename "$APP")")
print "Created $ZIP_PATH"
