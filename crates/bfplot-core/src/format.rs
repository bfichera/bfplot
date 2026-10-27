use std::{
    collections::{BTreeMap, HashSet},
    fmt,
    str::FromStr,
};

use serde::{Deserialize, Deserializer, Serialize, Serializer};
use serde_json::Value;

use crate::{Error, Result};

/// SHA-256 identity of an object, written as `sha256:<hex>`.
#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct ObjectId(pub(crate) [u8; 32]);

impl ObjectId {
    /// The identity of `bytes`.
    pub fn of(bytes: &[u8]) -> Self {
        use sha2::{Digest, Sha256};
        Self(Sha256::digest(bytes).into())
    }

    pub fn digest(&self) -> String {
        hex::encode(self.0)
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
        let mut digest = [0; 32];
        value
            .strip_prefix("sha256:")
            .filter(|hex| hex.len() == 64)
            .and_then(|hex| hex::decode_to_slice(hex, &mut digest).ok())
            .ok_or_else(|| Error::InvalidObjectId(value.into()))?;
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

/// The newest format version this library reads and the one it writes.
///
/// Raise it whenever a change would make an older `bfplot` misread a result.
pub const FORMAT_VERSION: u64 = 1;

/// `manifest.toml`: the only part of a result that is meant to be committed.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Manifest {
    pub format: String,
    pub version: u64,
    pub document: ObjectId,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub provenance: BTreeMap<String, Value>,
}

impl Manifest {
    pub fn new(document: ObjectId) -> Self {
        Self {
            format: "bfplot".into(),
            version: FORMAT_VERSION,
            document,
            provenance: BTreeMap::new(),
        }
    }

    /// Parse `manifest.toml`, checking `format` and `version` before anything else, so a
    /// result from a newer writer reports that `bfplot` is out of date instead of an
    /// unknown field.
    pub fn parse(text: &str) -> Result<Self> {
        let table: toml::Table = toml::from_str(text)?;
        match table.get("format").and_then(toml::Value::as_str) {
            Some("bfplot") => {}
            Some(other) => {
                return Err(Error::Validation(format!(
                    "format: expected \"bfplot\", got {other:?}"
                )));
            }
            None => {
                return Err(Error::Validation(
                    "format: missing; not a BFPlot result".into(),
                ));
            }
        }
        let version = match table.get("version") {
            Some(toml::Value::Integer(version)) if *version >= 1 => *version as u64,
            Some(other) => {
                return Err(Error::Validation(format!(
                    "version: expected a positive integer, got {other}"
                )));
            }
            None => return Err(Error::Validation("version: missing".into())),
        };
        if version > FORMAT_VERSION {
            return Err(Error::UnsupportedVersion {
                found: version,
                supported: FORMAT_VERSION,
            });
        }
        Ok(toml::Value::Table(table).try_into()?)
    }
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Document {
    pub figures: Vec<Figure>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timeline: Option<Timeline>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Figure {
    pub id: String,
    #[serde(default)]
    pub axes: Vec<Axes>,
    /// Remaining fields such as `name`, `size_inches` and `dpi`.
    #[serde(flatten)]
    pub metadata: BTreeMap<String, Value>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Axes {
    pub id: String,
    #[serde(default)]
    pub artists: Vec<Artist>,
    /// Remaining fields such as `projection`, `bounds`, `x`, `y` and `z`.
    #[serde(flatten)]
    pub metadata: BTreeMap<String, Value>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Artist {
    #[serde(rename = "type")]
    pub artist_type: String,
    pub id: String,
    pub axes_id: String,
    #[serde(default)]
    pub props: BTreeMap<String, Value>,
    #[serde(default)]
    pub data: BTreeMap<String, Value>,
}

/// A numerical array stored as a separate object.
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
pub struct Timeline {
    pub fps: f64,
    pub duration: f64,
    #[serde(default = "default_true")]
    pub r#loop: bool,
    #[serde(default)]
    pub frames: Vec<TimelineFrame>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TimelineFrame {
    pub time: f64,
    #[serde(default)]
    pub updates: Vec<TimelineUpdate>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TimelineUpdate {
    pub target_kind: String,
    pub target: String,
    pub path: Vec<String>,
    pub value: Value,
}

const fn default_true() -> bool {
    true
}

const ARTIST_TYPES: &[&str] = &[
    "bfplot.line",
    "bfplot.scatter",
    "bfplot.image",
    "bfplot.errorbar",
    "bfplot.fill_between",
    "bfplot.histogram",
    "bfplot.contour",
    "bfplot.contourf",
    "bfplot.text",
    "bfplot.patch",
    "bfplot.line3d",
    "bfplot.scatter3d",
    "bfplot.surface3d",
    "bfplot.mesh3d",
];

/// Fields a timeline update may replace, by target kind (mirrors `bfplot.mir.ANIMATABLE`).
fn animatable(kind: &str) -> Option<&'static [&'static str]> {
    match kind {
        "figure" => Some(&["title", "size_inches", "dpi", "facecolor"]),
        "axes" => Some(&["title", "x", "y", "z", "view", "bounds", "facecolor"]),
        "artist" => Some(&["data", "props"]),
        _ => None,
    }
}

/// Check IDs, names, artist types, timeline updates and array references.
pub fn validate_document(document: &Document) -> Vec<String> {
    let mut issues = Vec::new();
    let mut ids = HashSet::new();
    let mut targets: [(&str, HashSet<&str>); 3] = [
        ("figure", HashSet::new()),
        ("axes", HashSet::new()),
        ("artist", HashSet::new()),
    ];
    let mut names = HashSet::new();
    let mut unique = |id: &str, path: String, issues: &mut Vec<String>| {
        if id.is_empty() {
            issues.push(format!("{path}.id: must not be empty"));
        } else if !ids.insert(id.to_owned()) {
            issues.push(format!("{path}.id: duplicate id"));
        }
    };

    for (fi, figure) in document.figures.iter().enumerate() {
        let path = format!("figures[{fi}]");
        unique(&figure.id, path.clone(), &mut issues);
        targets[0].1.insert(&figure.id);
        match figure.metadata.get("name") {
            None => {}
            Some(Value::String(name)) if name.is_empty() => {
                issues.push(format!("{path}.name: must not be empty"));
            }
            Some(Value::String(name)) if !names.insert(name) => {
                issues.push(format!("{path}.name: duplicate figure name"));
            }
            Some(Value::String(_)) => {}
            Some(_) => issues.push(format!("{path}.name: must be a string")),
        }
        for (ai, axes) in figure.axes.iter().enumerate() {
            let path = format!("{path}.axes[{ai}]");
            unique(&axes.id, path.clone(), &mut issues);
            targets[1].1.insert(&axes.id);
            for (ri, artist) in axes.artists.iter().enumerate() {
                let path = format!("{path}.artists[{ri}]");
                unique(&artist.id, path.clone(), &mut issues);
                targets[2].1.insert(&artist.id);
                if artist.axes_id != axes.id {
                    issues.push(format!("{path}.axes_id: does not match containing axes"));
                }
                if !ARTIST_TYPES.contains(&artist.artist_type.as_str()) {
                    issues.push(format!(
                        "{path}.type: unknown artist type {:?}",
                        artist.artist_type
                    ));
                }
            }
        }
    }

    if let Some(timeline) = &document.timeline {
        if !timeline.fps.is_finite() || timeline.fps <= 0.0 {
            issues.push("timeline.fps: must be positive and finite".into());
        }
        let mut last = 0.0;
        for (i, frame) in timeline.frames.iter().enumerate() {
            let path = format!("timeline.frames[{i}]");
            if !frame.time.is_finite() || frame.time <= last {
                issues.push(format!(
                    "{path}.time: must be finite and strictly increasing"
                ));
            }
            last = frame.time;
            for (u, update) in frame.updates.iter().enumerate() {
                let path = format!("{path}.updates[{u}]");
                let kind = update.target_kind.as_str();
                let Some(fields) = animatable(kind) else {
                    issues.push(format!("{path}.target_kind: unsupported {kind:?}"));
                    continue;
                };
                let known = targets.iter().find(|(name, _)| *name == kind);
                if !known.is_some_and(|(_, ids)| ids.contains(update.target.as_str())) {
                    issues.push(format!("{path}.target: no {kind} {:?}", update.target));
                }
                let field = update.path.first().map(String::as_str).unwrap_or_default();
                if !fields.contains(&field) || update.path.iter().any(String::is_empty) {
                    issues.push(format!("{path}.path: cannot update {:?}", update.path));
                }
            }
        }
        if timeline.duration != last {
            issues.push("timeline.duration: must equal the final frame time (or 0)".into());
        }
    }

    issues.extend(array_refs(document).1);
    issues
}

/// Every array object a document references, and any malformed references.
pub(crate) fn array_refs(document: &Document) -> (Vec<ObjectId>, Vec<String>) {
    fn walk(value: &Value, path: String, ids: &mut Vec<ObjectId>, issues: &mut Vec<String>) {
        match value {
            Value::Object(map) if map.contains_key("object") => {
                match serde_json::from_value::<ArrayRef>(value.clone()) {
                    Ok(reference) => ids.push(reference.object),
                    Err(error) => issues.push(format!("{path}: invalid array reference: {error}")),
                }
            }
            Value::Object(map) => {
                for (key, child) in map {
                    walk(child, format!("{path}.{key}"), ids, issues);
                }
            }
            Value::Array(values) => {
                for (i, child) in values.iter().enumerate() {
                    walk(child, format!("{path}[{i}]"), ids, issues);
                }
            }
            _ => {}
        }
    }

    let (mut ids, mut issues) = (Vec::new(), Vec::new());
    for (fi, figure) in document.figures.iter().enumerate() {
        for (ai, axes) in figure.axes.iter().enumerate() {
            for (ri, artist) in axes.artists.iter().enumerate() {
                for (name, value) in &artist.data {
                    let path = format!("figures[{fi}].axes[{ai}].artists[{ri}].data.{name}");
                    walk(value, path, &mut ids, &mut issues);
                }
            }
        }
    }
    for (i, frame) in document
        .timeline
        .iter()
        .flat_map(|t| t.frames.iter())
        .enumerate()
    {
        for (u, update) in frame.updates.iter().enumerate() {
            let path = format!("timeline.frames[{i}].updates[{u}].value");
            walk(&update.value, path, &mut ids, &mut issues);
        }
    }
    (ids, issues)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn document(name: Value, artist_axes: &str, x: Value) -> Document {
        serde_json::from_value(json!({
            "figures": [{"id": "figure", "name": name, "axes": [{"id": "axes", "artists": [
                {"type": "bfplot.line", "id": "line", "axes_id": artist_axes, "data": {"x": x}}
            ]}]}]
        }))
        .unwrap()
    }

    #[test]
    fn manifest_parse_checks_format_and_version_first() {
        let document = ObjectId::of(b"document");
        let current = toml::to_string(&Manifest::new(document.clone())).unwrap();
        assert!(current.starts_with("format = \"bfplot\"\nversion = 1\n"));
        let manifest = Manifest::parse(&current).unwrap();
        assert_eq!(
            (manifest.version, manifest.document),
            (FORMAT_VERSION, document)
        );

        // A newer writer may add fields this version does not know: report the version.
        let newer = format!(
            "format = \"bfplot\"\nversion = {}\ndocument = 1\nfuture = true\n",
            FORMAT_VERSION + 1
        );
        let error = Manifest::parse(&newer).unwrap_err();
        assert!(
            matches!(error, Error::UnsupportedVersion { found, supported }
            if found == FORMAT_VERSION + 1 && supported == FORMAT_VERSION)
        );
        assert!(error.to_string().contains("please update bfplot"));

        for (text, message) in [
            ("format = \"other\"\nversion = 1\n", "expected \"bfplot\""),
            ("version = 1\n", "format: missing"),
            ("format = \"bfplot\"\n", "version: missing"),
            ("format = \"bfplot\"\nversion = 0\n", "positive integer"),
            ("format = \"bfplot\"\nversion = \"1\"\n", "positive integer"),
        ] {
            let error = Manifest::parse(text).unwrap_err().to_string();
            assert!(error.contains(message), "{text:?}: {error}");
        }
    }

    #[test]
    fn validates_ids_types_and_array_references() {
        let reference = json!({"object": format!("{}", ObjectId::of(b"x")), "dtype": "f8", "shape": [2], "codec": "zstd"});
        let valid = document(json!("spectrum"), "axes", reference.clone());
        assert!(validate_document(&valid).is_empty());
        assert_eq!(array_refs(&valid).0, vec![ObjectId::of(b"x")]);

        let invalid = document(json!(""), "wrong", json!({"object": "nope"}));
        let issues = validate_document(&invalid).join("\n");
        assert!(issues.contains("figures[0].name: must not be empty"));
        assert!(issues.contains("axes_id: does not match containing axes"));
        assert!(issues.contains("data.x: invalid array reference"));

        let mut custom = valid.clone();
        custom.figures[0].axes[0].artists[0].artist_type = "org.example.line".into();
        assert!(validate_document(&custom)[0].contains("unknown artist type"));

        let mut duplicate = valid.clone();
        duplicate.figures.push(duplicate.figures[0].clone());
        duplicate.figures[1].id = "other".into();
        let issues = validate_document(&duplicate).join("\n");
        assert!(issues.contains("figures[1].name: duplicate figure name"));
        assert!(issues.contains("figures[1].axes[0].id: duplicate id"));
    }

    #[test]
    fn validates_timeline_updates() {
        let mut document = document(json!("wave"), "axes", json!([]));
        let update = |kind: &str, target: &str, path: &str| TimelineUpdate {
            target_kind: kind.into(),
            target: target.into(),
            path: vec![path.into()],
            value: json!(null),
        };
        document.timeline = Some(Timeline {
            fps: 30.0,
            duration: 0.5,
            r#loop: true,
            frames: vec![TimelineFrame {
                time: 0.5,
                updates: vec![
                    update("artist", "line", "data"),
                    update("axes", "axes", "x"),
                ],
            }],
        });
        assert!(validate_document(&document).is_empty());

        let frame = &mut document.timeline.as_mut().unwrap().frames[0];
        frame.updates = vec![
            update("axes", "line", "x"),
            update("figure", "figure", "axes"),
            update("selection", "x", "x"),
        ];
        let issues = validate_document(&document).join("\n");
        assert!(issues.contains("updates[0].target: no axes \"line\""));
        assert!(issues.contains("updates[1].path: cannot update"));
        assert!(issues.contains("updates[2].target_kind: unsupported"));
    }
}
