use std::fs;

use mplot_core::{
    Document, Manifest, ObjectStore, canonical_json_bytes, load_artifact, verify_artifact,
};
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

#[test]
fn verifies_directory_layout_result_end_to_end() {
    let directory = tempdir().unwrap();
    let result = directory.path().join("fit.mplot");
    let store = ObjectStore::for_result_dir(&result);
    let array_id = store.put(b"python-array").unwrap();
    assert_eq!(
        store.path(&array_id),
        result.join(format!(
            "objects/sha256/{}/{}",
            &array_id.digest()[..2],
            array_id.digest()
        ))
    );

    let mut document: serde_json::Value = serde_json::from_str(PYTHON_DOCUMENT).unwrap();
    document["schema_version"] = 2.into();
    document["figures"][0]["name"] = "spectrum".into();
    let document: Document = serde_json::from_value(document).unwrap();
    assert_eq!(document.figures[0].metadata["name"], "spectrum");
    let document_id = store
        .put(&canonical_json_bytes(&document).unwrap())
        .unwrap();
    fs::write(
        result.join("manifest.toml"),
        format!(
            "format = \"mplot\"\nversion = \"0.9.9\"\nschema_version = 2\ndocument = \"{document_id}\"\n"
        ),
    )
    .unwrap();
    fs::write(result.join(".gitignore"), "/objects/\n").unwrap();

    assert_eq!(verify_artifact(&result).unwrap().object_count, 2);
    assert_eq!(
        verify_artifact(&result.join("manifest.toml"))
            .unwrap()
            .object_count,
        2
    );
    let artifact = load_artifact(&result).unwrap();
    assert_eq!(artifact.manifest.schema_version, 2);
    assert_eq!(artifact.document.figures[0].metadata["name"], "spectrum");
}
