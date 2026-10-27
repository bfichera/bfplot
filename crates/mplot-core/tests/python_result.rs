use std::fs;

use mplot_core::{
    Document, ObjectStore, load_artifact, pack_artifact, verify_artifact, verify_packed,
};
use tempfile::tempdir;

const PYTHON_DOCUMENT: &str = include_str!("fixtures/python-document.json");

#[test]
fn verifies_python_shaped_result_end_to_end() {
    let directory = tempdir().unwrap();
    let result = directory.path().join("fit.mplot");
    let store = ObjectStore::for_result_dir(&result);

    // Stands in for the zstd bytes written by Python: verification checks identity only.
    let array_id = store.put(b"python-array").unwrap();
    assert_eq!(
        array_id.to_string(),
        "sha256:5158ec564ccbe099d39ea658f7ec1e6a0980b8c4550d3ddc75755a8d48c84724"
    );
    assert!(
        result
            .join("objects/sha256/51")
            .join(array_id.digest())
            .is_file()
    );

    let document: Document = serde_json::from_str(PYTHON_DOCUMENT).unwrap();
    assert_eq!(document.figures[0].metadata["name"], "spectrum");
    assert_eq!(
        document.figures[0].axes[0].metadata["projection"],
        "rectilinear"
    );
    let document_id = store.put_json(&document).unwrap();
    fs::write(
        result.join("manifest.toml"),
        format!("format = \"mplot\"\ndocument = \"{document_id}\"\n\n[provenance]\ncreated_utc = \"2026-01-01T00:00:00Z\"\n"),
    )
    .unwrap();

    assert_eq!(verify_artifact(&result).unwrap().object_count, 2);
    let artifact = load_artifact(&result.join("manifest.toml")).unwrap();
    assert_eq!(
        artifact.manifest.provenance["created_utc"],
        "2026-01-01T00:00:00Z"
    );

    let packed = directory.path().join("fit.packed.mplot");
    pack_artifact(&result, &packed).unwrap();
    assert_eq!(verify_packed(&packed).unwrap().object_count, 2);
}
