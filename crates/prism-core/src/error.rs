use serde::Serialize;
use ts_rs::TS;

pub type Result<T, E = PrismError> = std::result::Result<T, E>;

/// Every error carries a user-facing message; `kind` lets the UI pick an icon/action.
#[derive(Debug, thiserror::Error)]
pub enum PrismError {
    #[error("{0}")]
    UnsupportedFile(String),
    #[error("{0}")]
    CorruptFile(String),
    #[error("{0}")]
    InvalidModel(String),
    #[error("{0}")]
    ModelMissing(String),
    #[error("{0}")]
    OutOfMemory(String),
    #[error("Cancelled")]
    Cancelled,
    #[error("{0}")]
    Network(String),
    #[error("{0}")]
    Io(String),
    #[error("{0}")]
    Inference(String),
    #[error("{0}")]
    Other(String),
}

#[derive(Debug, Clone, Copy, Serialize, TS, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum ErrorKind {
    UnsupportedFile,
    CorruptFile,
    InvalidModel,
    ModelMissing,
    OutOfMemory,
    Cancelled,
    Network,
    Io,
    Inference,
    Other,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AppError {
    pub kind: ErrorKind,
    pub message: String,
}

impl PrismError {
    pub fn kind(&self) -> ErrorKind {
        use PrismError::*;
        match self {
            UnsupportedFile(_) => ErrorKind::UnsupportedFile,
            CorruptFile(_) => ErrorKind::CorruptFile,
            InvalidModel(_) => ErrorKind::InvalidModel,
            ModelMissing(_) => ErrorKind::ModelMissing,
            OutOfMemory(_) => ErrorKind::OutOfMemory,
            Cancelled => ErrorKind::Cancelled,
            Network(_) => ErrorKind::Network,
            Io(_) => ErrorKind::Io,
            Inference(_) => ErrorKind::Inference,
            Other(_) => ErrorKind::Other,
        }
    }
    pub fn to_app(&self) -> AppError {
        AppError { kind: self.kind(), message: self.to_string() }
    }
}

impl From<std::io::Error> for PrismError {
    fn from(e: std::io::Error) -> Self {
        if e.kind() == std::io::ErrorKind::OutOfMemory {
            return PrismError::OutOfMemory("The system ran out of memory.".into());
        }
        PrismError::Io(format!("File error: {e}"))
    }
}

impl From<serde_json::Error> for PrismError {
    fn from(e: serde_json::Error) -> Self {
        PrismError::Other(format!("Data error: {e}"))
    }
}

impl From<ort::Error> for PrismError {
    fn from(e: ort::Error) -> Self {
        let msg = e.to_string();
        let low = msg.to_lowercase();
        if low.contains("alloc") || low.contains("out of memory") || low.contains("bad_alloc") {
            PrismError::OutOfMemory(
                "Not enough memory to run this model. Close other apps or try a shorter track.".into(),
            )
        } else {
            PrismError::Inference(format!("The model failed to run: {msg}"))
        }
    }
}
