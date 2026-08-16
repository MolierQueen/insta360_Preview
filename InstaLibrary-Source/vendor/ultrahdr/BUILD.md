# Ultra HDR codec builds

The bundled macOS binaries are built from Google's `libultrahdr` reference codec with XMP and ISO gain-map metadata enabled.

The upstream default maximum image edge is 8192 pixels. A portrait photo becomes taller after the frame is added, so these binaries are compiled with:

```text
-DUHDR_MAX_DIMENSION=32768
```

Keep this option when replacing or rebuilding either `macos-arm64/ultrahdr_app` or `macos-x86_64/ultrahdr_app`. The application does not resize the source photo to fit this codec limit.
