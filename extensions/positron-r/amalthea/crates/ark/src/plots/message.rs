//
// message.rs
//
// Copyright (C) 2023 by Posit Software, PBC
//
//

// Synchronize with:
// src/vs/workbench/services/languageRuntime/common/languageRuntimePlotClient.ts

use serde::Deserialize;
use serde::Serialize;

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "msg_type", rename_all = "snake_case")]
pub enum PlotMessageInput {
    Render(PlotMessageInputRender),
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PlotMessageInputRender {
    pub height: f64,
    pub width: f64,
    pub pixel_ratio: f64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "msg_type", rename_all = "snake_case")]
pub enum PlotMessageOutput {
    Image(PlotMessageOutputImage),
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PlotMessageOutputImage {
    pub data: String,
    pub mime_type: String,
}
