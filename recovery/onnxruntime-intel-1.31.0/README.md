# Temporary Intel ONNX Runtime backup

Backup only. Do not merge this branch into main. No release workflow or application version is changed by this backup.

Use only if the upstream repository remains unavailable for an extended period and recovery is explicitly requested. The failed v1.2.0 Intel build should wait for upstream to return before being rerun.

## Provenance

- Archived on 2026-11-19 from the existing local `src-tauri/onnxruntime/lib` directory.
- Runtime: ONNX Runtime 1.31.0, macOS x86_64.
- Binary modification date: 2026-10-19 (local filesystem metadata).
- Minimum macOS: 13.4, verified with `otool -l`.
- Install name: `@rpath/libonnxruntime.1.dylib`; current version: 1.31.0, verified with `otool -L`.
- Build script at backup base commit `5b3285ce0a4a13c155b659bbec8f1d6a4ef2723f`: `scripts/build-onnxruntime-intel.sh`.
- Build script Git blob: `ea37d3db0c4c9704e2de6289df72943e52a20bf1`.
- Binary SHA-256: `ec08eec6ab72e4e478e4e6ff349c30db9fcca6c57d54836174b9bf8b8ca399bc`.
- This is the preserved local binary, not a newly rebuilt runtime or a replacement downloaded from a third-party mirror. Equality with the previously published DMG has not been verified.

The archive contains the dylib, the linker symlink, `VERSION`, and a binary checksum file. The adjacent `SHA256SUMS` checks the archive itself.

## Manual recovery, only when authorized

From the repository root with these backup files present:

```sh
(cd recovery/onnxruntime-intel-1.31.0 && shasum -a 256 -c SHA256SUMS)
mkdir -p src-tauri/onnxruntime
tar -xzf recovery/onnxruntime-intel-1.31.0/onnxruntime-1.31.0-macos-x86_64.tar.gz -C src-tauri/onnxruntime
(cd src-tauri/onnxruntime/lib && shasum -a 256 -c SHA256SUMS)
```

Any future release must still pass native NER tests and the packaged app launch check on an Intel runner. This archive does not make CI consume it automatically.
