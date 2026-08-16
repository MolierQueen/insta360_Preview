---
name: build-insta-library
description: Build, rebuild, verify, and package Insta Library distributions from this repository for Apple Silicon macOS, Intel macOS, Windows x64, or all supported targets. Use when a user asks an AI to 打包、编译、生成产物、重新构建 App, prepare Product ZIPs, validate distribution architecture, or create a source package for friends. Detect the host OS, use the repository's maintained build scripts, preserve unrelated work, and never claim an unsupported cross-platform build succeeded.
---

# Build Insta Library

Build reproducible packages with the scripts maintained in this repository. Treat the scripts as the source of truth; do not recreate packaging commands ad hoc.

## Locate the repository

1. Work from the repository root containing `tools/`, `web/`, `packaging/`, and `vendor/`.
2. Read `git status --short` before changing or building anything. Preserve all existing user changes.
3. Confirm `Product/` and `.build-cache/` are ignored. Never add either directory to Git.
4. Inspect the selected build script before running it if it has changed since this Skill was authored.

## Select supported targets

Detect the host before choosing commands.

- On macOS, support `arm64`, `x86_64`, both Mac architectures, Windows x64 cross-packaging, and the source ZIP.
- On Windows 10/11 x64, support the Windows x64 package with `tools/build_windows_distribution.ps1`.
- Do not attempt macOS bundles on Windows or Linux. macOS compilation, signing, CoreImage HDR tooling, and bundle metadata require macOS.
- On Linux, stop after read-only inspection and explain that the current repository has no supported native distribution target.
- If the requested target is ambiguous, build the host-native package. If the user explicitly asks for “all” on macOS, build both Mac architectures, Windows x64, and the source ZIP.

## Run preflight checks

Before building:

1. Confirm the required source paths exist, including `web/package-lock.json`, `assets/InstaLibraryIcon.png`, `packaging/python-packages`, and `vendor/insta360-wifi-api/pb2`.
2. On macOS, require `clang`, `codesign`, `curl`, `ditto`, `node`, `npm`, `python3`, `rsync`, `sips`, and `tar`. For Mac packages, also require the selected `vendor/ultrahdr/macos-*/ultrahdr_app` files.
3. On Windows, require PowerShell, `node`, `npm`, and `tar`.
4. Reuse `.build-cache/` and existing `web/node_modules/`. Allow the maintained scripts to download missing locked dependencies and runtimes. Do not reinstall when the required cache already exists.
5. Ask before installing or changing system-wide tools. A build request authorizes project-local dependency downloads and replacement of the exact requested target inside `Product/`, but not unrelated system changes.
6. Ensure an old Insta Library instance is not running before replacing a Mac bundle.

## Validate before packaging

On macOS, prefer the project virtual environment when present:

```bash
.venv/bin/python -m unittest discover -s tests
```

If `.venv` is absent, use the bundled offline packages:

```bash
env PYTHONPATH=packaging/python-packages python3 -m unittest discover -s tests
```

On Windows PowerShell:

```powershell
$env:PYTHONPATH = Join-Path $PWD "packaging\python-packages"
python -m unittest discover -s tests
```

Stop on test failure. Explain missing dependencies separately from code failures.

## Build requested packages

Run from the repository root.

On macOS:

```bash
tools/build_distributions.sh arm64
tools/build_distributions.sh x86_64
tools/build_distributions.sh all
tools/build_windows_distribution.sh
tools/build_source_package.sh
```

Choose only the commands needed for the requested targets. `build_distributions.sh all` means both Mac architectures; it does not include Windows or the source ZIP.

On Windows PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File tools\build_windows_distribution.ps1
```

## Verify outputs

After a successful build:

1. Confirm every requested ZIP exists in `Product/` and has nonzero size.
2. For Mac bundles, use `file` on `Contents/MacOS/InstaLibraryNativeLauncher` and require `arm64` for Apple Silicon or `x86_64` for Intel. Run `codesign --verify --deep --strict` on each bundle.
3. Compare each unpacked product's embedded `probe_ucd2_replay_readonly.py` with the repository source so an old package cannot be reported as current.
4. For Windows, inspect the ZIP and require `Insta Library.cmd`, bundled `pythonw.exe`, `node.exe`, the web bundle, and the current protocol source.
5. Generate SHA-256 checksums and report file sizes.
6. Report absolute paths or clickable links to the products. State clearly which requested targets were not supported on the current host.

Do not commit, upload, notarize, or publish packages unless the user explicitly requests those separate actions.
