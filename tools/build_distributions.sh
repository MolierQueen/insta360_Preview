#!/bin/zsh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$ROOT/Product"
CACHE="$ROOT/.build-cache/python"
NODE_VERSION="22.16.0"
PYTHON_VERSION="3.14.6"
RUNTIME_RELEASE="20260718"
TARGET="${1:-all}"

ARM_ARCHIVE="$CACHE/cpython-arm64.tar.gz"
INTEL_ARCHIVE="$CACHE/cpython-x86_64.tar.gz"
ARM_NODE_ARCHIVE="$CACHE/node-arm64.tar.gz"
INTEL_NODE_ARCHIVE="$CACHE/node-x86_64.tar.gz"
ARM_URL="https://github.com/astral-sh/python-build-standalone/releases/download/$RUNTIME_RELEASE/cpython-$PYTHON_VERSION%2B$RUNTIME_RELEASE-aarch64-apple-darwin-install_only_stripped.tar.gz"
INTEL_URL="https://github.com/astral-sh/python-build-standalone/releases/download/$RUNTIME_RELEASE/cpython-$PYTHON_VERSION%2B$RUNTIME_RELEASE-x86_64-apple-darwin-install_only_stripped.tar.gz"
ARM_NODE_URL="https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-darwin-arm64.tar.gz"
INTEL_NODE_URL="https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-darwin-x64.tar.gz"

if [[ "$TARGET" != "all" && "$TARGET" != "arm64" && "$TARGET" != "x86_64" ]]; then
  print -u2 "usage: tools/build_distributions.sh [all|arm64|x86_64]"
  exit 2
fi

for command_name in clang codesign curl ditto node npm python3 rsync sips tar; do
  command -v "$command_name" >/dev/null || { print -u2 "missing build command: $command_name"; exit 1; }
done

if [[ ! -x "$ROOT/web/node_modules/.bin/vinext" ]]; then
  print "Installing locked web build dependencies..."
  npm_config_cache="$ROOT/.build-cache/npm" npm --prefix "$ROOT/web" ci
fi

mkdir -p "$DIST" "$CACHE"
if [[ "$TARGET" == "all" || "$TARGET" == "arm64" ]]; then
  [[ -s "$ARM_ARCHIVE" ]] || curl -L --fail --retry 3 --connect-timeout 20 --max-time 600 -o "$ARM_ARCHIVE" "$ARM_URL"
  [[ -s "$ARM_NODE_ARCHIVE" ]] || curl -L --fail --retry 3 --connect-timeout 20 --max-time 600 -o "$ARM_NODE_ARCHIVE" "$ARM_NODE_URL"
fi
if [[ "$TARGET" == "all" || "$TARGET" == "x86_64" ]]; then
  [[ -s "$INTEL_ARCHIVE" ]] || curl -L --fail --retry 3 --connect-timeout 20 --max-time 600 -o "$INTEL_ARCHIVE" "$INTEL_URL"
  [[ -s "$INTEL_NODE_ARCHIVE" ]] || curl -L --fail --retry 3 --connect-timeout 20 --max-time 600 -o "$INTEL_NODE_ARCHIVE" "$INTEL_NODE_URL"
fi

ICON_CACHE="$ROOT/.build-cache/icon"
mkdir -p "$ICON_CACHE/AppIcon.iconset"
sips -z 32 32 "$ROOT/assets/InstaLibraryIcon.png" --out "$ICON_CACHE/AppIcon.iconset/icon_16x16@2x.png" >/dev/null
sips -z 128 128 "$ROOT/assets/InstaLibraryIcon.png" --out "$ICON_CACHE/AppIcon.iconset/icon_128x128.png" >/dev/null
sips -z 256 256 "$ROOT/assets/InstaLibraryIcon.png" --out "$ICON_CACHE/AppIcon.iconset/icon_128x128@2x.png" >/dev/null
python3 "$ROOT/tools/build_app_icon.py" "$ICON_CACHE/AppIcon.iconset" "$ICON_CACHE/AppIcon.icns"

print "Building production web bundle..."
(cd "$ROOT/web" && npm run build)

function build_app() {
  local architecture="$1"
  local label="$2"
  local archive="$3"
  local node_archive="$4"
  local node_folder="$5"
  local app="$DIST/Insta Library-$label.app"
  local resources="$app/Contents/Resources"
  local app_root="$resources/app"
  local hdr_codec="$ROOT/vendor/ultrahdr/macos-$architecture/ultrahdr_app"

  if [[ ! -x "$hdr_codec" ]]; then
    print -u2 "missing Ultra HDR codec for $architecture: $hdr_codec"
    print -u2 "build the HDR codec cache before packaging this architecture"
    exit 1
  fi

  # Replacing an app bundle does not stop processes that were launched from
  # the previous bundle. Refuse to overwrite a live copy, otherwise the user
  # keeps seeing the old web UI even though a new app exists on disk.
  local bundled_node="$app/Contents/Resources/runtime/node"
  if command -v lsof >/dev/null && [[ -f "$bundled_node" ]] && lsof "$bundled_node" >/dev/null 2>&1; then
    print -u2 "Insta Library-$label is still running. Click '退出应用' or close it before rebuilding."
    exit 1
  fi

  rm -rf "$app"
  mkdir -p "$app/Contents/MacOS" "$resources/runtime" "$app_root/tools" \
    "$app_root/vendor/insta360-wifi-api" "$app_root/python-packages" "$resources/Licenses"

  cp "$ROOT/packaging/Info.plist" "$app/Contents/Info.plist"
  cp "$ROOT/packaging/InstaLibraryLauncher" "$app/Contents/MacOS/InstaLibraryLauncher"
  cp "$ICON_CACHE/AppIcon.icns" "$resources/AppIcon.icns"
  cp "$ROOT/packaging/licenses/NODE_LICENSE" "$resources/Licenses/Node-LICENSE"
  cp "$ROOT/packaging/THIRD_PARTY_NOTICES.md" "$resources/Licenses/THIRD_PARTY_NOTICES.md"
  cp "$ROOT/vendor/ultrahdr/LICENSE" "$resources/Licenses/UltraHDR-LICENSE"

  clang -Os -arch "$architecture" -mmacosx-version-min=11.0 \
    "$ROOT/tools/macos_app_launcher.c" \
    -o "$app/Contents/MacOS/InstaLibraryNativeLauncher"
  clang++ -fobjc-arc -O2 -arch "$architecture" -mmacosx-version-min=15.0 \
    -framework Foundation -framework CoreImage -framework ImageIO -framework CoreGraphics \
    "$ROOT/tools/apple_adaptive_hdr_writer.mm" \
    -o "$app_root/tools/apple_adaptive_hdr_writer"
  local node_extract="$CACHE/node-extract-$architecture"
  rm -rf "$node_extract"
  mkdir -p "$node_extract"
  tar -xzf "$node_archive" -C "$node_extract"
  cp "$node_extract/$node_folder/bin/node" "$resources/runtime/node"
  rm -rf "$node_extract"
  tar -xzf "$archive" -C "$resources/runtime"

  cp "$ROOT/tools/insta360_web_server.py" "$app_root/tools/"
  cp "$ROOT/tools/probe_ucd2_replay_readonly.py" "$app_root/tools/"
  cp "$ROOT/tools/run_bundled_app.py" "$app_root/tools/"
  cp "$ROOT/tools/standalone_web_server.mjs" "$app_root/tools/"
  cp "$hdr_codec" "$app_root/tools/ultrahdr_app"
  ditto "$ROOT/web/dist" "$app_root/web-dist"
  ditto "$ROOT/vendor/insta360-wifi-api/pb2" "$app_root/vendor/insta360-wifi-api/pb2"
  cp "$ROOT/vendor/insta360-wifi-api/LICENSE" "$app_root/vendor/insta360-wifi-api/LICENSE"
  ditto "$ROOT/packaging/python-packages" "$app_root/python-packages"

  chmod +x "$app/Contents/MacOS/InstaLibraryLauncher" \
    "$app/Contents/MacOS/InstaLibraryNativeLauncher" \
    "$app_root/tools/apple_adaptive_hdr_writer" \
    "$app_root/tools/ultrahdr_app" \
    "$resources/runtime/node" "$resources/runtime/python/bin/python3"
  find "$app" -name '__pycache__' -type d -prune -exec rm -rf {} +
  xattr -cr "$app"
  codesign --force --deep --sign - --identifier local.insta360.library "$app"
  codesign --verify --deep --strict "$app"

  local zip_path="$DIST/Insta-Library-$label.zip"
  rm -f "$zip_path"
  ditto -c -k --sequesterRsrc --keepParent "$app" "$zip_path"
  print "Created $app"
}

[[ "$TARGET" == "all" || "$TARGET" == "arm64" ]] && build_app arm64 "Apple-Silicon" "$ARM_ARCHIVE" "$ARM_NODE_ARCHIVE" "node-v$NODE_VERSION-darwin-arm64"
[[ "$TARGET" == "all" || "$TARGET" == "x86_64" ]] && build_app x86_64 "Intel" "$INTEL_ARCHIVE" "$INTEL_NODE_ARCHIVE" "node-v$NODE_VERSION-darwin-x64"

cp "$ROOT/packaging/DISTRIBUTION_README.md" "$DIST/README-分发说明.md"
print "Distribution build complete."
