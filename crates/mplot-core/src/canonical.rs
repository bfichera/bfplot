use serde::Serialize;
use serde_json::{Map, Value};

use crate::Result;

/// Serialize a value as compact JSON with recursively sorted object keys.
pub fn canonical_json<T: Serialize>(value: &T) -> Result<String> {
    let bytes = canonical_json_bytes(value)?;
    // serde_json always emits UTF-8.
    Ok(String::from_utf8(bytes).expect("serde_json emitted non-UTF-8"))
}

pub fn canonical_json_bytes<T: Serialize>(value: &T) -> Result<Vec<u8>> {
    let mut value = serde_json::to_value(value)?;
    sort_value(&mut value)?;
    Ok(serde_json::to_vec(&value)?)
}

fn sort_value(value: &mut Value) -> Result<()> {
    match value {
        Value::Object(object) => {
            let old = std::mem::take(object);
            let mut pairs: Vec<_> = old.into_iter().collect();
            pairs.sort_unstable_by(|a, b| a.0.cmp(&b.0));
            let mut sorted = Map::new();
            for (key, mut child) in pairs {
                sort_value(&mut child)?;
                sorted.insert(key, child);
            }
            *object = sorted;
        }
        Value::Array(values) => {
            for child in values {
                sort_value(child)?;
            }
        }
        // serde_json cannot represent non-finite JSON numbers. Serializing through
        // `to_value` above therefore enforces the format's finite-number rule.
        Value::Number(_) | Value::Null | Value::Bool(_) | Value::String(_) => {}
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    #[test]
    fn recursively_sorts_keys() {
        let value = json!({"z": {"b": 1, "a": 2}, "a": 3});
        assert_eq!(
            super::canonical_json(&value).unwrap(),
            r#"{"a":3,"z":{"a":2,"b":1}}"#
        );
    }
}
