use std::path::PathBuf;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("I/O error at {path}: {source}")]
    Io {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
    #[error("invalid TOML manifest: {0}")]
    Toml(#[from] toml::de::Error),
    #[error("cannot encode TOML manifest: {0}")]
    TomlEncode(#[from] toml::ser::Error),
    #[error("invalid JSON document: {0}")]
    Json(#[from] serde_json::Error),
    #[error("invalid object identifier: {0}")]
    InvalidObjectId(String),
    #[error("object {expected} has digest sha256:{actual}")]
    DigestMismatch { expected: String, actual: String },
    #[error("object not found: {0}")]
    ObjectNotFound(String),
    #[error("artifact validation failed: {0}")]
    Validation(String),
    #[error("invalid packed artifact: {0}")]
    InvalidPack(String),
    #[error("pack limit exceeded: {0}")]
    PackLimit(String),
    #[error("invalid stream: {0}")]
    InvalidStream(String),
}

pub type Result<T> = std::result::Result<T, Error>;

pub(crate) fn io(path: impl Into<PathBuf>, source: std::io::Error) -> Error {
    Error::Io {
        path: path.into(),
        source,
    }
}
