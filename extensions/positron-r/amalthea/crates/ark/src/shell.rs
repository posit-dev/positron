//
// shell.rs
//
// Copyright (C) 2022 Posit Software, PBC. All rights reserved.
//
//

use amalthea::comm::comm_channel::Comm;
use amalthea::comm::comm_channel::CommChannelMsg;
use amalthea::language::shell_handler::ShellHandler;
use amalthea::socket::iopub::IOPubMessage;
use amalthea::wire::complete_reply::CompleteReply;
use amalthea::wire::complete_request::CompleteRequest;
use amalthea::wire::exception::Exception;
use amalthea::wire::execute_reply::ExecuteReply;
use amalthea::wire::execute_reply_exception::ExecuteReplyException;
use amalthea::wire::execute_request::ExecuteRequest;
use amalthea::wire::execute_response::ExecuteResponse;
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
use bus::Bus;
use bus::BusReader;
use crossbeam::channel::unbounded;
use crossbeam::channel::Receiver;
use crossbeam::channel::Sender;
use harp::exec::r_parse_vector;
use harp::exec::ParseResult;
use harp::object::RObject;
use harp::r_lock;
use libR_sys::R_GlobalEnv;
use log::*;
use serde_json::json;

use crate::environment::r_environment::REnvironment;
use crate::kernel::KernelInfo;
use crate::request::Request;

pub struct Shell {
    shell_request_tx: Sender<Request>,
    kernel_init_rx: BusReader<KernelInfo>,
    kernel_info: Option<KernelInfo>,
    r_events_rx: Receiver<REvent>
}

#[derive(Debug)]
pub enum REvent {
    Prompt
}

impl Shell {
    /// Creates a new instance of the shell message handler.
    pub fn new(
        iopub_tx: Sender<IOPubMessage>,
        shell_request_tx: Sender<Request>,
        shell_request_rx: Receiver<Request>,
        kernel_init_tx: Bus<KernelInfo>,
        kernel_init_rx: BusReader<KernelInfo>,
        r_events_tx: Sender<REvent>,
        r_events_rx: Receiver<REvent>
    ) -> Self {
        let iopub_tx = iopub_tx.clone();
        std::thread::spawn(move || {
            Self::execution_thread(iopub_tx, kernel_init_tx, shell_request_rx, r_events_tx);
        });

        Self {
            shell_request_tx,
            kernel_init_rx,
            kernel_info: None,
            r_events_rx
        }
    }

    /// Starts the R execution thread (does not return)
    pub fn execution_thread(
        iopub_tx: Sender<IOPubMessage>,
        kernel_init_tx: Bus<KernelInfo>,
        shell_request_rx: Receiver<Request>,
        r_events_tx: Sender<REvent>
    ) {
        // Start kernel (does not return)
        crate::interface::start_r(iopub_tx, kernel_init_tx, shell_request_rx, r_events_tx);
    }

    /// Returns a sender channel for the R execution thread; used outside the
    /// shell handler
    pub fn request_tx(&self) -> Sender<Request> {
        self.shell_request_tx.clone()
    }
}

#[async_trait]
impl ShellHandler for Shell {
    async fn handle_info_request(
        &mut self,
        _req: &KernelInfoRequest,
    ) -> Result<KernelInfoReply, Exception> {
        // Wait here for kernel initialization if it hasn't completed. This is
        // necessary for two reasons:
        //
        // 1. The kernel info response must include the startup banner, which is
        //    not emitted until R is done starting up.
        // 2. Jupyter front ends typically wait for the kernel info response to
        //    be sent before they signal that the kernel as ready for use, so
        //    blocking here ensures that it doesn't try to execute code before R is
        //    ready.
        if self.kernel_info.is_none() {
            trace!("Got kernel info request; waiting for R to complete initialization");
            self.kernel_info = Some(self.kernel_init_rx.recv().unwrap());
        } else {
            trace!("R already started, using existing kernel information")
        }
        let kernel_info = self.kernel_info.as_ref().unwrap();

        let info = LanguageInfo {
            name: String::from("R"),
            version: kernel_info.version.clone(),
            file_extension: String::from(".R"),
            mimetype: String::from("text/r"),
            pygments_lexer: String::new(),
            codemirror_mode: String::new(),
            nbconvert_exporter: String::new(),
        };
        Ok(KernelInfoReply {
            status: Status::Ok,
            banner: kernel_info.banner.clone(),
            debugger: false,
            protocol_version: String::from("5.3"),
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
        req: &IsCompleteRequest,
    ) -> Result<IsCompleteReply, Exception> {
        match unsafe { r_parse_vector(req.code.as_str()) } {
            Ok(ParseResult::Complete(_)) => Ok(IsCompleteReply {
                status: IsComplete::Complete,
                indent: String::from(""),
            }),
            Ok(ParseResult::Incomplete()) => Ok(IsCompleteReply {
                status: IsComplete::Incomplete,
                indent: String::from("+"),
            }),
            Err(_) => Ok(IsCompleteReply {
                status: IsComplete::Invalid,
                indent: String::from(""),
            }),
        }
    }

    /// Handles an ExecuteRequest by sending the code to the R execution thread
    /// for processing.
    async fn handle_execute_request(
        &mut self,
        originator: &Vec<u8>,
        req: &ExecuteRequest,
    ) -> Result<ExecuteReply, ExecuteReplyException> {
        let (sender, receiver) = unbounded::<ExecuteResponse>();
        if let Err(err) = self.shell_request_tx.send(Request::ExecuteCode(
            req.clone(),
            originator.clone(),
            sender,
        )) {
            warn!(
                "Could not deliver execution request to execution thread: {}",
                err
            )
        }

        // Let the shell thread know that we've executed the code.
        trace!("Code sent to R: {}", req.code);
        let result = receiver.recv().unwrap();
        match result {
            ExecuteResponse::Reply(reply) => Ok(reply),
            ExecuteResponse::ReplyException(err) => Err(err),
        }
    }

    /// Handles an introspection request
    async fn handle_inspect_request(
        &self,
        req: &InspectRequest,
    ) -> Result<InspectReply, Exception> {
        let data = match req.code.as_str() {
            "err" => {
                json!({"text/plain": "This generates an error!"})
            },
            "teapot" => {
                json!({"text/plain": "This is clearly a teapot."})
            },
            _ => serde_json::Value::Null,
        };
        Ok(InspectReply {
            status: Status::Ok,
            found: data != serde_json::Value::Null,
            data: data,
            metadata: json!({}),
        })
    }

    /// Handles a request to open a new comm channel
    async fn handle_comm_open(
        &self,
        comm: Comm,
        msg_tx: Sender<CommChannelMsg>,
    ) -> Result<Option<Sender<CommChannelMsg>>, Exception> {
        match comm {
            Comm::Environment => {
                r_lock! {
                    let global_env = RObject::view(R_GlobalEnv);
                    let env: REnvironment = REnvironment::new(global_env, msg_tx.clone(), self.r_events_rx.clone());
                    Ok(Some(env.channel_msg_tx))
                }
            },
            _ => Ok(None),
        }
    }

    /// Handles a reply to an input_request; forwarded from the Stdin channel
    async fn handle_input_reply(&self, msg: &InputReply) -> Result<(), Exception> {
        // Send the input reply to R in the form of an ordinary execution request.
        let req = ExecuteRequest {
            code: msg.value.clone(),
            silent: true,
            store_history: false,
            user_expressions: json!({}),
            allow_stdin: false,
            stop_on_error: false,
        };
        let originator = Vec::new();
        let (sender, receiver) = unbounded::<ExecuteResponse>();
        if let Err(err) = self.shell_request_tx.send(Request::ExecuteCode(
            req.clone(),
            originator.clone(),
            sender,
        )) {
            warn!("Could not deliver input reply to execution thread: {}", err)
        }

        // Let the shell thread know that we've executed the code.
        trace!("Input reply sent to R: {}", req.code);
        let result = receiver.recv().unwrap();
        if let ExecuteResponse::ReplyException(err) = result {
            warn!("Error in input reply: {:?}", err);
        }
        Ok(())
    }

    fn establish_input_handler(&mut self, handler: Sender<ShellInputRequest>) {
        self.shell_request_tx
            .send(Request::EstablishInputChannel(handler))
            .unwrap();
    }
}
