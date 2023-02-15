//
// shell.rs
//
// Copyright (C) 2022 by Posit Software, PBC
//
//

use amalthea::comm::comm_channel::Comm;
use amalthea::comm::comm_channel::CommChannel;
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
use crossbeam::channel::Receiver;
use crossbeam::channel::Sender;
use crossbeam::channel::unbounded;
use harp::object::RObject;
use libR_sys::*;
use log::*;
use serde_json::json;

use crate::kernel::KernelInfo;
use crate::request::Request;
use crate::comm::environment::EnvironmentInstance;


pub struct Shell {
    shell_request_sender: Sender<Request>,
    kernel_init_receiver: BusReader<KernelInfo>,
    kernel_info: Option<KernelInfo>,
}

impl Shell {
    /// Creates a new instance of the shell message handler.
    pub fn new(
        iopub: Sender<IOPubMessage>,
        shell_request_sender: Sender<Request>,
        shell_request_receiver: Receiver<Request>,
        kernel_init_sender: Bus<KernelInfo>,
        kernel_init_receiver: BusReader<KernelInfo>,
    ) -> Self {

        let iopub_sender = iopub.clone();

        std::thread::spawn(move || {
            Self::execution_thread(iopub_sender, shell_request_receiver, kernel_init_sender);
        });

        Self {
            shell_request_sender,
            kernel_init_receiver,
            kernel_info: None
        }
    }

    /// Starts the R execution thread (does not return)
    pub fn execution_thread(
        sender: Sender<IOPubMessage>,
        receiver: Receiver<Request>,
        kernel_init_sender: Bus<KernelInfo>,
    ) {
        // Start kernel (does not return)
        crate::interface::start_r(sender, receiver, kernel_init_sender);
    }

    /// Returns a sender channel for the R execution thread; used outside the
    /// shell handler
    pub fn request_sender(&self) -> Sender<Request> {
        self.shell_request_sender.clone()
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
            self.kernel_info = Some(self.kernel_init_receiver.recv().unwrap());
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
    async fn handle_is_complete_request(&self, req: &IsCompleteRequest,) -> Result<IsCompleteReply, Exception> {

        // Test if the code can be successfully parsed.
        let mut ps : ParseStatus = 0;
        unsafe {
            let code = RObject::from(req.code.as_str());
            R_ParseVector(*code, 1, &mut ps, R_NilValue);
        }

        // TODO: Handle incomplete parse, etc.
        if ps == ParseStatus_PARSE_OK {
            Ok(IsCompleteReply {
                status: IsComplete::Complete,
                indent: String::from(""),
            })
        } else {
            Ok(IsCompleteReply {
                status: IsComplete::Incomplete,
                indent: String::from("+"),
            })
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
        if let Err(err) = self.shell_request_sender.send(Request::ExecuteCode(
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

    /// Handles a request to open a new comm channel
    async fn handle_comm_open(&self, comm: Comm) -> Result<Option<Box<dyn CommChannel>>, Exception> {
        match comm {
            Comm::Environment => {
                Ok(Some(Box::new(EnvironmentInstance{})))
            }
            _ => {
                Ok(None)
            }
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
        if let Err(err) = self.shell_request_sender.send(Request::ExecuteCode(
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
        self.shell_request_sender
            .send(Request::EstablishInputChannel(handler))
            .unwrap();
    }
}
