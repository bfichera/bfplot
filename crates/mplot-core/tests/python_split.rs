use std::fs;

use mplot_core::{Document, Manifest, ObjectStore, canonical_json_bytes, verify_artifact};
use tempfile::tempdir;

const PYTHON_DOCUMENT: &str = include_str!("fixtures/python-document.json");

#[test]
fn verifies_python_shaped_split_artifact_end_to_end() {
    let directory = tempdir().unwrap();
    let manifest_path = directory.path().join("python.mplot.toml");
    let store = ObjectStore::for_manifest(&manifest_path);

    // This payload stands in for the zstd bytes emitted by Python. Verification
    // intentionally checks identity, while decompression remains a consumer concern.
    let array_id = store.put(b"python-array").unwrap();
    assert_eq!(
        array_id.to_string(),
        "sha256:5158ec564ccbe099d39ea658f7ec1e6a0980b8c4550d3ddc75755a8d48c84724"
    );

    let document: Document = serde_json::from_str(PYTHON_DOCUMENT).unwrap();
    assert_eq!(document.schema_version, 1);
    assert_eq!(document.figures[0].metadata["dpi"], 100.0);
    assert_eq!(
        document.figures[0].axes[0].metadata["projection"],
        "rectilinear"
    );

    let document_id = store
        .put(&canonical_json_bytes(&document).unwrap())
        .unwrap();
    fs::write(
        &manifest_path,
        format!(
            "format = \"mplot\"\nversion = \"0.9.9\"\nschema_version = 1\ndocument = \"{document_id}\"\n"
        ),
    )
    .unwrap();

    let report = verify_artifact(&manifest_path).unwrap();
    assert_eq!(report.object_count, 2);

    let manifest: Manifest = toml::from_str(&fs::read_to_string(manifest_path).unwrap()).unwrap();
    assert_eq!(manifest.schema_version, 1);
}
