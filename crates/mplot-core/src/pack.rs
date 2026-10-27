//! The packed single-file layout: magic, u64 manifest length, manifest, u64 object
//! count, then per object its 32-byte SHA-256 digest, u64 length and bytes. All
//! integers are little-endian.

use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    io::{Cursor, Read},
    path::{Path, PathBuf},
};

use crate::{
    Error, Manifest, ObjectId, ObjectStore, Result, VerificationReport,
    error::io,
    format::array_refs,
    load_artifact, locate_artifact,
    store::{validate, verify_bytes},
    verify_artifact,
};

const MAGIC: &[u8; 8] = b"MPLOT\0\x09\x09";
const MANIFEST_PREFIX: &[u8] = b"format = \"mplot\"";
type Objects = BTreeMap<ObjectId, Vec<u8>>;

/// Pack a result directory into one file at `output`.
pub fn pack_artifact(source: &Path, output: &Path) -> Result<VerificationReport> {
    let report = verify_artifact(source)?;
    let artifact = load_artifact(source)?;
    let (manifest_path, _) = locate_artifact(source);
    let manifest = fs::read(&manifest_path).map_err(|e| io(&manifest_path, e))?;
    let ids: BTreeSet<_> = std::iter::once(artifact.manifest.document.clone())
        .chain(array_refs(&artifact.document).0)
        .collect();
    let mut packed = MAGIC.to_vec();
    packed.extend((manifest.len() as u64).to_le_bytes());
    packed.extend(&manifest);
    packed.extend((ids.len() as u64).to_le_bytes());
    for id in ids {
        let bytes = artifact.store.get(&id)?;
        packed.extend(id.0);
        packed.extend((bytes.len() as u64).to_le_bytes());
        packed.extend(bytes);
    }
    ensure_replaceable(output)?;
    let staging = sibling(output, "partial")?;
    let result = fs::write(&staging, packed)
        .map_err(|e| io(&staging, e))
        .and_then(|()| install(&staging, output));
    if result.is_err() {
        remove_any(&staging);
    }
    result.map(|()| report)
}

/// Unpack a packed file into a result directory at `destination`.
///
/// An existing MPlot result at `destination` is replaced; anything else is left untouched.
pub fn unpack_artifact(packed: &Path, destination: &Path) -> Result<VerificationReport> {
    let (manifest, objects) = read_pack(packed)?;
    parse_manifest(&manifest)?;
    ensure_replaceable(destination)?;
    let staging = sibling(destination, "partial")?;
    remove_any(&staging);
    let result = write_directory(&staging, &manifest, objects)
        .and_then(|report| install(&staging, destination).map(|()| report));
    if result.is_err() {
        remove_any(&staging);
    }
    result
}

/// Validate a packed file and check that it contains every referenced object.
pub fn verify_packed(path: &Path) -> Result<VerificationReport> {
    let (manifest, objects) = read_pack(path)?;
    let manifest = parse_manifest(&manifest)?;
    let document = objects
        .get(&manifest.document)
        .ok_or_else(|| Error::InvalidPack("document object is absent".into()))?;
    let document = serde_json::from_slice(document)?;
    validate(&manifest, &document)?;
    let missing = array_refs(&document)
        .0
        .iter()
        .filter(|id| !objects.contains_key(id))
        .count();
    if missing > 0 {
        return Err(Error::InvalidPack(format!(
            "missing {missing} referenced object(s)"
        )));
    }
    Ok(VerificationReport {
        object_count: objects.len(),
        byte_count: objects.values().map(|b| b.len() as u64).sum(),
    })
}

/// Read only the manifest bytes of a packed file.
pub fn read_packed_manifest(path: &Path) -> Result<Vec<u8>> {
    let mut file = fs::File::open(path).map_err(|e| io(path, e))?;
    let mut header = [0; 16];
    file.read_exact(&mut header).map_err(|_| truncated())?;
    if &header[..8] != MAGIC {
        return Err(Error::InvalidPack("bad magic".into()));
    }
    let mut manifest = vec![0; length(&header[8..])?];
    file.read_exact(&mut manifest).map_err(|_| truncated())?;
    Ok(manifest)
}

fn parse_manifest(bytes: &[u8]) -> Result<Manifest> {
    let text = std::str::from_utf8(bytes)
        .map_err(|_| Error::InvalidPack("manifest is not UTF-8".into()))?;
    Ok(toml::from_str(text)?)
}

fn read_pack(path: &Path) -> Result<(Vec<u8>, Objects)> {
    let file = fs::read(path).map_err(|e| io(path, e))?;
    let mut cursor = Cursor::new(file.as_slice());
    if take(&mut cursor, 8)? != MAGIC {
        return Err(Error::InvalidPack("bad magic".into()));
    }
    let size = length(take(&mut cursor, 8)?)?;
    let manifest = take(&mut cursor, size)?.to_vec();
    let count = length(take(&mut cursor, 8)?)?;
    let mut objects = BTreeMap::new();
    for _ in 0..count {
        let id = ObjectId(take(&mut cursor, 32)?.try_into().expect("32 bytes"));
        let size = length(take(&mut cursor, 8)?)?;
        let bytes = take(&mut cursor, size)?.to_vec();
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

/// The next `n` bytes, without allocating for lengths beyond the end of the input.
fn take<'a>(cursor: &mut Cursor<&'a [u8]>, n: usize) -> Result<&'a [u8]> {
    let data = *cursor.get_ref();
    let start = cursor.position() as usize;
    let end = start.checked_add(n).filter(|&end| end <= data.len());
    let end = end.ok_or_else(truncated)?;
    cursor.set_position(end as u64);
    Ok(&data[start..end])
}

fn length(bytes: &[u8]) -> Result<usize> {
    let value = u64::from_le_bytes(bytes.try_into().expect("8-byte length"));
    usize::try_from(value).map_err(|_| Error::InvalidPack("length too large".into()))
}

fn truncated() -> Error {
    Error::InvalidPack("truncated data".into())
}

fn write_directory(dir: &Path, manifest: &[u8], objects: Objects) -> Result<VerificationReport> {
    let store = ObjectStore::for_result_dir(dir);
    for bytes in objects.values() {
        store.put(bytes)?;
    }
    for (name, bytes) in [("manifest.toml", manifest), (".gitignore", b"/objects/\n")] {
        let path = dir.join(name);
        fs::write(&path, bytes).map_err(|e| io(&path, e))?;
    }
    verify_artifact(dir)
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

/// Only nothing, an empty directory or an existing MPlot result may be replaced.
fn ensure_replaceable(destination: &Path) -> Result<()> {
    let metadata = match fs::symlink_metadata(destination) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(io(destination, error)),
        Ok(metadata) => metadata,
    };
    let replaceable = if metadata.is_dir() {
        fs::read_dir(destination).is_ok_and(|mut entries| entries.next().is_none())
            || starts_with(&destination.join("manifest.toml"), MANIFEST_PREFIX)
    } else {
        metadata.is_file() && starts_with(destination, MAGIC)
    };
    if replaceable {
        return Ok(());
    }
    Err(io(
        destination,
        std::io::Error::new(
            std::io::ErrorKind::AlreadyExists,
            "destination exists and is not an MPlot result",
        ),
    ))
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
    let name = name.to_string_lossy();
    Ok(parent.join(format!(".{name}.{}.{suffix}", std::process::id())))
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Document;
    use tempfile::tempdir;

    fn write_result(dir: &Path) -> Vec<u8> {
        let id = ObjectStore::for_result_dir(dir)
            .put_json(&Document::default())
            .unwrap();
        let manifest = toml::to_string(&Manifest::new(id)).unwrap();
        fs::write(dir.join("manifest.toml"), &manifest).unwrap();
        fs::write(dir.join(".gitignore"), "/objects/\n").unwrap();
        manifest.into_bytes()
    }

    #[test]
    fn pack_round_trip_is_deterministic() {
        let dir = tempdir().unwrap();
        let source = dir.path().join("fit.mplot");
        let manifest = write_result(&source);
        let packed = dir.path().join("fit.packed");
        pack_artifact(&source, &packed).unwrap();
        let via_manifest = dir.path().join("via-manifest.packed");
        pack_artifact(&source.join("manifest.toml"), &via_manifest).unwrap();
        assert_eq!(fs::read(&packed).unwrap(), fs::read(&via_manifest).unwrap());
        assert_eq!(read_packed_manifest(&packed).unwrap(), manifest);
        assert_eq!(verify_packed(&packed).unwrap().object_count, 1);

        let restored = dir.path().join("restored/fit.mplot");
        unpack_artifact(&packed, &restored).unwrap();
        assert_eq!(fs::read(restored.join("manifest.toml")).unwrap(), manifest);
        assert_eq!(
            fs::read_to_string(restored.join(".gitignore")).unwrap(),
            "/objects/\n"
        );
        assert_eq!(verify_artifact(&restored).unwrap().object_count, 1);
        assert_eq!(
            fs::read_dir(dir.path().join("restored")).unwrap().count(),
            1,
            "no staging leftovers"
        );
    }

    #[test]
    fn rejects_corrupt_packs() {
        let dir = tempdir().unwrap();
        let source = dir.path().join("fit.mplot");
        write_result(&source);
        let packed = dir.path().join("fit.packed");
        pack_artifact(&source, &packed).unwrap();
        let bytes = fs::read(&packed).unwrap();

        let mut flipped = bytes.clone();
        *flipped.last_mut().unwrap() ^= 1;
        fs::write(&packed, &flipped).unwrap();
        assert!(matches!(
            verify_packed(&packed),
            Err(Error::DigestMismatch { .. })
        ));
        fs::write(&packed, &bytes[..bytes.len() - 1]).unwrap();
        assert!(verify_packed(&packed).is_err());
        fs::write(&packed, [&bytes[..], b"x"].concat()).unwrap();
        assert!(verify_packed(&packed).is_err());
    }

    #[test]
    fn unpack_replaces_existing_results() {
        let dir = tempdir().unwrap();
        let source = dir.path().join("fit.mplot");
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
        unpack_artifact(&packed, &destination).unwrap();
        assert!(!destination.join("stale.bin").exists());
        unpack_artifact(&packed, &destination).unwrap();
        let was_packed = dir.path().join("was-packed.mplot");
        fs::copy(&packed, &was_packed).unwrap();
        unpack_artifact(&packed, &was_packed).unwrap();
        assert!(was_packed.is_dir());
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 4);
    }

    #[test]
    fn refuses_to_replace_other_files() {
        let dir = tempdir().unwrap();
        let source = dir.path().join("fit.mplot");
        write_result(&source);
        let packed = dir.path().join("fit.packed");
        pack_artifact(&source, &packed).unwrap();

        let notes = dir.path().join("notes");
        fs::create_dir(&notes).unwrap();
        fs::write(notes.join("notes.txt"), b"keep me").unwrap();
        assert!(unpack_artifact(&packed, &notes).is_err());
        assert_eq!(fs::read(notes.join("notes.txt")).unwrap(), b"keep me");

        let file = dir.path().join("notes.txt");
        fs::write(&file, b"plain").unwrap();
        assert!(unpack_artifact(&packed, &file).is_err());
        assert!(pack_artifact(&source, &file).is_err());
        assert_eq!(fs::read(&file).unwrap(), b"plain");
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 4);

        let empty = dir.path().join("empty.mplot");
        fs::create_dir(&empty).unwrap();
        pack_artifact(&source, &empty).unwrap();
        assert!(empty.is_file());
    }
}
