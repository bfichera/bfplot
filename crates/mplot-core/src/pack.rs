use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    io::{Cursor, Read},
    path::Path,
};

use crate::{
    Error, Manifest, ObjectId, ObjectStore, Result, VerificationReport, error::io,
    format::referenced_objects, load_artifact, store::verify_bytes, verify_artifact,
};

const MAGIC: &[u8; 8] = b"MPLOT\0\x09\x09";
type PackedObjects = BTreeMap<ObjectId, Vec<u8>>;

#[derive(Clone, Copy, Debug)]
pub struct PackLimits {
    pub max_manifest_bytes: u64,
    pub max_objects: u64,
    pub max_object_bytes: u64,
    pub max_total_bytes: u64,
}
impl Default for PackLimits {
    fn default() -> Self {
        Self {
            max_manifest_bytes: 4 << 20,
            max_objects: 100_000,
            max_object_bytes: 1 << 30,
            max_total_bytes: 8 << 30,
        }
    }
}

pub fn pack_artifact(manifest_path: &Path, output: &Path) -> Result<VerificationReport> {
    let verified = verify_artifact(manifest_path)?;
    let artifact = load_artifact(manifest_path)?;
    let manifest = fs::read(manifest_path).map_err(|error| io(manifest_path, error))?;
    let ids: BTreeSet<_> = std::iter::once(artifact.manifest.document.clone())
        .chain(referenced_objects(&artifact.document))
        .collect();
    let mut packed = Vec::new();
    packed.extend_from_slice(MAGIC);
    write_u64(&mut packed, manifest.len() as u64);
    packed.extend_from_slice(&manifest);
    write_u64(&mut packed, ids.len() as u64);
    for id in ids {
        let bytes = artifact.store.get(&id)?;
        packed.extend_from_slice(id.as_bytes());
        write_u64(&mut packed, bytes.len() as u64);
        packed.extend_from_slice(&bytes);
    }
    fs::write(output, packed).map_err(|e| io(output, e))?;
    Ok(verified)
}

pub fn unpack_artifact(
    packed_path: &Path,
    manifest_path: &Path,
    limits: PackLimits,
) -> Result<VerificationReport> {
    let (manifest_bytes, objects) = read_pack(packed_path, limits)?;
    let manifest: Manifest = toml::from_str(
        std::str::from_utf8(&manifest_bytes)
            .map_err(|_| Error::InvalidPack("manifest is not UTF-8".into()))?,
    )?;
    let store = ObjectStore::for_manifest(manifest_path);
    for (id, bytes) in objects {
        let written = store.put(&bytes)?;
        if written != id {
            return Err(Error::DigestMismatch {
                expected: id.to_string(),
                actual: written.digest(),
            });
        }
    }
    if !store.path(&manifest.document).exists() {
        return Err(Error::InvalidPack("document object is absent".into()));
    }
    if let Some(parent) = manifest_path.parent() {
        fs::create_dir_all(parent).map_err(|e| io(parent, e))?;
    }
    fs::write(manifest_path, manifest_bytes).map_err(|e| io(manifest_path, e))?;
    match verify_artifact(manifest_path) {
        Ok(report) => Ok(report),
        Err(error) => {
            let _ = fs::remove_file(manifest_path);
            Err(error)
        }
    }
}

pub fn verify_packed(path: &Path, limits: PackLimits) -> Result<VerificationReport> {
    let (manifest_bytes, objects) = read_pack(path, limits)?;
    let manifest: Manifest = toml::from_str(
        std::str::from_utf8(&manifest_bytes)
            .map_err(|_| Error::InvalidPack("manifest is not UTF-8".into()))?,
    )?;
    let document_bytes = objects
        .get(&manifest.document)
        .ok_or_else(|| Error::InvalidPack("document object is absent".into()))?;
    let document = serde_json::from_slice(document_bytes)?;
    let manifest_issues = manifest.validate();
    if !manifest_issues.is_empty() {
        return Err(Error::Validation(
            manifest_issues
                .iter()
                .map(ToString::to_string)
                .collect::<Vec<_>>()
                .join("; "),
        ));
    }
    let mut required: BTreeSet<_> = std::iter::once(manifest.document)
        .chain(referenced_objects(&document))
        .collect();
    for id in objects.keys() {
        required.remove(id);
    }
    if !required.is_empty() {
        return Err(Error::InvalidPack(format!(
            "missing {} referenced object(s)",
            required.len()
        )));
    }
    let issues = crate::validate_document(&document);
    if !issues.is_empty() {
        return Err(Error::Validation(
            issues
                .iter()
                .map(ToString::to_string)
                .collect::<Vec<_>>()
                .join("; "),
        ));
    }
    Ok(VerificationReport {
        object_count: objects.len(),
        byte_count: objects.values().map(|b| b.len() as u64).sum(),
    })
}

fn read_pack(path: &Path, limits: PackLimits) -> Result<(Vec<u8>, PackedObjects)> {
    let file = fs::read(path).map_err(|e| io(path, e))?;
    if file.len() as u64 > limits.max_total_bytes {
        return Err(Error::PackLimit("total packed bytes".into()));
    }
    let mut cursor = Cursor::new(file.as_slice());
    let mut magic = [0; 8];
    read_exact(&mut cursor, &mut magic)?;
    if &magic != MAGIC {
        return Err(Error::InvalidPack("bad magic".into()));
    }
    let manifest_len = read_u64(&mut cursor)?;
    if manifest_len > limits.max_manifest_bytes {
        return Err(Error::PackLimit("manifest bytes".into()));
    }
    let mut manifest = vec![0; usize_len(manifest_len)?];
    read_exact(&mut cursor, &mut manifest)?;
    let count = read_u64(&mut cursor)?;
    if count > limits.max_objects {
        return Err(Error::PackLimit("object count".into()));
    }
    let mut objects = BTreeMap::new();
    let mut total = manifest_len;
    for _ in 0..count {
        let mut digest = [0; 32];
        read_exact(&mut cursor, &mut digest)?;
        let id: ObjectId = format!("sha256:{}", hex::encode(digest)).parse()?;
        let length = read_u64(&mut cursor)?;
        if length > limits.max_object_bytes {
            return Err(Error::PackLimit("object bytes".into()));
        }
        total = total
            .checked_add(length)
            .ok_or_else(|| Error::PackLimit("total object bytes".into()))?;
        if total > limits.max_total_bytes {
            return Err(Error::PackLimit("total object bytes".into()));
        }
        let mut bytes = vec![0; usize_len(length)?];
        read_exact(&mut cursor, &mut bytes)?;
        verify_bytes(&id, &bytes)?;
        if objects.insert(id, bytes).is_some() {
            return Err(Error::InvalidPack("duplicate object".into()));
        }
    }
    if cursor.position() != file.len() as u64 {
        return Err(Error::InvalidPack("trailing data".into()));
    }
    Ok((manifest, objects))
}

fn write_u64(output: &mut Vec<u8>, value: u64) {
    output.extend_from_slice(&value.to_le_bytes());
}
fn read_u64(input: &mut Cursor<&[u8]>) -> Result<u64> {
    let mut bytes = [0; 8];
    read_exact(input, &mut bytes)?;
    Ok(u64::from_le_bytes(bytes))
}
fn read_exact(input: &mut Cursor<&[u8]>, bytes: &mut [u8]) -> Result<()> {
    input
        .read_exact(bytes)
        .map_err(|_| Error::InvalidPack("truncated data".into()))
}
fn usize_len(value: u64) -> Result<usize> {
    usize::try_from(value).map_err(|_| Error::PackLimit("length does not fit this platform".into()))
}

#[cfg(test)]
mod tests {
    use crate::{Document, Manifest, ObjectStore};
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn deterministic_pack_round_trip() {
        let dir = tempdir().unwrap();
        let source = dir.path().join("source.mplot.toml");
        let store = ObjectStore::for_manifest(&source);
        let document = Document::default();
        let id = store.put_json(&document).unwrap();
        fs::write(&source, toml::to_string(&Manifest::new(id)).unwrap()).unwrap();
        let one = dir.path().join("one.mplot");
        let two = dir.path().join("two.mplot");
        super::pack_artifact(&source, &one).unwrap();
        super::pack_artifact(&source, &two).unwrap();
        assert_eq!(fs::read(&one).unwrap(), fs::read(&two).unwrap());
        let destination = dir.path().join("out/result.mplot.toml");
        super::unpack_artifact(&one, &destination, super::PackLimits::default()).unwrap();
        assert_eq!(
            crate::verify_artifact(&destination).unwrap().object_count,
            1
        );
    }
}
