//! Embed the browser viewer in the binary.
//!
//! The assets come from `viewer/dist`, or from `viewer/` next to this file if present.

use std::{
    env, fs,
    path::{Path, PathBuf},
};

fn main() {
    let manifest_dir = PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").unwrap());
    let candidates = [
        manifest_dir.join("../../viewer/dist"),
        manifest_dir.join("viewer"),
    ];
    println!("cargo:rerun-if-changed=build.rs");
    let Some(root) = candidates
        .iter()
        .find(|directory| directory.join("index.html").is_file())
    else {
        panic!(
            "viewer assets not found in viewer/dist or crates/bfplot-cli/viewer; \
             run `npm --prefix viewer run build`"
        );
    };
    let root = root.canonicalize().unwrap();
    // Cargo scans a directory recursively for changes.
    println!("cargo:rerun-if-changed={}", root.display());

    let mut files = Vec::new();
    collect(&root, &root, &mut files);
    files.sort();
    for required in ["index.html", "app.js", "style.css"] {
        assert!(
            files.iter().any(|(name, _)| name == required),
            "viewer assets in {} are missing {required}",
            root.display()
        );
    }

    let mut source = String::from("pub static ASSETS: &[(&str, &[u8])] = &[\n");
    for (name, path) in &files {
        source.push_str(&format!("    ({name:?}, include_bytes!({path:?})),\n"));
    }
    source.push_str("];\n");
    let out = PathBuf::from(env::var_os("OUT_DIR").unwrap()).join("viewer_assets.rs");
    fs::write(out, source).unwrap();
}

/// Runtime files only: source maps and type declarations are not embedded.
fn collect(root: &Path, directory: &Path, files: &mut Vec<(String, String)>) {
    for entry in fs::read_dir(directory).unwrap() {
        let path = entry.unwrap().path();
        if path.is_dir() {
            collect(root, &path, files);
            continue;
        }
        let name = path.file_name().unwrap().to_string_lossy();
        if name.ends_with(".map") || name.ends_with(".d.ts") || name.starts_with('.') {
            continue;
        }
        let relative = path
            .strip_prefix(root)
            .unwrap()
            .components()
            .map(|component| component.as_os_str().to_string_lossy())
            .collect::<Vec<_>>()
            .join("/");
        files.push((relative, path.to_string_lossy().into_owned()));
    }
}
