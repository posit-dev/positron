//
// kernel.rs
//
// Copyright (C) 2022 Posit Software, PBC. All rights reserved.
//
//

use std::result::Result::Err;
use std::result::Result::Ok;
use std::sync::atomic::AtomicBool;

use amalthea::events::PositronEvent;
use amalthea::socket::iopub::IOPubMessage;
use amalthea::wire::exception::Exception;
use amalthea::wire::execute_input::ExecuteInput;
use amalthea::wire::execute_reply::ExecuteReply;
use amalthea::wire::execute_reply_exception::ExecuteReplyException;
use amalthea::wire::execute_request::ExecuteRequest;
use amalthea::wire::execute_response::ExecuteResponse;
use amalthea::wire::execute_result::ExecuteResult;
use amalthea::wire::input_request::InputRequest;
use amalthea::wire::input_request::ShellInputRequest;
use amalthea::wire::jupyter_message::Status;
use amalthea::wire::stream::Stream;
use amalthea::wire::stream::StreamOutput;
use anyhow::*;
use bus::Bus;
use crossbeam::atomic::AtomicCell;
use crossbeam::channel::Sender;
use harp::exec::RFunction;
use harp::exec::RFunctionExt;
use harp::object::RObject;
use harp::r_symbol;
use harp::utils::r_inherits;
use libR_sys::*;
use log::*;
use serde_json::json;
use stdext::unwrap;

use crate::request::Request;

/// Represents whether an error occurred during R code execution.
pub static R_ERROR_OCCURRED: AtomicBool = AtomicBool::new(false);
pub static R_ERROR_MESSAGE: AtomicCell<String> = AtomicCell::new(String::new());

/// Represents the Rust state of the R kernel
pub struct Kernel {
    pub execution_count: u32,
    iopub_tx: Sender<IOPubMessage>,
    console_tx: Sender<Option<String>>,
    kernel_init_tx: Bus<KernelInfo>,
    execute_response_tx: Option<Sender<ExecuteResponse>>,
    input_request_tx: Option<Sender<ShellInputRequest>>,
    banner: String,
    stdout: String,
    stderr: String,
    initializing: bool,
}

/// Represents kernel metadata (available after the kernel has fully started)
#[derive(Debug, Clone)]
pub struct KernelInfo {
    pub version: String,
    pub banner: String,
}

impl Kernel {
    /// Create a new R kernel instance
    pub fn new(
        iopub_tx: Sender<IOPubMessage>,
        console_tx: Sender<Option<String>>,
        kernel_init_tx: Bus<KernelInfo>,
    ) -> Self {
        Self {
            execution_count: 0,
            iopub_tx,
            console_tx,
            kernel_init_tx,
            execute_response_tx: None,
            input_request_tx: None,
            banner: String::new(),
            stdout: String::new(),
            stderr: String::new(),
            initializing: true,
        }
    }

    /// Completes the kernel's initialization
    pub fn complete_intialization(&mut self) {
        if self.initializing {
            let version = unsafe {
                let version = Rf_findVarInFrame(R_BaseNamespace, r_symbol!("R.version.string"));
                RObject::new(version).to::<String>().unwrap()
            };

            let kernel_info = KernelInfo {
                version: version.clone(),
                banner: self.banner.clone(),
            };

            debug!("Sending kernel info: {}", version);
            self.kernel_init_tx.broadcast(kernel_info);
            self.initializing = false;
        } else {
            warn!("Initialization already complete!");
        }
    }

    /// Service an execution request from the front end
    pub fn fulfill_request(&mut self, req: &Request) {
        match req {
            Request::ExecuteCode(req, _, sender) => {
                let sender = sender.clone();
                self.handle_execute_request(req, sender);
            },
            Request::Shutdown(_) => {
                if let Err(err) = self.console_tx.send(None) {
                    warn!("Error sending shutdown message to console: {}", err);
                }
            },
            Request::EstablishInputChannel(sender) => self.establish_input_handler(sender.clone()),
            Request::DeliverEvent(event) => self.handle_event(event),
        }
    }

    /// Handle an event from the back end to the front end
    pub fn handle_event(&mut self, event: &PositronEvent) {
        if let Err(err) = self.iopub_tx.send(IOPubMessage::Event(event.clone())) {
            warn!("Error attempting to deliver client event: {}", err);
        }
    }

    /// Handle an execute request from the front end
    pub fn handle_execute_request(
        &mut self,
        req: &ExecuteRequest,
        execute_response_tx: Sender<ExecuteResponse>,
    ) {
        // Clear error occurred flag
        R_ERROR_OCCURRED.store(false, std::sync::atomic::Ordering::Release);

        // Initialize stdout, stderr
        self.stdout = String::new();
        self.stderr = String::new();

        // Save copy of our response channel
        self.execute_response_tx = Some(execute_response_tx);

        // Increment counter if we are storing this execution in history
        if req.store_history {
            self.execution_count = self.execution_count + 1;
        }

        // If the code is not to be executed silently, re-broadcast the
        // execution to all frontends
        if !req.silent {
            if let Err(err) = self.iopub_tx.send(IOPubMessage::ExecuteInput(ExecuteInput {
                code: req.code.clone(),
                execution_count: self.execution_count,
            })) {
                warn!(
                    "Could not broadcast execution input {} to all front ends: {}",
                    self.execution_count, err
                );
            }
        }

        // Send the code to the R console to be evaluated
        self.console_tx.send(Some(req.code.clone())).unwrap();
    }

    /// Converts a data frame to HTML
    pub fn to_html(frame: SEXP) -> Result<String> {
        unsafe {
            let result = RFunction::from(".ps.format.toHtml")
                .add(frame)
                .call()?
                .to::<String>()?;
            Ok(result)
        }
    }

    /// Report an incomplete request to the front end
    pub fn report_incomplete_request(&self, req: &Request) {
        let code = match req {
            Request::ExecuteCode(req, _, _) => req.code.clone(),
            _ => String::new(),
        };
        if let Some(sender) = self.execute_response_tx.as_ref() {
            let reply = ExecuteReplyException {
                status: Status::Error,
                execution_count: self.execution_count,
                exception: Exception {
                    ename: "IncompleteInput".to_string(),
                    evalue: format!("Code fragment is not complete: {}", code),
                    traceback: vec![],
                },
            };
            if let Err(err) = sender.send(ExecuteResponse::ReplyException(reply)) {
                warn!("Error sending incomplete reply: {}", err);
            }
        }
    }

    /// Finishes the active execution request
    pub fn finish_request(&self) {
        // Save and reset error occurred flag
        let error_occurred = R_ERROR_OCCURRED.swap(false, std::sync::atomic::Ordering::AcqRel);

        // TODO: Include a traceback if an error occurs.
        if error_occurred {
            let mut message = R_ERROR_MESSAGE.take();
            if message.is_empty() {
                message.push_str("[no message available]");
            }
            log::info!("An R error occurred: {}", message);
        }

        // TODO: Implement rich printing of certain outputs.
        // Will we need something similar to the RStudio model,
        // where we implement custom print() methods? Or can
        // we make the stub below behave sensibly even when
        // streaming R output?
        let mut data = serde_json::Map::new();
        data.insert("text/plain".to_string(), json!(""));

        // Include HTML representation of data.frame
        // TODO: Do we need to hold the R lock here?
        let value = unsafe { Rf_findVarInFrame(R_GlobalEnv, r_symbol!(".Last.value")) };
        let is_data_frame = r_inherits(value, "data.frame");
        if is_data_frame {
            match Kernel::to_html(value) {
                Ok(html) => data.insert("text/html".to_string(), json!(html)),
                Err(error) => {
                    error!("{:?}", error);
                    None
                },
            };
        }

        if let Err(err) = self
            .iopub_tx
            .send(IOPubMessage::ExecuteResult(ExecuteResult {
                execution_count: self.execution_count,
                data: serde_json::Value::Object(data),
                metadata: json!({}),
            }))
        {
            warn!(
                "Could not publish result of statement {} on iopub: {}",
                self.execution_count, err
            );
        }

        // Send the reply to the front end
        if let Some(sender) = &self.execute_response_tx {
            sender
                .send(ExecuteResponse::Reply(ExecuteReply {
                    status: Status::Ok,
                    execution_count: self.execution_count,
                    user_expressions: json!({}),
                }))
                .unwrap();
        }
    }

    /// Requests input from the front end
    pub fn request_input(&self, originator: &Vec<u8>, prompt: &str) {
        if let Some(requestor) = &self.input_request_tx {
            trace!("Requesting input from front-end for prompt: {}", prompt);
            requestor
                .send(ShellInputRequest {
                    originator: originator.clone(),
                    request: InputRequest {
                        prompt: prompt.to_string(),
                        password: false,
                    },
                })
                .unwrap();
        } else {
            warn!("Unable to request input: no input requestor set!");
        }

        // Send an execute reply to the front end
        if let Some(sender) = &self.execute_response_tx {
            sender
                .send(ExecuteResponse::Reply(ExecuteReply {
                    status: Status::Ok,
                    execution_count: self.execution_count,
                    user_expressions: json!({}),
                }))
                .unwrap();
        }
    }

    /// Called from R when console data is written.
    pub fn write_console(&mut self, content: &str, stream: Stream) {
        if self.initializing {
            // During init, consider all output to be part of the startup banner
            self.banner.push_str(content);
            return;
        }

        let buffer = match stream {
            Stream::Stdout => &mut self.stdout,
            Stream::Stderr => &mut self.stderr,
        };

        // Append content to buffer.
        buffer.push_str(content);

        // Stream output via the IOPub channel.
        let message = IOPubMessage::Stream(StreamOutput {
            name: stream,
            text: content.to_string(),
        });

        unwrap!(self.iopub_tx.send(message), Err(error) => {
            log::error!("{}", error);
        });
    }

    /// Establishes the input handler for the kernel to request input from the
    /// user
    pub fn establish_input_handler(&mut self, input_request_tx: Sender<ShellInputRequest>) {
        self.input_request_tx = Some(input_request_tx);
    }

    /// Sends an event to the front end (Positron-specific)
    pub fn send_event(&self, event: PositronEvent) {
        info!("Sending Positron event: {:?}", event);
        if let Err(err) = self.iopub_tx.send(IOPubMessage::Event(event)) {
            warn!("Could not publish event on iopub: {}", err);
        }
    }
}
