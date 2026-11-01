use std::path::Path;

use serde_json::Value;

use crate::{ObjectId, Result, load_artifact};

/// The outcome of comparing two results.
#[derive(Clone, Debug)]
pub struct Comparison {
    pub first: ObjectId,
    pub second: ObjectId,
    /// Where the documents differ, as `path: first -> second`; empty when identical.
    pub differences: Vec<String>,
}

impl Comparison {
    /// Whether the results are identical (their hashes are equal).
    pub fn same(&self) -> bool {
        self.first == self.second
    }
}

/// Compare two results by hash and, if they differ, list where their documents differ.
///
/// Arrays are compared by digest, so no array data is read.
pub fn compare_artifacts(first: &Path, second: &Path) -> Result<Comparison> {
    let (a, b) = (load_artifact(first)?, load_artifact(second)?);
    let mut differences = Vec::new();
    if a.manifest.hash != b.manifest.hash {
        let a_value: Value = serde_json::from_slice(&a.store.get(&a.manifest.hash)?)?;
        let b_value: Value = serde_json::from_slice(&b.store.get(&b.manifest.hash)?)?;
        diff_values(&a_value, &b_value, "", &mut differences);
    }
    Ok(Comparison {
        first: a.manifest.hash,
        second: b.manifest.hash,
        differences,
    })
}

/// Append the paths at which `a` and `b` differ, as `path: a -> b`.
pub fn diff_values(a: &Value, b: &Value, path: &str, out: &mut Vec<String>) {
    let here = if path.is_empty() { "document" } else { path };
    match (a, b) {
        (Value::Object(x), Value::Object(y)) if !(is_array_ref(a) && is_array_ref(b)) => {
            for key in x.keys().chain(y.keys().filter(|key| !x.contains_key(*key))) {
                let child = format!("{path}{}{key}", if path.is_empty() { "" } else { "." });
                match (x.get(key), y.get(key)) {
                    (Some(left), Some(right)) => diff_values(left, right, &child, out),
                    (Some(left), None) => out.push(format!("{child}: {} -> (absent)", show(left))),
                    (None, Some(right)) => {
                        out.push(format!("{child}: (absent) -> {}", show(right)))
                    }
                    (None, None) => {}
                }
            }
        }
        (Value::Array(x), Value::Array(y)) => {
            for (index, (left, right)) in x.iter().zip(y).enumerate() {
                diff_values(left, right, &format!("{path}[{index}]"), out);
            }
            if x.len() != y.len() {
                out.push(format!("{here}: {} items -> {} items", x.len(), y.len()));
            }
        }
        _ if a != b => out.push(format!("{here}: {} -> {}", show(a), show(b))),
        _ => {}
    }
}

fn is_array_ref(value: &Value) -> bool {
    value.get("object").is_some_and(Value::is_string)
}

fn show(value: &Value) -> String {
    let text = match value {
        Value::Object(_) if is_array_ref(value) => {
            let object = value["object"].as_str().unwrap_or_default();
            let short = object.get(..19).unwrap_or(object);
            format!("array {} {} {short}…", value["dtype"], value["shape"])
        }
        Value::Object(map) => format!("{{{} fields}}", map.len()),
        Value::Array(items) => format!("[{} items]", items.len()),
        other => other.to_string(),
    };
    if text.chars().count() > 60 {
        format!("{}…", text.chars().take(59).collect::<String>())
    } else {
        text
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn lists_changed_added_and_removed_fields() {
        let reference = |digest: &str| json!({"object": format!("sha256:{digest}"), "dtype": "f8", "shape": [3], "codec": "zstd"});
        let a = json!({"figures": [{"id": "f", "title": "old", "x": reference("aa"), "gone": 1}]});
        let b = json!({"figures": [{"id": "f", "title": "new", "x": reference("bb"), "added": true}], "timeline": null});
        let mut out = Vec::new();
        diff_values(&a, &b, "", &mut out);
        assert_eq!(
            out,
            [
                "figures[0].gone: 1 -> (absent)",
                "figures[0].title: \"old\" -> \"new\"",
                "figures[0].x: array \"f8\" [3] sha256:aa… -> array \"f8\" [3] sha256:bb…",
                "figures[0].added: (absent) -> true",
                "timeline: (absent) -> null",
            ]
        );

        let mut out = Vec::new();
        diff_values(&json!([1, 2]), &json!([1, 3, 4]), "", &mut out);
        assert_eq!(out, ["[1]: 2 -> 3", "document: 2 items -> 3 items"]);
        out.clear();
        diff_values(&a, &a, "", &mut out);
        assert!(out.is_empty());
    }
}
