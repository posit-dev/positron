/*
 * shell.rs
 *
 * Copyright (C) 2022 by Posit Software, PBC
 *
 */

use amalthea::comm::comm_channel::Comm;
use amalthea::comm::comm_channel::CommChannel;
use amalthea::language::shell_handler::ShellHandler;
use amalthea::socket::iopub::IOPubMessage;
use amalthea::wire::complete_reply::CompleteReply;
use amalthea::wire::complete_request::CompleteRequest;
use amalthea::wire::exception::Exception;
use amalthea::wire::execute_error::ExecuteError;
use amalthea::wire::execute_input::ExecuteInput;
use amalthea::wire::execute_reply::ExecuteReply;
use amalthea::wire::execute_reply_exception::ExecuteReplyException;
use amalthea::wire::execute_request::ExecuteRequest;
use amalthea::wire::execute_result::ExecuteResult;
use amalthea::wire::input_reply::InputReply;
use amalthea::wire::input_request::ShellInputRequest;
use amalthea::wire::inspect_reply::InspectReply;
use amalthea::wire::inspect_request::InspectRequest;
use amalthea::wire::is_complete_reply::IsComplete;
use amalthea::wire::is_complete_reply::IsCompleteReply;
use amalthea::wire::is_complete_request::IsCompleteRequest;
use amalthea::wire::jupyter_message::Status;
use amalthea::wire::kernel_info_reply::KernelInfoReply;
use amalthea::wire::kernel_info_request::KernelInfoRequest;
use amalthea::wire::language_info::LanguageInfo;
use async_trait::async_trait;
use log::warn;
use serde_json::json;
use std::sync::mpsc::SyncSender;

pub struct Shell {
    iopub: SyncSender<IOPubMessage>,
    input_sender: Option<SyncSender<ShellInputRequest>>,
    execution_count: u32,
}

impl Shell {
    pub fn new(iopub: SyncSender<IOPubMessage>) -> Self {
        Self {
            iopub: iopub,
            execution_count: 0,
            input_sender: None,
        }
    }
}

#[async_trait]
impl ShellHandler for Shell {
    async fn handle_info_request(
        &mut self,
        _req: &KernelInfoRequest,
    ) -> Result<KernelInfoReply, Exception> {
        let info = LanguageInfo {
            name: String::from("Echo"),
            version: String::from("1.0"),
            file_extension: String::from(".ech"),
            mimetype: String::from("text/echo"),
            pygments_lexer: String::new(),
            codemirror_mode: String::new(),
            nbconvert_exporter: String::new(),
        };
        Ok(KernelInfoReply {
            status: Status::Ok,
            banner: format!("Amalthea Echo {}", env!("CARGO_PKG_VERSION")),
            debugger: false,
            protocol_version: String::from("5.0"),
            help_links: Vec::new(),
            language_info: info,
        })
    }

    async fn handle_complete_request(
        &self,
        _req: &CompleteRequest,
    ) -> Result<CompleteReply, Exception> {
        // No matches in this toy implementation.
        Ok(CompleteReply {
            matches: Vec::new(),
            status: Status::Ok,
            cursor_start: 0,
            cursor_end: 0,
            metadata: json!({}),
        })
    }


    /// Handle a request to test code for completion.
    async fn handle_is_complete_request(
        &self,
        _req: &IsCompleteRequest,
    ) -> Result<IsCompleteReply, Exception> {
        // In this echo example, the code is always complete!
        Ok(IsCompleteReply {
            status: IsComplete::Complete,
            indent: String::from(""),
        })
    }

    /// Handles an ExecuteRequest; "executes" the code by echoing it.
    async fn handle_execute_request(
        &mut self,
        _originator: &Vec<u8>,
        req: &ExecuteRequest,
    ) -> Result<ExecuteReply, ExecuteReplyException> {
        // Increment counter if we are storing this execution in history
        if req.store_history {
            self.execution_count = self.execution_count + 1;
        }

        // If the code is not to be executed silently, re-broadcast the
        // execution to all frontends
        if !req.silent {
            if let Err(err) = self.iopub.send(IOPubMessage::ExecuteInput(ExecuteInput {
                code: req.code.clone(),
                execution_count: self.execution_count,
            })) {
                warn!(
                    "Could not broadcast execution input {} to all front ends: {}",
                    self.execution_count, err
                );
            }
        }

        // Create an artificial error if the user requested one
        if req.code == "err" {
            let exception = Exception {
                ename: String::from("Generic Error"),
                evalue: String::from("Some kind of error occurred. No idea which."),
                traceback: vec![
                    String::from("Frame1"),
                    String::from("Frame2"),
                    String::from("Frame3"),
                ],
            };

            if let Err(err) = self.iopub.send(IOPubMessage::ExecuteError(ExecuteError {
                exception: exception.clone(),
            })) {
                warn!(
                    "Could not publish error from computation {} on iopub: {}",
                    self.execution_count, err
                );
            }

            return Err(ExecuteReplyException {
                status: Status::Error,
                execution_count: self.execution_count,
                exception: exception,
            });
        }

        // For this toy echo language, generate a result that's just the input
        // echoed back.
        let data = json!({"text/plain": req.code });
        if let Err(err) = self.iopub.send(IOPubMessage::ExecuteResult(ExecuteResult {
            execution_count: self.execution_count,
            data: data,
            metadata: json!({}),
        })) {
            warn!(
                "Could not publish result of computation {} on iopub: {}",
                self.execution_count, err
            );
        }

        // Let the shell thread know that we've successfully executed the code.
        Ok(ExecuteReply {
            status: Status::Ok,
            execution_count: self.execution_count,
            user_expressions: serde_json::Value::Null,
        })
    }

    /// Handles an introspection request
    async fn handle_inspect_request(
        &self,
        req: &InspectRequest,
    ) -> Result<InspectReply, Exception> {
        let data = match req.code.as_str() {
            "err" => {
                json!({"text/plain": "This generates an error!"})
            }
            "teapot" => {
                json!({"text/plain": "This is clearly a teapot."})
            }
            _ => serde_json::Value::Null,
        };
        Ok(InspectReply {
            status: Status::Ok,
            found: data != serde_json::Value::Null,
            data: data,
            metadata: json!({}),
        })
    }

    async fn handle_comm_open(&self, _comm: Comm) -> Result<Option<Box<dyn CommChannel>>, Exception> {
        // No comms in this toy implementation.
        Ok(None)
    }

    async fn handle_input_reply(&self, _msg: &InputReply) -> Result<(), Exception> {
        // NYI
        Ok(())
    }

    fn establish_input_handler(&mut self, handler: SyncSender<ShellInputRequest>) {
        self.input_sender = Some(handler);
    }
}
