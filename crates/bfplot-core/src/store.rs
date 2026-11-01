use std::{
    collections::BTreeSet,
    fs,
    io::Read,
    path::{Path, PathBuf},
};

use serde::Serialize;

use crate::{
    ArrayRef, Document, Error, Manifest, ObjectId, Result, error::io, format::array_refs,
    validate_document,
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

    /// Store `bytes` under their own digest (documents and uncompressed arrays).
    pub fn put(&self, bytes: &[u8]) -> Result<ObjectId> {
        let id = ObjectId::of(bytes);
        self.write(&id, bytes)?;
        Ok(id)
    }

    /// Store `value` as canonical JSON: compact, with sorted keys.
    pub fn put_json<T: Serialize>(&self, value: &T) -> Result<ObjectId> {
        // `serde_json::Map` is a `BTreeMap` (no `preserve_order`), so keys come out sorted.
        self.put(&serde_json::to_vec(&serde_json::to_value(value)?)?)
    }

    /// Store raw little-endian array bytes zstd-compressed, named by the raw bytes' digest.
    pub fn put_array(&self, raw: &[u8], dtype: &str, shape: &[u64]) -> Result<ArrayRef> {
        let reference = ArrayRef {
            object: ObjectId::of(raw),
            dtype: dtype.into(),
            shape: shape.to_vec(),
            codec: "zstd".into(),
        };
        if let Some(issue) = reference.issues().into_iter().next() {
            return Err(Error::Validation(issue));
        }
        if reference.byte_len() != Some(raw.len() as u64) {
            return Err(Error::Validation(format!(
                "{} bytes do not fit dtype {dtype:?} and shape {shape:?}",
                raw.len()
            )));
        }
        let compressed =
            ruzstd::encoding::compress_to_vec(raw, ruzstd::encoding::CompressionLevel::Fastest);
        self.write(&reference.object, &compressed)?;
        Ok(reference)
    }

    fn write(&self, id: &ObjectId, bytes: &[u8]) -> Result<()> {
        let path = self.path(id);
        if path.exists() {
            return Ok(());
        }
        let parent = path.parent().expect("object path has parent");
        fs::create_dir_all(parent).map_err(|e| io(parent, e))?;
        fs::write(&path, bytes).map_err(|e| io(&path, e))
    }

    /// The stored bytes of an object, unchecked.
    pub fn read(&self, id: &ObjectId) -> Result<Vec<u8>> {
        let path = self.path(id);
        fs::read(&path).map_err(|e| match e.kind() {
            std::io::ErrorKind::NotFound => Error::ObjectNotFound(id.to_string()),
            _ => io(path, e),
        })
    }

    /// An object stored as its own bytes, such as the document, checked against `id`.
    pub fn get(&self, id: &ObjectId) -> Result<Vec<u8>> {
        let bytes = self.read(id)?;
        verify_bytes(id, &bytes)?;
        Ok(bytes)
    }

    /// The stored bytes of an array object, checked by decoding them.
    pub fn get_array_stored(&self, reference: &ArrayRef) -> Result<Vec<u8>> {
        let stored = self.read(&reference.object)?;
        decode_array(reference, &stored)?;
        Ok(stored)
    }

    /// The decoded bytes of an array, checked against its digest, dtype and shape.
    pub fn get_array(&self, reference: &ArrayRef) -> Result<Vec<u8>> {
        decode_array(reference, &self.read(&reference.object)?)
    }
}

/// Decode stored array bytes and check them against `reference`.
pub fn decode_array(reference: &ArrayRef, stored: &[u8]) -> Result<Vec<u8>> {
    let fail = |reason: String| Error::Decode {
        object: reference.object.to_string(),
        reason,
    };
    if let Some(issue) = reference.issues().into_iter().next() {
        return Err(fail(issue));
    }
    let expected = reference.byte_len().expect("checked by issues()");
    let raw = match reference.codec.as_str() {
        "none" => stored.to_vec(),
        _ => {
            let decoder = ruzstd::decoding::StreamingDecoder::new(stored)
                .map_err(|error| fail(error.to_string()))?;
            let mut raw = Vec::new();
            // Read one byte more than expected, so an oversized object is caught cheaply.
            decoder
                .take(expected.saturating_add(1))
                .read_to_end(&mut raw)
                .map_err(|error| fail(error.to_string()))?;
            raw
        }
    };
    if raw.len() as u64 != expected {
        let found = if raw.len() as u64 > expected {
            "more".to_string()
        } else {
            raw.len().to_string()
        };
        return Err(fail(format!(
            "expected {expected} bytes for dtype {:?} and shape {:?}, found {found}",
            reference.dtype, reference.shape,
        )));
    }
    verify_bytes(&reference.object, &raw)?;
    Ok(raw)
}

/// A loaded result directory.
#[derive(Clone, Debug)]
pub struct Artifact {
    pub manifest: Manifest,
    pub document: Document,
    pub store: ObjectStore,
}

impl Artifact {
    /// The result's hash: equal hashes mean identical figures, timelines and arrays.
    pub fn hash(&self) -> &ObjectId {
        &self.manifest.hash
    }
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

/// Read and parse a result's manifest without touching its objects.
pub fn read_manifest(path: &Path) -> Result<Manifest> {
    let (manifest_path, _) = locate_artifact(path);
    let text = fs::read_to_string(&manifest_path).map_err(|e| io(&manifest_path, e))?;
    Manifest::parse(&text)
}

pub fn load_artifact(path: &Path) -> Result<Artifact> {
    let (_, store) = locate_artifact(path);
    let manifest = read_manifest(path)?;
    let document = serde_json::from_slice(&store.get(&manifest.hash)?)?;
    Ok(Artifact {
        manifest,
        document,
        store,
    })
}

#[derive(Clone, Debug)]
pub struct VerificationReport {
    /// The verified result's hash.
    pub hash: ObjectId,
    pub object_count: usize,
    /// Stored (compressed) bytes of all checked objects.
    pub byte_count: u64,
}

/// Validate a result directory and check every object it references against its digest.
pub fn verify_artifact(path: &Path) -> Result<VerificationReport> {
    let artifact = load_artifact(path)?;
    validate(&artifact.manifest, &artifact.document)?;
    let mut report = VerificationReport {
        hash: artifact.manifest.hash.clone(),
        object_count: 1,
        byte_count: artifact.store.read(&artifact.manifest.hash)?.len() as u64,
    };
    let references: BTreeSet<_> = array_refs(&artifact.document).0.into_iter().collect();
    let mut objects = BTreeSet::new();
    for reference in references {
        let stored = artifact.store.get_array_stored(&reference)?;
        if objects.insert(reference.object) {
            report.byte_count += stored.len() as u64;
            report.object_count += 1;
        }
    }
    Ok(report)
}

pub(crate) fn validate(manifest: &Manifest, document: &Document) -> Result<()> {
    let mut issues = validate_document(document);
    if manifest.format != "bfplot" {
        issues.insert(
            0,
            format!("format: expected \"bfplot\", got {:?}", manifest.format),
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
    fn arrays_are_named_by_their_decoded_bytes() {
        let dir = tempdir().unwrap();
        let store = ObjectStore::new(dir.path());
        let raw: Vec<u8> = (0..64u64).flat_map(|n| (n as f64).to_le_bytes()).collect();
        let reference = store.put_array(&raw, "f8", &[8, 8]).unwrap();
        assert_eq!(reference.object, ObjectId::of(&raw));
        assert_ne!(fs::read(store.path(&reference.object)).unwrap(), raw);
        assert_eq!(store.get_array(&reference).unwrap(), raw);

        // The digest does not depend on the codec: the same bytes stored plainly match.
        let plain = ArrayRef {
            codec: "none".into(),
            ..reference.clone()
        };
        assert_eq!(decode_array(&plain, &raw).unwrap(), raw);

        let mut shape = reference.clone();
        shape.shape = vec![4, 8];
        let error = store.get_array(&shape).unwrap_err().to_string();
        assert!(error.contains("expected 256 bytes"), "{error}");
        let mut other = raw.clone();
        other[0] ^= 1;
        let error = decode_array(&plain, &other).unwrap_err();
        assert!(matches!(error, Error::DigestMismatch { .. }));
        fs::write(store.path(&reference.object), b"not zstd").unwrap();
        assert!(matches!(
            store.get_array(&reference),
            Err(Error::Decode { .. })
        ));
        assert!(store.put_array(&raw, "f8", &[3]).is_err());
    }

    #[test]
    fn locates_directory_and_manifest_paths() {
        let result = Path::new("out/fit.bfplot");
        for path in [result.to_path_buf(), result.join("manifest.toml")] {
            let (manifest, store) = locate_artifact(&path);
            assert_eq!(manifest, result.join("manifest.toml"));
            assert_eq!(store.root(), result.join("objects/sha256"));
        }
    }
}
