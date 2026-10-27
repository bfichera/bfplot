use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    io::{Cursor, Read},
    path::{Path, PathBuf},
};

use crate::{
    Error, Manifest, ObjectId, ObjectStore, Result, VerificationReport, error::io,
    format::referenced_objects, load_artifact, locate_artifact, store::verify_bytes,
    verify_artifact,
};

const MAGIC: &[u8; 8] = b"MPLOT\0\x09\x09";
const MANIFEST_PREFIX: &[u8] = b"format = \"mplot\"";
const GITIGNORE: &str = "/objects/\n";
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

pub fn pack_artifact(source: &Path, output: &Path) -> Result<VerificationReport> {
    let verified = verify_artifact(source)?;
    let artifact = load_artifact(source)?;
    let (manifest_path, _) = locate_artifact(source);
    let manifest = fs::read(&manifest_path).map_err(|error| io(&manifest_path, error))?;
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
    ensure_replaceable(output)?;
    let temporary = sibling(output, "tmp")?;
    let result = fs::write(&temporary, packed)
        .map_err(|e| io(&temporary, e))
        .and_then(|()| install(&temporary, output));
    if result.is_err() {
        remove_any(&temporary);
    }
    result.map(|()| verified)
}

/// Unpack a packed file into a result directory at `destination`.
///
/// An existing MPlot result at `destination` is replaced; anything else is left untouched.
pub fn unpack_artifact(
    packed_path: &Path,
    destination: &Path,
    limits: PackLimits,
) -> Result<VerificationReport> {
    let (manifest_bytes, objects) = read_pack(packed_path, limits)?;
    let manifest: Manifest = toml::from_str(
        std::str::from_utf8(&manifest_bytes)
            .map_err(|_| Error::InvalidPack("manifest is not UTF-8".into()))?,
    )?;
    if !objects.contains_key(&manifest.document) {
        return Err(Error::InvalidPack("document object is absent".into()));
    }
    ensure_replaceable(destination)?;
    let staging = sibling(destination, "partial")?;
    remove_any(&staging);
    let result = build_result(&staging, &manifest_bytes, objects)
        .and_then(|report| install(&staging, destination).map(|()| report));
    if result.is_err() {
        remove_any(&staging);
    }
    result
}

/// Read only the header and manifest bytes of a packed file.
pub fn read_packed_manifest(path: &Path, limits: PackLimits) -> Result<Vec<u8>> {
    let mut file = fs::File::open(path).map_err(|e| io(path, e))?;
    let mut header = [0; 16];
    file.read_exact(&mut header)
        .map_err(|_| Error::InvalidPack("truncated data".into()))?;
    if &header[..8] != MAGIC {
        return Err(Error::InvalidPack("bad magic".into()));
    }
    let manifest_len = u64::from_le_bytes(header[8..].try_into().expect("8-byte length"));
    if manifest_len > limits.max_manifest_bytes {
        return Err(Error::PackLimit("manifest bytes".into()));
    }
    let mut manifest = vec![0; usize_len(manifest_len)?];
    file.read_exact(&mut manifest)
        .map_err(|_| Error::InvalidPack("truncated data".into()))?;
    Ok(manifest)
}

fn build_result(
    staging: &Path,
    manifest: &[u8],
    objects: PackedObjects,
) -> Result<VerificationReport> {
    let store = ObjectStore::for_result_dir(staging);
    fs::create_dir_all(store.root()).map_err(|e| io(store.root(), e))?;
    for (id, bytes) in objects {
        let written = store.put(&bytes)?;
        if written != id {
            return Err(Error::DigestMismatch {
                expected: id.to_string(),
                actual: written.digest(),
            });
        }
    }
    let manifest_path = staging.join("manifest.toml");
    fs::write(&manifest_path, manifest).map_err(|e| io(&manifest_path, e))?;
    let gitignore = staging.join(".gitignore");
    fs::write(&gitignore, GITIGNORE).map_err(|e| io(&gitignore, e))?;
    verify_artifact(staging)
}

fn install(staging: &Path, destination: &Path) -> Result<()> {
    if fs::symlink_metadata(destination).is_err() {
        return fs::rename(staging, destination).map_err(|e| io(destination, e));
    }
    ensure_replaceable(destination)?;
    let old = sibling(destination, "old")?;
    remove_any(&old);
    fs::rename(destination, &old).map_err(|e| io(destination, e))?;
    if let Err(error) = fs::rename(staging, destination) {
        let _ = fs::rename(&old, destination);
        return Err(io(destination, error));
    }
    remove_any(&old);
    Ok(())
}

fn ensure_replaceable(destination: &Path) -> Result<()> {
    match fs::symlink_metadata(destination) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(io(destination, error)),
        Ok(_) if is_mplot_result(destination) => Ok(()),
        Ok(_) => Err(io(
            destination,
            std::io::Error::new(
                std::io::ErrorKind::AlreadyExists,
                "destination exists and is not an MPlot result",
            ),
        )),
    }
}

fn is_mplot_result(path: &Path) -> bool {
    let Ok(metadata) = fs::symlink_metadata(path) else {
        return false;
    };
    if metadata.is_dir() {
        let Ok(mut entries) = fs::read_dir(path) else {
            return false;
        };
        entries.next().is_none() || starts_with(&path.join("manifest.toml"), MANIFEST_PREFIX)
    } else {
        metadata.is_file() && (starts_with(path, MAGIC) || starts_with(path, MANIFEST_PREFIX))
    }
}

fn starts_with(path: &Path, prefix: &[u8]) -> bool {
    let mut bytes = vec![0; prefix.len()];
    fs::File::open(path)
        .and_then(|mut file| file.read_exact(&mut bytes))
        .is_ok_and(|()| bytes == prefix)
}

fn sibling(path: &Path, suffix: &str) -> Result<PathBuf> {
    let name = path
        .file_name()
        .ok_or_else(|| io(path, std::io::Error::other("path has no file name")))?;
    let parent = match path.parent() {
        Some(parent) if !parent.as_os_str().is_empty() => parent,
        _ => Path::new("."),
    };
    fs::create_dir_all(parent).map_err(|e| io(parent, e))?;
    Ok(parent.join(format!(
        ".{}.{}.{suffix}",
        name.to_string_lossy(),
        std::process::id()
    )))
}

fn remove_any(path: &Path) {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.is_dir() => {
            let _ = fs::remove_dir_all(path);
        }
        Ok(_) => {
            let _ = fs::remove_file(path);
        }
        Err(_) => {}
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
    use super::{PackLimits, pack_artifact, read_packed_manifest, unpack_artifact};
    use crate::{Document, Manifest, ObjectStore, verify_artifact};
    use std::{fs, path::Path};
    use tempfile::tempdir;

    fn write_result(dir: &Path) -> Vec<u8> {
        let store = ObjectStore::for_result_dir(dir);
        let id = store.put_json(&Document::default()).unwrap();
        let manifest = toml::to_string(&Manifest::new(id)).unwrap();
        fs::write(dir.join("manifest.toml"), &manifest).unwrap();
        fs::write(dir.join(".gitignore"), "/objects/\n").unwrap();
        manifest.into_bytes()
    }

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
        pack_artifact(&source, &one).unwrap();
        pack_artifact(&source, &two).unwrap();
        assert_eq!(fs::read(&one).unwrap(), fs::read(&two).unwrap());
        let destination = dir.path().join("out/result.mplot");
        unpack_artifact(&one, &destination, PackLimits::default()).unwrap();
        assert!(destination.is_dir());
        assert_eq!(
            fs::read_to_string(destination.join(".gitignore")).unwrap(),
            "/objects/\n"
        );
        assert_eq!(
            fs::read(destination.join("manifest.toml")).unwrap(),
            fs::read(&source).unwrap()
        );
        assert_eq!(verify_artifact(&destination).unwrap().object_count, 1);
        assert_eq!(
            read_packed_manifest(&one, PackLimits::default()).unwrap(),
            fs::read(&source).unwrap()
        );
    }

    #[test]
    fn directory_result_round_trip() {
        let dir = tempdir().unwrap();
        let source = dir.path().join("fit.mplot");
        fs::create_dir(&source).unwrap();
        let manifest = write_result(&source);
        let packed = dir.path().join("fit.packed");
        pack_artifact(&source, &packed).unwrap();
        let via_manifest = dir.path().join("via-manifest.packed");
        pack_artifact(&source.join("manifest.toml"), &via_manifest).unwrap();
        assert_eq!(fs::read(&packed).unwrap(), fs::read(&via_manifest).unwrap());
        let restored = dir.path().join("restored/fit.mplot");
        unpack_artifact(&packed, &restored, PackLimits::default()).unwrap();
        assert_eq!(fs::read(restored.join("manifest.toml")).unwrap(), manifest);
        assert_eq!(verify_artifact(&restored).unwrap().object_count, 1);
        assert_eq!(
            fs::read_dir(dir.path().join("restored")).unwrap().count(),
            1,
            "no staging leftovers"
        );
    }

    #[test]
    fn unpack_replaces_existing_result() {
        let dir = tempdir().unwrap();
        let source = dir.path().join("fit.mplot");
        fs::create_dir(&source).unwrap();
        write_result(&source);
        let packed = dir.path().join("fit.packed");
        pack_artifact(&source, &packed).unwrap();
        let destination = dir.path().join("restored.mplot");
        fs::create_dir(&destination).unwrap();
        fs::write(
            destination.join("manifest.toml"),
            "format = \"mplot\"\nstale = true\n",
        )
        .unwrap();
        fs::write(destination.join("stale.bin"), b"old").unwrap();
        unpack_artifact(&packed, &destination, PackLimits::default()).unwrap();
        assert!(!destination.join("stale.bin").exists());
        verify_artifact(&destination).unwrap();
        unpack_artifact(&packed, &destination, PackLimits::default()).unwrap();
        let packed_destination = dir.path().join("was-packed.mplot");
        fs::copy(&packed, &packed_destination).unwrap();
        unpack_artifact(&packed, &packed_destination, PackLimits::default()).unwrap();
        assert!(packed_destination.is_dir());
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 4);
    }

    #[test]
    fn unpack_refuses_to_replace_other_directories() {
        let dir = tempdir().unwrap();
        let source = dir.path().join("fit.mplot");
        fs::create_dir(&source).unwrap();
        write_result(&source);
        let packed = dir.path().join("fit.packed");
        pack_artifact(&source, &packed).unwrap();
        let destination = dir.path().join("notes");
        fs::create_dir(&destination).unwrap();
        fs::write(destination.join("notes.txt"), b"keep me").unwrap();
        assert!(unpack_artifact(&packed, &destination, PackLimits::default()).is_err());
        assert_eq!(fs::read(destination.join("notes.txt")).unwrap(), b"keep me");
        assert_eq!(fs::read_dir(&destination).unwrap().count(), 1);
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 3);
        let file = dir.path().join("notes.txt");
        fs::write(&file, b"plain").unwrap();
        assert!(unpack_artifact(&packed, &file, PackLimits::default()).is_err());
        assert_eq!(fs::read(&file).unwrap(), b"plain");
        assert!(pack_artifact(&source, &file).is_err());
        assert_eq!(fs::read(&file).unwrap(), b"plain");
        let repacked = dir.path().join("fit.mplot.packed");
        fs::create_dir(&repacked).unwrap();
        pack_artifact(&source, &repacked).unwrap();
        assert!(repacked.is_file());
    }
}
