//! Core format, storage, validation, packing, and streaming primitives for MPlot.

mod canonical;
mod error;
mod format;
mod pack;
mod store;
mod stream;

pub use canonical::{canonical_json, canonical_json_bytes};
pub use error::{Error, Result};
pub use format::{
    ArrayRef, Artist, Axes, Document, Figure, Manifest, ObjectId, PluginRequirement, Selection,
    ValidationIssue, validate_artifact, validate_document,
};
pub use pack::{PackLimits, pack_artifact, unpack_artifact, verify_packed};
pub use store::{Artifact, ObjectStore, VerificationReport, load_artifact, verify_artifact};
pub use stream::{StreamFrame, StreamReader, StreamWriter};
