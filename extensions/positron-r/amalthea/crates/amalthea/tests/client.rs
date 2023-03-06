/*
 * client.rs
 *
 * Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *
 */

use amalthea::kernel::{Kernel, StreamBehavior};
use amalthea::wire::comm_close::CommClose;
use amalthea::wire::comm_info_request::CommInfoRequest;
use amalthea::wire::comm_msg::CommMsg;
use amalthea::wire::comm_open::CommOpen;
use amalthea::wire::execute_input::ExecuteInput;
use amalthea::wire::execute_request::ExecuteRequest;
use amalthea::wire::execute_result::ExecuteResult;
use amalthea::wire::input_reply::InputReply;
use amalthea::wire::jupyter_message::{Message, MessageType, Status};
use amalthea::wire::kernel_info_request::KernelInfoRequest;
use amalthea::wire::status::{ExecutionState, KernelStatus};
use amalthea::wire::wire_message::WireMessage;
use log::info;
use serde_json;
use std::sync::{Arc, Mutex};
use std::thread;

mod control;
mod frontend;
mod shell;

#[test]
fn test_kernel() {
    let frontend = frontend::Frontend::new();
    let connection_file = frontend.get_connection_file();
    let mut kernel = Kernel::new(connection_file).unwrap();
    let shell_tx = kernel.create_iopub_tx();
    let shell = Arc::new(Mutex::new(shell::Shell::new(shell_tx)));
    let control = Arc::new(Mutex::new(control::Control {}));

    // Initialize logging
    env_logger::init();
    info!("Starting test kernel");

    // Create the thread that will run the Amalthea kernel
    thread::spawn(
        move || match kernel.connect(shell, control, None, StreamBehavior::None) {
            Ok(_) => {
                info!("Kernel connection initiated");
            },
            Err(e) => {
                panic!("Error connecting kernel: {}", e);
            },
        },
    );

    // Give the kernel a little time to start up
    info!("Waiting 500ms for kernel startup to complete");
    std::thread::sleep(std::time::Duration::from_millis(500));

    // Complete client initialization
    info!("Completing frontend initialization");
    frontend.complete_intialization();

    // Ask the kernel for the kernel info. This should return an object with the
    // language "Test" defined in our shell handler.
    info!("Requesting kernel information");
    frontend.send_shell(KernelInfoRequest {});

    info!("Waiting for kernel info reply");
    let reply = frontend.receive_shell();
    match reply {
        Message::KernelInfoReply(reply) => {
            info!("Kernel info received: {:?}", reply);
            assert_eq!(reply.content.language_info.name, "Test");
        },
        _ => {
            panic!("Unexpected message received: {:?}", reply);
        },
    }

    // Ask the kernel to execute some code
    info!("Requesting execution of code '42'");
    frontend.send_shell(ExecuteRequest {
        code: "42".to_string(),
        silent: false,
        store_history: true,
        user_expressions: serde_json::Value::Null,
        allow_stdin: false,
        stop_on_error: false,
    });

    // The kernel should send an execute reply message indicating that the execute succeeded
    info!("Waiting for execute reply");
    let reply = frontend.receive_shell();
    match reply {
        Message::ExecuteReply(reply) => {
            info!("Received execute reply: {:?}", reply);
            assert_eq!(reply.content.status, Status::Ok);
            assert_eq!(reply.content.execution_count, 1);
        },
        _ => {
            panic!("Unexpected execute reply received: {:?}", reply);
        },
    }

    // The IOPub channel should receive six messages, in this order:
    // 1. A message indicating that the kernel has entered the busy state
    //    (for the kernel_info_request)
    // 2. A message indicating that the kernel has entered the idle state
    //    (for the kernel_info_request)
    // 3. A message indicating that the kernel has entered the busy state
    //    (for the execute_request)
    // 4. A message re-broadcasting the input
    // 5. A message with the result of the execution
    // 6. A message indicating that the kernel has exited the busy state
    //    (for the execute_request)

    info!("Waiting for IOPub execution information messsage 1 of 6: Status");
    let iopub_1 = frontend.receive_iopub();
    match iopub_1 {
        Message::Status(status) => {
            info!("Got kernel status: {:?}", status);
            // TODO: validate parent header
            assert_eq!(status.content.execution_state, ExecutionState::Busy);
        },
        _ => {
            panic!(
                "Unexpected message received (expected status): {:?}",
                iopub_1
            );
        },
    }

    info!("Waiting for IOPub execution information messsage 2 of 6: Status");
    let iopub_2 = frontend.receive_iopub();
    match iopub_2 {
        Message::Status(status) => {
            info!("Got kernel status: {:?}", status);
            // TODO: validate parent header
            assert_eq!(status.content.execution_state, ExecutionState::Idle);
        },
        _ => {
            panic!(
                "Unexpected message received (expected status): {:?}",
                iopub_2
            );
        },
    }

    info!("Waiting for IOPub execution information messsage 3 of 6: Status");
    let iopub_3 = frontend.receive_iopub();
    match iopub_3 {
        Message::Status(status) => {
            info!("Got kernel status: {:?}", status);
            assert_eq!(status.content.execution_state, ExecutionState::Busy);
        },
        _ => {
            panic!(
                "Unexpected message received (expected status): {:?}",
                iopub_3
            );
        },
    }

    info!("Waiting for IOPub execution information messsage 4 of 6: Input Broadcast");
    let iopub_4 = frontend.receive_iopub();
    match iopub_4 {
        Message::ExecuteInput(input) => {
            info!("Got input rebroadcast: {:?}", input);
            assert_eq!(input.content.code, "42");
        },
        _ => {
            panic!(
                "Unexpected message received (expected input rebroadcast): {:?}",
                iopub_4
            );
        },
    }

    info!("Waiting for IOPub execution information messsage 5 of 6: Execution Result");
    let iopub_5 = frontend.receive_iopub();
    match iopub_5 {
        Message::ExecuteResult(result) => {
            info!("Got execution result: {:?}", result);
        },
        _ => {
            panic!(
                "Unexpected message received (expected execution result): {:?}",
                iopub_5
            );
        },
    }

    info!("Waiting for IOPub execution information messsage 6 of 6: Status");
    let iopub_6 = frontend.receive_iopub();
    match iopub_6 {
        Message::Status(status) => {
            info!("Got kernel status: {:?}", status);
            assert_eq!(status.content.execution_state, ExecutionState::Idle);
        },
        _ => {
            panic!(
                "Unexpected message received (expected status): {:?}",
                iopub_6
            );
        },
    }

    info!("Sending request to generate an input prompt");
    frontend.send_shell(ExecuteRequest {
        code: "prompt".to_string(),
        silent: false,
        store_history: true,
        user_expressions: serde_json::Value::Null,
        allow_stdin: true,
        stop_on_error: false,
    });

    info!("Waiting for kernel to send an input request");
    let request = frontend.receive_stdin();
    match request {
        Message::InputRequest(request) => {
            info!("Got input request: {:?}", request);
            assert_eq!(request.content.prompt, "Amalthea Echo> ");
        },
        _ => {
            panic!(
                "Unexpected message received (expected input request): {:?}",
                request
            );
        },
    }

    info!("Sending input to the kernel");
    frontend.send_stdin(InputReply {
        value: "42".to_string(),
    });

    // Consume the IOPub messages that the kernel sends back during the
    // processing of the above `prompt` execution request
    assert_eq!(
        // Status: Busy
        WireMessage::try_from(&frontend.receive_iopub())
            .unwrap()
            .message_type(),
        KernelStatus::message_type()
    );
    assert_eq!(
        // ExecuteInput (re-broadcast of 'Prompt')
        WireMessage::try_from(&frontend.receive_iopub())
            .unwrap()
            .message_type(),
        ExecuteInput::message_type()
    );
    assert_eq!(
        // ExecuteResult
        WireMessage::try_from(&frontend.receive_iopub())
            .unwrap()
            .message_type(),
        ExecuteResult::message_type()
    );
    assert_eq!(
        // Status: Idle
        WireMessage::try_from(&frontend.receive_iopub())
            .unwrap()
            .message_type(),
        KernelStatus::message_type()
    );

    // The kernel should send an execute reply message indicating that the execute
    // of the 'prompt' command succeeded
    info!("Waiting for execute reply");
    let reply = frontend.receive_shell();
    match reply {
        Message::ExecuteReply(reply) => {
            info!("Received execute reply: {:?}", reply);
            assert_eq!(reply.content.status, Status::Ok);
            assert_eq!(reply.content.execution_count, 2);
        },
        _ => {
            panic!("Unexpected execute reply received: {:?}", reply);
        },
    }

    // Test the heartbeat
    info!("Sending heartbeat to the kernel");
    let msg = zmq::Message::from("Heartbeat");
    frontend.send_heartbeat(msg);

    info!("Waiting for heartbeat reply");
    let reply = frontend.receive_heartbeat();
    assert_eq!(reply, zmq::Message::from("Heartbeat"));

    // Test the comms
    info!("Sending comm open request to the kernel");
    let comm_id = "A3A6D0EA-1443-4F70-B059-F423E445B8D6";
    frontend.send_shell(CommOpen {
        comm_id: comm_id.to_string(),
        target_name: "environment".to_string(),
        data: serde_json::Value::Null,
    });

    info!("Requesting comm info from the kernel (to test opening)");
    frontend.send_shell(CommInfoRequest {
        target_name: "environment".to_string(),
    });
    let reply = frontend.receive_shell();
    match reply {
        Message::CommInfoReply(request) => {
            info!("Got comm info: {:?}", request);
            // Ensure the comm we just opened is in the list of comms
            let comms = request.content.comms.as_object().unwrap();
            assert!(comms.contains_key(comm_id));
        },
        _ => {
            panic!(
                "Unexpected message received (expected comm info): {:?}",
                reply
            );
        },
    }

    info!("Sending comm message to the test comm and waiting for a reply");
    frontend.send_shell(CommMsg {
        comm_id: comm_id.to_string(),
        data: serde_json::Value::Null,
    });
    loop {
        let msg = frontend.receive_iopub();
        match msg {
            Message::CommMsg(msg) => {
                // This is the message we were looking for; break out of the
                // loop
                info!("Got comm message: {:?}", msg);
                assert_eq!(msg.content.comm_id, comm_id);
                break;
            },
            _ => {
                // It isn't the message; keep looking for it (we expect a
                // number of other messages, e.g. busy/idle notifications as
                // the kernel processes the comm message)
                info!("Ignoring message: {:?}", msg);
                continue;
            },
        }
    }

    // Test closing the comm we just opened
    info!("Sending comm close request to the kernel");
    frontend.send_shell(CommClose {
        comm_id: comm_id.to_string(),
    });

    // Test to see if the comm is still in the list of comms after closing it
    // (it should not be)
    info!("Requesting comm info from the kernel (to test closing)");
    frontend.send_shell(CommInfoRequest {
        target_name: "environment".to_string(),
    });
    let reply = frontend.receive_shell();
    match reply {
        Message::CommInfoReply(request) => {
            info!("Got comm info: {:?}", request);
            // Ensure the comm we just closed not present in the list of comms
            let comms = request.content.comms.as_object().unwrap();
            assert!(!comms.contains_key(comm_id));
        },
        _ => {
            panic!(
                "Unexpected message received (expected comm info): {:?}",
                reply
            );
        },
    }
}
