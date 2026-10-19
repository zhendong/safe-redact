//! Runs the NER model with native ONNX Runtime.
//!
//! WebKit only exposes SharedArrayBuffer to pages served over HTTP(S), so in the
//! app the WebAssembly runtime is limited to one thread. The frontend keeps
//! tokenization and post-processing in transformers.js and only sends the model
//! inputs here, so results match the web version.

use std::sync::Mutex;

use ort::session::{builder::GraphOptimizationLevel, Session};
use ort::value::Tensor;
use serde::Deserialize;
use tauri::ipc::Response;
use tauri::{AppHandle, Manager, State};

const MODEL_PATH: &str = "/models/Xenova/bert-base-multilingual-cased-ner-hrl/onnx/model_quantized.onnx";

#[derive(Default)]
pub struct NerModel(Mutex<Option<Session>>);

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NerInput {
    /// [batch, sequence length]
    dims: [usize; 2],
    input_ids: Vec<i64>,
    attention_mask: Vec<i64>,
    token_type_ids: Option<Vec<i64>>,
}

/// The model ships with the frontend assets; read it from there instead of bundling a second copy.
fn model_bytes(app: &AppHandle) -> Result<Vec<u8>, String> {
    if let Some(asset) = app.asset_resolver().get(MODEL_PATH.into()) {
        return Ok(asset.bytes);
    }
    // `tauri dev` serves the frontend from Vite, so assets aren't embedded
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../desktop-assets").to_string() + MODEL_PATH;
    std::fs::read(&path).map_err(|e| format!("NER model not found at {path}: {e}"))
}

fn load_session(app: &AppHandle) -> Result<Session, String> {
    session_from_bytes(&model_bytes(app)?)
}

fn session_from_bytes(bytes: &[u8]) -> Result<Session, String> {
    let environment = ort::init()
        .with_name("SafeRedact")
        .with_telemetry(false)
        .build()
        .map_err(|e| e.to_string())?;
    Session::builder(&environment)
        .map_err(|e| e.to_string())?
        .with_optimization_level(GraphOptimizationLevel::Level3)
        .map_err(|e| e.to_string())?
        .commit_from_memory(bytes)
        .map_err(|e| e.to_string())
}

/// Loads the model once; later calls return immediately.
#[tauri::command]
pub async fn ner_load(app: AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<NerModel>();
        let mut session = state.0.lock().unwrap();
        if session.is_none() {
            let start = std::time::Instant::now();
            *session = Some(load_session(&app).inspect_err(|e| log::error!("NER model failed to load: {e}"))?);
            log::info!("NER model loaded in {} ms", start.elapsed().as_millis());
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Runs the model and returns the logits as little-endian f32 bytes, shaped [batch, sequence, labels].
#[tauri::command]
pub async fn ner_run(app: AppHandle, input: NerInput) -> Result<Response, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state: State<NerModel> = app.state();
        let mut guard = state.0.lock().unwrap();
        let session = guard.as_mut().ok_or("NER model is not loaded")?;
        let dims = input.dims;
        run(session, input).map_err(|e| {
            log::error!("NER inference failed (batch={} sequence={}): {e}", dims[0], dims[1]);
            e.to_string()
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

fn run(session: &mut Session, input: NerInput) -> ort::Result<Response> {
    let logits = infer(session, input)?;
    Ok(Response::new(logits.iter().flat_map(|v| v.to_le_bytes()).collect::<Vec<u8>>()))
}

fn infer(session: &mut Session, input: NerInput) -> ort::Result<Vec<f32>> {
    let shape = input.dims.map(|d| d as i64);
    let mut inputs = vec![
        ("input_ids", Tensor::from_array((shape, input.input_ids))?.into_dyn()),
        ("attention_mask", Tensor::from_array((shape, input.attention_mask))?.into_dyn()),
    ];
    // Only pass token_type_ids if this model takes them
    if let Some(token_type_ids) = input.token_type_ids {
        if session.inputs().iter().any(|i| i.name() == "token_type_ids") {
            inputs.push(("token_type_ids", Tensor::from_array((shape, token_type_ids))?.into_dyn()));
        }
    }
    let outputs = session.run(inputs)?;
    let (_, logits) = outputs["logits"].try_extract_tensor::<f32>()?;
    Ok(logits.to_vec())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Checks the linked ONNX Runtime can run the model. Needs the model in
    /// desktop-assets/ (`npm run desktop:assets`).
    #[test]
    fn runs_model() {
        let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../desktop-assets").to_string() + MODEL_PATH;
        let mut session = session_from_bytes(&std::fs::read(&path).unwrap()).unwrap();
        // [CLS] Hello [SEP]
        let input = NerInput {
            dims: [1, 3],
            input_ids: vec![101, 31178, 102],
            attention_mask: vec![1, 1, 1],
            token_type_ids: Some(vec![0, 0, 0]),
        };
        let logits = infer(&mut session, input).unwrap();
        // 3 tokens x 9 labels
        assert_eq!(logits.len(), 3 * 9);
        assert!(logits.iter().all(|v| v.is_finite()));
    }
}
