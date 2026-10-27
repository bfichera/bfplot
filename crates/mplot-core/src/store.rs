use std::{
    collections::BTreeSet,
    fs,
    path::{Path, PathBuf},
};

use serde::Serialize;

use crate::{
    Document, Error, Manifest, ObjectId, Result, error::io, format::array_refs, validate_document,
};

/// Content-addressed objects at `<root>/<2 hex>/<digest>`.
#[derive(Clone, Debug)]
pub struct ObjectStore {
    root: PathBuf,
}

impl ObjectStore {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    /// The store of a result directory: `<dir>/objects/sha256`.
    pub fn for_result_dir(dir: &Path) -> Self {
        Self::new(dir.join("objects/sha256"))
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn path(&self, id: &ObjectId) -> PathBuf {
        let digest = id.digest();
        self.root.join(&digest[..2]).join(digest)
    }

    pub fn put(&self, bytes: &[u8]) -> Result<ObjectId> {
        let id = ObjectId::of(bytes);
        let path = self.path(&id);
        if path.exists() {
            self.get(&id)?;
            return Ok(id);
        }
        let parent = path.parent().expect("object path has parent");
        fs::create_dir_all(parent).map_err(|e| io(parent, e))?;
        fs::write(&path, bytes).map_err(|e| io(&path, e))?;
        Ok(id)
    }

    /// Store `value` as canonical JSON: compact, with sorted keys.
    pub fn put_json<T: Serialize>(&self, value: &T) -> Result<ObjectId> {
        // `serde_json::Map` is a `BTreeMap` (no `preserve_order`), so keys come out sorted.
        self.put(&serde_json::to_vec(&serde_json::to_value(value)?)?)
    }

    pub fn get(&self, id: &ObjectId) -> Result<Vec<u8>> {
        let path = self.path(id);
        let bytes = fs::read(&path).map_err(|e| match e.kind() {
            std::io::ErrorKind::NotFound => Error::ObjectNotFound(id.to_string()),
            _ => io(path, e),
        })?;
        verify_bytes(id, &bytes)?;
        Ok(bytes)
    }
}

/// A loaded result directory.
#[derive(Clone, Debug)]
pub struct Artifact {
    pub manifest: Manifest,
    pub document: Document,
    pub store: ObjectStore,
}

/// Resolve a result directory, or its `manifest.toml`, to the manifest path and store.
pub fn locate_artifact(path: &Path) -> (PathBuf, ObjectStore) {
    let dir = if path.file_name().is_some_and(|name| name == "manifest.toml") {
        match path.parent() {
            Some(parent) if !parent.as_os_str().is_empty() => parent,
            _ => Path::new("."),
        }
    } else {
        path
    };
    (dir.join("manifest.toml"), ObjectStore::for_result_dir(dir))
}

pub fn load_artifact(path: &Path) -> Result<Artifact> {
    let (manifest_path, store) = locate_artifact(path);
    let text = fs::read_to_string(&manifest_path).map_err(|e| io(&manifest_path, e))?;
    let manifest: Manifest = toml::from_str(&text)?;
    let document = serde_json::from_slice(&store.get(&manifest.document)?)?;
    Ok(Artifact {
        manifest,
        document,
        store,
    })
}

#[derive(Clone, Debug, Default)]
pub struct VerificationReport {
    pub object_count: usize,
    pub byte_count: u64,
}

/// Validate a result directory and check the digest of every object it references.
pub fn verify_artifact(path: &Path) -> Result<VerificationReport> {
    let artifact = load_artifact(path)?;
    validate(&artifact.manifest, &artifact.document)?;
    let ids: BTreeSet<_> = std::iter::once(artifact.manifest.document.clone())
        .chain(array_refs(&artifact.document).0)
        .collect();
    let mut report = VerificationReport::default();
    for id in ids {
        report.byte_count += artifact.store.get(&id)?.len() as u64;
        report.object_count += 1;
    }
    Ok(report)
}

pub(crate) fn validate(manifest: &Manifest, document: &Document) -> Result<()> {
    let mut issues = validate_document(document);
    if manifest.format != "mplot" {
        issues.insert(
            0,
            format!("format: expected \"mplot\", got {:?}", manifest.format),
        );
    }
    if issues.is_empty() {
        Ok(())
    } else {
        Err(Error::Validation(issues.join("; ")))
    }
}

pub(crate) fn verify_bytes(expected: &ObjectId, bytes: &[u8]) -> Result<()> {
    let actual = ObjectId::of(bytes);
    if &actual != expected {
        return Err(Error::DigestMismatch {
            expected: expected.to_string(),
            actual: actual.digest(),
        });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use tempfile::tempdir;

    #[test]
    fn store_round_trip_and_detect_corruption() {
        let dir = tempdir().unwrap();
        let store = ObjectStore::new(dir.path());
        let id = store.put(b"hello").unwrap();
        assert_eq!(store.get(&id).unwrap(), b"hello");
        fs::write(store.path(&id), b"bad").unwrap();
        assert!(matches!(store.get(&id), Err(Error::DigestMismatch { .. })));
    }

    #[test]
    fn json_objects_are_canonical() {
        let dir = tempdir().unwrap();
        let store = ObjectStore::new(dir.path());
        let id = store
            .put_json(&json!({"z": {"b": 1, "a": 2}, "a": 3}))
            .unwrap();
        assert_eq!(store.get(&id).unwrap(), br#"{"a":3,"z":{"a":2,"b":1}}"#);
    }

    #[test]
    fn locates_directory_and_manifest_paths() {
        let result = Path::new("out/fit.mplot");
        for path in [result.to_path_buf(), result.join("manifest.toml")] {
            let (manifest, store) = locate_artifact(&path);
            assert_eq!(manifest, result.join("manifest.toml"));
            assert_eq!(store.root(), result.join("objects/sha256"));
        }
    }
}
