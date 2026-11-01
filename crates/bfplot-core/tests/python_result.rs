use std::fs;

use bfplot_core::{
    Document, ObjectStore, compare_artifacts, load_artifact, read_manifest, verify_artifact,
};
use tempfile::tempdir;

const PYTHON_DOCUMENT: &str = include_str!("fixtures/python-document.json");

/// Write the fixture as a result whose one array holds `values`, returning its hash.
fn write_result(dir: &std::path::Path, values: [f64; 2]) -> String {
    let store = ObjectStore::for_result_dir(dir);
    let raw: Vec<u8> = values.iter().flat_map(|v| v.to_le_bytes()).collect();
    let array = store.put_array(&raw, "f8", &[2]).unwrap();
    let text = PYTHON_DOCUMENT.replace(
        "sha256:5158ec564ccbe099d39ea658f7ec1e6a0980b8c4550d3ddc75755a8d48c84724",
        &array.object.to_string(),
    );
    let document: Document = serde_json::from_str(&text).unwrap();
    let hash = store.put_json(&document).unwrap();
    fs::write(
        dir.join("manifest.toml"),
        format!("format = \"bfplot\"\nversion = 2\nhash = \"{hash}\"\n\n# Preview\n# ⠉⠒⠤\n"),
    )
    .unwrap();
    hash.to_string()
}

#[test]
fn verifies_python_shaped_result_end_to_end() {
    let directory = tempdir().unwrap();
    let result = directory.path().join("fit.bfplot");
    let hash = write_result(&result, [0.0, 1.0]);

    let document: Document = serde_json::from_str(PYTHON_DOCUMENT).unwrap();
    assert_eq!(document.figures[0].properties["name"], "spectrum");
    assert_eq!(
        document.figures[0].axes[0].properties["projection"],
        "rectilinear"
    );

    let report = verify_artifact(&result).unwrap();
    assert_eq!(report.object_count, 2);
    assert_eq!(report.hash.to_string(), hash);
    let artifact = load_artifact(&result.join("manifest.toml")).unwrap();
    assert_eq!(artifact.hash().to_string(), hash);
    assert_eq!(read_manifest(&result).unwrap().hash.to_string(), hash);
}

#[test]
fn equal_content_gives_equal_hashes_and_any_change_differs() {
    let directory = tempdir().unwrap();
    let [first, second, changed] = ["a", "b", "c"].map(|n| directory.path().join(n));
    let a = write_result(&first, [0.0, 1.0]);
    let b = write_result(&second, [0.0, 1.0]);
    let c = write_result(&changed, [0.0, 2.0]);
    assert_eq!(a, b);
    assert_ne!(a, c);

    let same = compare_artifacts(&first, &second).unwrap();
    assert!(same.same() && same.differences.is_empty());
    let different = compare_artifacts(&first, &changed).unwrap();
    assert!(!different.same());
    assert_eq!(different.differences.len(), 1);
    assert!(
        different.differences[0].starts_with("figures[0].axes[0].artists[0].data.x: array"),
        "{:?}",
        different.differences
    );
}
