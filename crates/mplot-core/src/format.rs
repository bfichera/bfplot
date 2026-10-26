use std::{
    collections::{BTreeMap, HashSet},
    fmt,
    str::FromStr,
};

use serde::{Deserialize, Deserializer, Serialize, Serializer};
use serde_json::Value;

use crate::{Error, ObjectStore, Result};

#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct ObjectId([u8; 32]);

impl ObjectId {
    pub fn from_bytes(bytes: &[u8]) -> Self {
        use sha2::{Digest, Sha256};
        Self(Sha256::digest(bytes).into())
    }

    pub fn digest(&self) -> String {
        hex::encode(self.0)
    }
    pub fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }
}

impl fmt::Display for ObjectId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "sha256:{}", self.digest())
    }
}

impl FromStr for ObjectId {
    type Err = Error;

    fn from_str(value: &str) -> Result<Self> {
        let hex_value = value
            .strip_prefix("sha256:")
            .ok_or_else(|| Error::InvalidObjectId(value.into()))?;
        if hex_value.len() != 64 || !hex_value.bytes().all(|c| c.is_ascii_hexdigit()) {
            return Err(Error::InvalidObjectId(value.into()));
        }
        let mut digest = [0; 32];
        hex::decode_to_slice(hex_value, &mut digest)
            .map_err(|_| Error::InvalidObjectId(value.into()))?;
        Ok(Self(digest))
    }
}

impl Serialize for ObjectId {
    fn serialize<S: Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}
impl<'de> Deserialize<'de> for ObjectId {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> std::result::Result<Self, D::Error> {
        String::deserialize(deserializer)?
            .parse()
            .map_err(serde::de::Error::custom)
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Manifest {
    pub format: String,
    pub version: String,
    #[serde(default = "default_schema_version")]
    pub schema_version: u32,
    pub document: ObjectId,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub provenance: BTreeMap<String, Value>,
}

impl Manifest {
    pub fn new(document: ObjectId) -> Self {
        Self {
            format: "mplot".into(),
            version: "0.9.9".into(),
            schema_version: default_schema_version(),
            document,
            provenance: BTreeMap::new(),
        }
    }

    pub fn validate(&self) -> Vec<ValidationIssue> {
        let mut issues = Vec::new();
        if self.format != "mplot" {
            issues.push(ValidationIssue::new("manifest.format", "must be 'mplot'"));
        }
        if self.version != "0.9.9" {
            issues.push(ValidationIssue::new(
                "manifest.version",
                "unsupported version",
            ));
        }
        if self.schema_version != 1 {
            issues.push(ValidationIssue::new(
                "manifest.schema_version",
                "unsupported schema version",
            ));
        }
        issues
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Document {
    #[serde(default = "default_schema_version")]
    pub schema_version: u32,
    #[serde(default)]
    pub figures: Vec<Figure>,
    #[serde(default)]
    pub links: Vec<Value>,
    #[serde(default)]
    pub selections: Vec<Selection>,
    #[serde(default, flatten)]
    pub metadata: BTreeMap<String, Value>,
}

impl Default for Document {
    fn default() -> Self {
        Self {
            schema_version: default_schema_version(),
            figures: Vec::new(),
            links: Vec::new(),
            selections: Vec::new(),
            metadata: BTreeMap::new(),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Figure {
    pub id: String,
    #[serde(default)]
    pub props: BTreeMap<String, Value>,
    #[serde(default)]
    pub axes: Vec<Axes>,
    /// Direct figure metadata emitted by Python, such as size_inches and dpi.
    #[serde(default, flatten)]
    pub metadata: BTreeMap<String, Value>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Axes {
    pub id: String,
    #[serde(default)]
    pub props: BTreeMap<String, Value>,
    #[serde(default)]
    pub artists: Vec<Artist>,
    /// Direct axes metadata emitted by Python, such as projection, bounds, x, y and z.
    #[serde(default, flatten)]
    pub metadata: BTreeMap<String, Value>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Artist {
    #[serde(rename = "type")]
    pub artist_type: String,
    pub schema_version: u32,
    pub id: String,
    pub axes_id: String,
    #[serde(default)]
    pub props: BTreeMap<String, Value>,
    #[serde(default)]
    pub data: BTreeMap<String, Value>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ArrayRef {
    pub object: ObjectId,
    pub dtype: String,
    pub shape: Vec<u64>,
    pub codec: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Selection {
    pub id: String,
    #[serde(flatten)]
    pub value: BTreeMap<String, Value>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct ValidationIssue {
    pub path: String,
    pub message: String,
}
impl ValidationIssue {
    pub fn new(path: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            path: path.into(),
            message: message.into(),
        }
    }
}
impl fmt::Display for ValidationIssue {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.path, self.message)
    }
}

const fn default_schema_version() -> u32 {
    1
}

const BUILT_INS: &[&str] = &[
    "line",
    "scatter",
    "image",
    "errorbar",
    "fill_between",
    "histogram",
    "contour",
    "contourf",
    "text",
    "patch",
    "line3d",
    "scatter3d",
    "surface3d",
    "mesh3d",
];

pub fn validate_document(document: &Document) -> Vec<ValidationIssue> {
    let mut issues = Vec::new();
    if document.schema_version != 1 {
        issues.push(ValidationIssue::new(
            "schema_version",
            "unsupported schema version",
        ));
    }
    for key in ["plugin_requirements", "plugins"] {
        let unsupported = match document.metadata.get(key) {
            Some(Value::Null) | None => false,
            Some(Value::Array(values)) => !values.is_empty(),
            Some(Value::Object(values)) => !values.is_empty(),
            Some(_) => true,
        };
        if unsupported {
            issues.push(ValidationIssue::new(
                key,
                "third-party artist plugins are not supported",
            ));
        }
    }
    let mut ids = HashSet::new();
    for (fi, figure) in document.figures.iter().enumerate() {
        unique_id(
            &mut ids,
            &figure.id,
            format!("figures[{fi}].id"),
            &mut issues,
        );
        for (ai, axes) in figure.axes.iter().enumerate() {
            unique_id(
                &mut ids,
                &axes.id,
                format!("figures[{fi}].axes[{ai}].id"),
                &mut issues,
            );
            for (ri, artist) in axes.artists.iter().enumerate() {
                let path = format!("figures[{fi}].axes[{ai}].artists[{ri}]");
                unique_id(&mut ids, &artist.id, format!("{path}.id"), &mut issues);
                if artist.axes_id != axes.id {
                    issues.push(ValidationIssue::new(
                        format!("{path}.axes_id"),
                        "does not match containing axes",
                    ));
                }
                if artist.schema_version == 0 {
                    issues.push(ValidationIssue::new(
                        format!("{path}.schema_version"),
                        "must be positive",
                    ));
                }
                validate_artist_type(&artist.artist_type, &path, &mut issues);
                for (name, value) in &artist.data {
                    validate_refs(value, &format!("{path}.data.{name}"), &mut issues);
                }
            }
        }
    }
    for (i, selection) in document.selections.iter().enumerate() {
        unique_id(
            &mut ids,
            &selection.id,
            format!("selections[{i}].id"),
            &mut issues,
        );
    }
    issues
}

pub fn validate_artifact(
    manifest: &Manifest,
    document: &Document,
    store: &ObjectStore,
) -> Vec<ValidationIssue> {
    let mut issues = manifest.validate();
    issues.extend(validate_document(document));
    walk_document_refs(document, |object, path| match store.get(object) {
        Ok(_) => {}
        Err(error) => issues.push(ValidationIssue::new(path, error.to_string())),
    });
    issues
}

pub(crate) fn referenced_objects(document: &Document) -> Vec<ObjectId> {
    let mut result = Vec::new();
    walk_document_refs(document, |object, _| result.push(object.clone()));
    result.sort();
    result.dedup();
    result
}

fn walk_document_refs(document: &Document, mut f: impl FnMut(&ObjectId, String)) {
    for (fi, figure) in document.figures.iter().enumerate() {
        for (ai, axes) in figure.axes.iter().enumerate() {
            for (ri, artist) in axes.artists.iter().enumerate() {
                for (name, value) in &artist.data {
                    walk_refs(
                        value,
                        &format!("figures[{fi}].axes[{ai}].artists[{ri}].data.{name}"),
                        &mut f,
                    );
                }
            }
        }
    }
}

fn walk_refs(value: &Value, path: &str, f: &mut impl FnMut(&ObjectId, String)) {
    match value {
        Value::Object(map) => {
            if let Some(Value::String(id)) = map.get("object")
                && let Ok(id) = id.parse()
            {
                f(&id, path.into());
            }
            for (key, child) in map {
                walk_refs(child, &format!("{path}.{key}"), f);
            }
        }
        Value::Array(values) => {
            for (i, child) in values.iter().enumerate() {
                walk_refs(child, &format!("{path}[{i}]"), f);
            }
        }
        _ => {}
    }
}

fn validate_refs(value: &Value, path: &str, issues: &mut Vec<ValidationIssue>) {
    match value {
        Value::Object(map) if map.contains_key("object") => {
            if let Err(error) = serde_json::from_value::<ArrayRef>(value.clone()) {
                issues.push(ValidationIssue::new(
                    path,
                    format!("invalid array reference: {error}"),
                ));
            }
        }
        Value::Object(map) => {
            for (key, child) in map {
                validate_refs(child, &format!("{path}.{key}"), issues);
            }
        }
        Value::Array(values) => {
            for (i, child) in values.iter().enumerate() {
                validate_refs(child, &format!("{path}[{i}]"), issues);
            }
        }
        _ => {}
    }
}

fn unique_id(ids: &mut HashSet<String>, id: &str, path: String, issues: &mut Vec<ValidationIssue>) {
    if id.is_empty() {
        issues.push(ValidationIssue::new(path, "must not be empty"));
    } else if !ids.insert(id.into()) {
        issues.push(ValidationIssue::new(path, "duplicate id"));
    }
}

fn validate_artist_type(value: &str, path: &str, issues: &mut Vec<ValidationIssue>) {
    let Some(name) = value.strip_prefix("mplot.") else {
        issues.push(ValidationIssue::new(
            format!("{path}.type"),
            "custom artist types are not supported",
        ));
        return;
    };
    if !BUILT_INS.contains(&name) {
        issues.push(ValidationIssue::new(
            format!("{path}.type"),
            "unknown mplot built-in",
        ));
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use serde_json::json;

    use super::*;

    #[test]
    fn validates_artist_protocol_and_references() {
        let document = Document {
            figures: vec![Figure {
                id: "figure".into(),
                props: BTreeMap::new(),
                metadata: BTreeMap::new(),
                axes: vec![Axes {
                    id: "axes".into(),
                    props: BTreeMap::new(),
                    metadata: BTreeMap::new(),
                    artists: vec![Artist {
                        artist_type: "mplot.line".into(),
                        schema_version: 1,
                        id: "line".into(),
                        axes_id: "wrong".into(),
                        props: BTreeMap::new(),
                        data: BTreeMap::from([(
                            "x".into(),
                            json!({"object": "not-a-digest", "dtype": "f8", "shape": [2], "codec": "zstd"}),
                        )]),
                    }],
                }],
            }],
            ..Document::default()
        };

        let issues = validate_document(&document);
        assert!(issues.iter().any(|issue| issue.path.ends_with("axes_id")));
        assert!(
            issues
                .iter()
                .any(|issue| issue.message.contains("array reference"))
        );
    }

    #[test]
    fn rejects_custom_artist_types_and_plugin_requirements() {
        let mut issues = Vec::new();
        validate_artist_type("org.example.line", "artist", &mut issues);
        assert_eq!(issues.len(), 1);
        assert_eq!(issues[0].message, "custom artist types are not supported");

        let document = Document {
            metadata: BTreeMap::from([("plugin_requirements".into(), json!(["org.example"]))]),
            ..Document::default()
        };
        let issues = validate_document(&document);
        assert!(
            issues
                .iter()
                .any(|issue| issue.message.contains("plugins are not supported"))
        );
    }
}
