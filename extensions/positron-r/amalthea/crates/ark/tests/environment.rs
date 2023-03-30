//
// environment.rs
//
// Copyright (C) 2023 Posit Software, PBC. All rights reserved.
//
//

use amalthea::comm::comm_channel::CommChannelMsg;
use amalthea::socket::comm::CommInitiator;
use amalthea::socket::comm::CommSocket;
use ark::environment::message::EnvironmentMessage;
use ark::environment::message::EnvironmentMessageClear;
use ark::environment::message::EnvironmentMessageDelete;
use ark::environment::message::EnvironmentMessageList;
use ark::environment::message::EnvironmentMessageUpdate;
use ark::environment::r_environment::REnvironment;
use ark::lsp::signals::SIGNALS;
use harp::exec::RFunction;
use harp::exec::RFunctionExt;
use harp::object::RObject;
use harp::r_lock;
use harp::r_symbol;
use harp::test::start_r;
use harp::utils::r_envir_remove;
use harp::utils::r_envir_set;
use libR_sys::*;

/**
 * Basic test for the R environment list. This test:
 *
 * 1. Starts the R interpreter
 * 2. Creates a new REnvironment
 * 3. Ensures that the environment list is empty
 * 4. Creates a variable in the R environment
 * 5. Ensures that the environment list contains the new variable
 */
#[test]
fn test_environment_list() {
    // Start the R interpreter so we have a live environment for the test to run
    // against.
    start_r();

    // Create a new environment for the test. We use a new, empty environment
    // (with the empty environment as its parent) so that each test in this
    // file can run independently.
    let test_env = r_lock! {
        RFunction::new("base", "new.env")
            .param("parent", R_EmptyEnv)
            .call()
            .unwrap()
    };

    // Create a sender/receiver pair for the comm channel.
    let comm = CommSocket::new(
        CommInitiator::FrontEnd,
        String::from("test-environment-comm-id"),
        String::from("positron.environment"),
    );

    // Create a new environment handler and give it a view of the test
    // environment we created.
    let test_env_view = RObject::view(test_env.sexp);
    let incoming_tx = comm.incoming_tx.clone();
    let outgoing_rx = comm.outgoing_rx.clone();
    REnvironment::start(test_env_view, comm);

    // Ensure we get a list of variables after initialization
    let msg = outgoing_rx.recv().unwrap();
    let data = match msg {
        CommChannelMsg::Data(data) => data,
        _ => panic!("Expected data message"),
    };

    // Ensure we got a list of variables by unmarshalling the JSON. The list
    // should be empty since we don't have any variables in the R environment.
    let list: EnvironmentMessageList = serde_json::from_value(data).unwrap();
    assert!(list.variables.len() == 0);
    assert_eq!(list.version, 1);

    // Now create a variable in the R environment and ensure we get a list of
    // variables with the new variable in it.
    r_lock! {
        let sym = r_symbol!("everything");
        Rf_defineVar(sym, Rf_ScalarInteger(42), test_env.sexp);
    }

    // Request that the environment be refreshed
    let refresh = EnvironmentMessage::Refresh;
    let data = serde_json::to_value(refresh).unwrap();
    let request_id = String::from("refresh-id-1234");
    incoming_tx
        .send(CommChannelMsg::Rpc(request_id.clone(), data))
        .unwrap();

    // Wait for the new list of variables to be delivered
    let msg = outgoing_rx.recv().unwrap();
    let data = match msg {
        CommChannelMsg::Rpc(reply_id, data) => {
            // Ensure that the reply ID we received from then environment pane
            // matches the request ID we sent
            assert_eq!(request_id, reply_id);
            data
        },
        _ => panic!("Expected data message, got {:?}", msg),
    };

    // Unmarshal the list and check for the variable we created
    let list: EnvironmentMessageList = serde_json::from_value(data).unwrap();
    assert!(list.variables.len() == 1);
    let var = &list.variables[0];
    assert_eq!(var.display_name, "everything");
    assert_eq!(list.version, 2);

    // create another variable
    r_lock! {
        r_envir_set("nothing", Rf_ScalarInteger(43), test_env.sexp);
        r_envir_remove("everything", test_env.sexp);
    }

    // Simulate a prompt signal
    SIGNALS.console_prompt.emit(());

    // Wait for the new list of variables to be delivered
    let msg = outgoing_rx.recv().unwrap();
    let data = match msg {
        CommChannelMsg::Data(data) => data,
        _ => panic!("Expected data message, got {:?}", msg),
    };

    // Unmarshal the list and check for the variable we created
    let msg: EnvironmentMessageUpdate = serde_json::from_value(data).unwrap();
    assert_eq!(msg.assigned.len(), 1);
    assert_eq!(msg.removed.len(), 1);
    assert_eq!(msg.assigned[0].display_name, "nothing");
    assert_eq!(msg.removed[0], "everything");
    assert_eq!(msg.version, 3);

    // Request that the environment be cleared
    let clear = EnvironmentMessage::Clear(EnvironmentMessageClear {
        include_hidden_objects: true,
    });
    let data = serde_json::to_value(clear).unwrap();
    let request_id = String::from("clear-id-1235");
    incoming_tx
        .send(CommChannelMsg::Rpc(request_id.clone(), data))
        .unwrap();

    // Wait for the success message to be delivered
    let data = match outgoing_rx.recv().unwrap() {
        CommChannelMsg::Rpc(reply_id, data) => {
            // Ensure that the reply ID we received from then environment pane
            // matches the request ID we sent
            assert_eq!(request_id, reply_id);

            data
        },
        _ => panic!("Expected data message, got {:?}", msg),
    };

    // Unmarshal the list and check for the variable we created
    let list: EnvironmentMessageList = serde_json::from_value(data).unwrap();
    assert!(list.variables.len() == 0);
    assert_eq!(list.version, 4);

    // test the env is now empty
    r_lock! {
        let contents = RObject::new(R_lsInternal(*test_env, Rboolean_TRUE));
        assert_eq!(Rf_length(*contents), 0);
    }

    // create some more variables
    r_lock! {
        let sym = r_symbol!("a");
        Rf_defineVar(sym, Rf_ScalarInteger(42), test_env.sexp);

        let sym = r_symbol!("b");
        Rf_defineVar(sym, Rf_ScalarInteger(43), test_env.sexp);
    }

    // Simulate a prompt signal
    SIGNALS.console_prompt.emit(());

    let msg = outgoing_rx.recv().unwrap();
    let data = match msg {
        CommChannelMsg::Data(data) => data,
        _ => panic!("Expected data message, got {:?}", msg),
    };

    let msg: EnvironmentMessageUpdate = serde_json::from_value(data).unwrap();
    assert_eq!(msg.assigned.len(), 2);
    assert_eq!(msg.removed.len(), 0);
    assert_eq!(msg.version, 5);

    // Request that a environment be deleted
    let delete = EnvironmentMessage::Delete(EnvironmentMessageDelete {
        variables: vec![String::from("a")],
    });
    let data = serde_json::to_value(delete).unwrap();
    let request_id = String::from("delete-id-1236");
    incoming_tx
        .send(CommChannelMsg::Rpc(request_id.clone(), data))
        .unwrap();

    let data = match outgoing_rx.recv().unwrap() {
        CommChannelMsg::Rpc(reply_id, data) => {
            assert_eq!(request_id, reply_id);
            data
        },
        _ => panic!("Expected data message, got {:?}", msg),
    };

    let update: EnvironmentMessageUpdate = serde_json::from_value(data).unwrap();
    assert!(update.assigned.len() == 0);
    assert_eq!(update.removed, ["a"]);
    assert_eq!(update.version, 6);

    // close the comm. Otherwise the thread panics
    incoming_tx.send(CommChannelMsg::Close).unwrap();
}
