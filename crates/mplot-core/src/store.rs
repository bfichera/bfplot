use std::{
    collections::BTreeSet,
    fs,
    path::{Path, PathBuf},
};

use serde::Serialize;

use crate::{
    Document, Error, Manifest, ObjectId, Result, canonical_json_bytes, error::io,
    format::referenced_objects, validate_artifact,
};

#[derive(Clone, Debug)]
pub struct ObjectStore {
    root: PathBuf,
}

impl ObjectStore {
    /// Create a store rooted at `.mplot/objects/sha256`.
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }
    pub fn for_manifest(path: &Path) -> Self {
        Self::new(
            path.parent()
                .unwrap_or_else(|| Path::new("."))
                .join(".mplot/objects/sha256"),
        )
    }
    pub fn root(&self) -> &Path {
        &self.root
    }
    pub fn path(&self, id: &ObjectId) -> PathBuf {
        let digest = id.digest();
        self.root.join(&digest[..2]).join(digest)
    }
    pub fn put(&self, bytes: &[u8]) -> Result<ObjectId> {
        let id = ObjectId::from_bytes(bytes);
        let path = self.path(&id);
        if path.exists() {
            self.verify(&id)?;
            return Ok(id);
        }
        let parent = path.parent().expect("object path has parent");
        fs::create_dir_all(parent).map_err(|e| io(parent, e))?;
        let temporary = parent.join(format!(".{}.tmp-{}", id.digest(), std::process::id()));
        fs::write(&temporary, bytes).map_err(|e| io(&temporary, e))?;
        match fs::rename(&temporary, &path) {
            Ok(()) => Ok(id),
            Err(_) if path.exists() => {
                let _ = fs::remove_file(&temporary);
                self.verify(&id)?;
                Ok(id)
            }
            Err(error) => {
                let _ = fs::remove_file(&temporary);
                Err(io(path, error))
            }
        }
    }
    pub fn put_json<T: Serialize>(&self, value: &T) -> Result<ObjectId> {
        self.put(&canonical_json_bytes(value)?)
    }
    pub fn get(&self, id: &ObjectId) -> Result<Vec<u8>> {
        let path = self.path(id);
        let bytes = fs::read(&path).map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                Error::ObjectNotFound(id.to_string())
            } else {
                io(path, e)
            }
        })?;
        verify_bytes(id, &bytes)?;
        Ok(bytes)
    }
    pub fn verify(&self, id: &ObjectId) -> Result<()> {
        self.get(id).map(|_| ())
    }
}

#[derive(Clone, Debug)]
pub struct Artifact {
    pub manifest: Manifest,
    pub document: Document,
    pub store: ObjectStore,
}

pub fn load_artifact(path: &Path) -> Result<Artifact> {
    let text = fs::read_to_string(path).map_err(|e| io(path, e))?;
    let manifest: Manifest = toml::from_str(&text)?;
    let store = ObjectStore::for_manifest(path);
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

pub fn verify_artifact(path: &Path) -> Result<VerificationReport> {
    let artifact = load_artifact(path)?;
    let issues = validate_artifact(&artifact.manifest, &artifact.document, &artifact.store);
    if !issues.is_empty() {
        return Err(Error::Validation(
            issues
                .iter()
                .map(ToString::to_string)
                .collect::<Vec<_>>()
                .join("; "),
        ));
    }
    let ids: BTreeSet<_> = std::iter::once(artifact.manifest.document.clone())
        .chain(referenced_objects(&artifact.document))
        .collect();
    let mut report = VerificationReport::default();
    for id in ids {
        report.byte_count += artifact.store.get(&id)?.len() as u64;
        report.object_count += 1;
    }
    Ok(report)
}

pub(crate) fn verify_bytes(expected: &ObjectId, bytes: &[u8]) -> Result<()> {
    let actual = ObjectId::from_bytes(bytes);
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
}
