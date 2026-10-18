fn main() {
    link_clang_runtime();
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
