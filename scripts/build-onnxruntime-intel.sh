#!/usr/bin/env bash
# Builds ONNX Runtime as an x86_64 macOS dylib for the Intel app.
#
# ONNX Runtime no longer publishes x86_64 macOS binaries (the last was 1.23.2)
# and ort-sys has none for Intel, so Intel builds link this dylib dynamically
# and bundle it (src-tauri/tauri.intel.conf.json). Apple Silicon builds use the
# static library ort-sys downloads; keep ORT_VERSION in sync with that.
#
# Output: src-tauri/onnxruntime/lib/libonnxruntime.1.dylib
# Then:   ORT_LIB_PATH=$PWD/src-tauri/onnxruntime/lib ORT_PREFER_DYNAMIC_LINK=1 \
#           npm run tauri build -- --target x86_64-apple-darwin --config src-tauri/tauri.intel.conf.json
set -euo pipefail

ORT_VERSION=1.31.0
MACOS_TARGET=13.4 # bundle.macOS.minimumSystemVersion in tauri.conf.json

root=$(cd "$(dirname "$0")/.." && pwd)
out="$root/src-tauri/onnxruntime/lib"
work="${ORT_BUILD_DIR:-${TMPDIR:-/tmp}/onnxruntime-build}"

if [ "$(cat "$out/VERSION" 2>/dev/null)" = "$ORT_VERSION" ]; then
  echo "ONNX Runtime $ORT_VERSION already built in $out"
  exit 0
fi

if [ ! -d "$work/onnxruntime" ]; then
  git clone --depth 1 --branch "v$ORT_VERSION" https://github.com/microsoft/onnxruntime.git "$work/onnxruntime"
fi

generator=()
if command -v ninja >/dev/null; then
  generator=(--cmake_generator Ninja)
fi

# --apple_deploy_target only applies to framework builds, so set the
# deployment target directly; otherwise it defaults to the build machine's SDK.
python3 "$work/onnxruntime/tools/ci_build/build.py" \
  --build_dir "$work/build" \
  --config Release \
  --build_shared_lib \
  --parallel \
  --skip_tests \
  --compile_no_warning_as_error \
  --no_telemetry \
  --osx_arch x86_64 \
  "${generator[@]}" \
  --cmake_extra_defines \
    CMAKE_OSX_ARCHITECTURES=x86_64 \
    CMAKE_OSX_DEPLOYMENT_TARGET="$MACOS_TARGET" \
    onnxruntime_BUILD_UNIT_TESTS=OFF

# The dylib's install name is @rpath/libonnxruntime.1.dylib, so bundle it under
# that name; the unversioned symlink is for the linker.
mkdir -p "$out"
cp "$work/build/Release/libonnxruntime.$ORT_VERSION.dylib" "$out/libonnxruntime.1.dylib"
ln -sf libonnxruntime.1.dylib "$out/libonnxruntime.dylib"
echo "$ORT_VERSION" > "$out/VERSION"
echo "Built ONNX Runtime $ORT_VERSION in $out"
