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
    #[error("invalid JSON document: {0}")]
    Json(#[from] serde_json::Error),
    #[error("invalid object identifier: {0}")]
    InvalidObjectId(String),
    #[error("object {expected} has digest sha256:{actual}")]
    DigestMismatch { expected: String, actual: String },
    #[error("object not found: {0}")]
    ObjectNotFound(String),
    #[error("invalid result: {0}")]
    Validation(String),
    #[error("invalid packed file: {0}")]
    InvalidPack(String),
    #[error(
        "this result uses BFPlot format version {found}, but this bfplot only reads up to version {supported}; please update bfplot"
    )]
    UnsupportedVersion { found: u64, supported: u64 },
}

pub type Result<T> = std::result::Result<T, Error>;

pub(crate) fn io(path: impl Into<PathBuf>, source: std::io::Error) -> Error {
    Error::Io {
        path: path.into(),
        source,
    }
}
