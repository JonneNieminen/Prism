//! Helpers shared by adapters.

use std::borrow::Cow;

use ort::session::{Session, SessionInputValue};
use ort::value::TensorRef;
use serde::de::DeserializeOwned;

use crate::manifest::ModelManifest;
use crate::{PrismError, Result};

pub fn params<T: DeserializeOwned>(m: &ModelManifest) -> Result<T> {
    let v = if m.params.is_null() { serde_json::json!({}) } else { m.params.clone() };
    serde_json::from_value(v).map_err(|e| PrismError::InvalidModel(format!("“params” for {}: {e}", m.architecture)))
}

/// Run a session on named f32 inputs and return each output as (shape, data).
pub fn run_f32(sess: &mut Session, inputs: &[(&str, &[i64], &[f32])]) -> Result<Vec<(Vec<i64>, Vec<f32>)>> {
    let mut vals: Vec<(Cow<'_, str>, SessionInputValue<'_>)> = Vec::with_capacity(inputs.len());
    for (name, shape, data) in inputs {
        let t = TensorRef::from_array_view((shape.to_vec(), *data))?;
        vals.push((Cow::Owned(name.to_string()), t.into()));
    }
    let names: Vec<String> = sess.outputs().iter().map(|o| o.name().to_string()).collect();
    let outs = sess.run(vals)?;
    let mut res = Vec::with_capacity(names.len());
    for n in &names {
        let (shape, data) = outs[n.as_str()].try_extract_tensor::<f32>()?;
        crate::runtime::ensure_finite(data)?;
        res.push((shape.iter().copied().collect(), data.to_vec()));
    }
    Ok(res)
}

pub fn input_names(sess: &Session) -> Vec<String> {
    sess.inputs().iter().map(|i| i.name().to_string()).collect()
}
