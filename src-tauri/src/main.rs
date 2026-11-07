#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Intel Macs load ONNX Runtime from the app bundle (see prism-core/Cargo.toml).
    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    if std::env::var_os("ORT_DYLIB_PATH").is_none()
        && let Some(lib) = std::env::current_exe()
            .ok()
            .and_then(|exe| Some(exe.parent()?.parent()?.join("Resources/libonnxruntime.dylib")))
            .filter(|p| p.exists())
    {
        // SAFETY: called first thing in main, before any other thread exists.
        unsafe { std::env::set_var("ORT_DYLIB_PATH", lib) };
    }
    prism_app_lib::run()
}
