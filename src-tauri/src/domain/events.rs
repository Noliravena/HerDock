use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunEvent {
    pub id: String,
    pub run_id: String,
    #[serde(rename = "type")]
    pub event_type: String,
    pub ts: String,
    pub seq: i64,
    #[serde(flatten)]
    pub payload: Map<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunEventPage {
    pub events: Vec<RunEvent>,
    pub has_more: bool,
}

impl RunEvent {
    pub fn new(
        run_id: impl Into<String>,
        seq: i64,
        event_type: impl Into<String>,
        payload: Value,
    ) -> Self {
        Self {
            id: format!("evt_{}", Uuid::new_v4().simple()),
            run_id: run_id.into(),
            event_type: event_type.into(),
            ts: Utc::now().to_rfc3339(),
            seq,
            payload: payload.as_object().cloned().unwrap_or_default(),
        }
    }
}
