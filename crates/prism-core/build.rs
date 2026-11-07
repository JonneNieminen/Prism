// ONNX Runtime's Core ML provider uses `@available(...)`, which compiles to calls
// into clang's runtime (`__isPlatformVersionAtLeast`). Rust doesn't link that
// runtime, so builds with a deployment target (release bundles) fail to link.
fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("macos") {
        return;
    }
    let out = std::process::Command::new("clang").arg("--print-runtime-dir").output();
    if let Ok(o) = out {
        let dir = String::from_utf8_lossy(&o.stdout).trim().to_string();
        if !dir.is_empty() && std::path::Path::new(&dir).join("libclang_rt.osx.a").exists() {
            println!("cargo:rustc-link-search=native={dir}");
            println!("cargo:rustc-link-lib=static=clang_rt.osx");
        }
    }
}
