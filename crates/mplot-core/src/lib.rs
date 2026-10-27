//! Read, validate, pack and unpack MPlot results.
//!
//! A result is a directory (`manifest.toml` plus content-addressed `objects/`) or a
//! single packed file holding the same manifest and objects.

mod error;
mod format;
mod pack;
mod store;

pub use error::{Error, Result};
pub use format::{
    ArrayRef, Artist, Axes, Document, Figure, Manifest, ObjectId, Timeline, TimelineFrame,
    TimelineUpdate, validate_document,
};
pub use pack::{pack_artifact, read_packed_manifest, unpack_artifact, verify_packed};
pub use store::{
    Artifact, ObjectStore, VerificationReport, load_artifact, locate_artifact, verify_artifact,
};
