//! Read, verify and compare BFPlot results.
//!
//! A result is a directory: `manifest.toml` plus content-addressed `objects/`. The
//! manifest's `hash` identifies the whole result: two results have the same hash
//! exactly when their figures, timelines and arrays are identical.

mod compare;
mod error;
mod format;
mod store;

pub use compare::{Comparison, compare_artifacts, diff_values};
pub use error::{Error, Result};
pub use format::{
    ArrayRef, Artist, Axes, CODECS, Document, FORMAT_VERSION, Figure, Manifest, ObjectId, Timeline,
    TimelineFrame, TimelineUpdate, array_refs, validate_document,
};
pub use store::{
    Artifact, ObjectStore, VerificationReport, decode_array, load_artifact, locate_artifact,
    read_manifest, verify_artifact,
};
