fn main() {
    link_clang_runtime();
    add_frameworks_rpath();
    tauri_build::build()
}

/// The prebuilt ONNX Runtime uses `@available` checks, which call
/// `__isPlatformVersionAtLeast` from clang's runtime; rustc doesn't link it.
fn link_clang_runtime() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("macos") {
        return;
    }
    let output = std::process::Command::new("clang")
        .arg("--print-runtime-dir")
        .output()
        .expect("failed to run clang --print-runtime-dir");
    let dir = String::from_utf8(output.stdout).expect("clang printed a non-UTF-8 path");
    println!("cargo:rustc-link-arg={}/libclang_rt.osx.a", dir.trim());
}

/// Intel builds link ONNX Runtime dynamically (`ORT_PREFER_DYNAMIC_LINK`) and
/// bundle the dylib in Contents/Frameworks (tauri.intel.conf.json).
fn add_frameworks_rpath() {
    println!("cargo:rerun-if-env-changed=ORT_PREFER_DYNAMIC_LINK");
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos")
        && std::env::var("ORT_PREFER_DYNAMIC_LINK").is_ok()
    {
        println!("cargo:rustc-link-arg=-Wl,-rpath,@executable_path/../Frameworks");
    }
}
