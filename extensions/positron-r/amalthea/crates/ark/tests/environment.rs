//
// environment.rs
//
// Copyright (C) 2023 Posit Software, PBC. All rights reserved.
//
//

use amalthea::comm::comm_channel::CommChannelMsg;
use ark::environment::message::EnvironmentMessage;
use ark::environment::message::EnvironmentMessageList;
use ark::environment::r_environment::REnvironment;
use harp::object::RObject;
use harp::r_lock;
use harp::r_symbol;
use harp::test::start_r;
use libR_sys::R_EmptyEnv;
use libR_sys::R_NewEnv;
use libR_sys::Rf_ScalarInteger;
use libR_sys::Rf_defineVar;

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
        RObject::new(R_NewEnv(R_EmptyEnv, 0, 5))
    };

    // Create a sender/receiver pair for the comm channel.
    let (frontend_message_tx, frontend_message_rx) =
        crossbeam::channel::unbounded::<CommChannelMsg>();

    // Create a new environment handler and give it a view of the test
    // environment we created.
    let test_env_view = unsafe { RObject::view(test_env.sexp) };
    let r_env = REnvironment::new(test_env_view, frontend_message_tx.clone());
    let backend_msg_sender = r_env.channel_msg_tx.clone();

    // Ensure we get a list of variables after initialization
    let msg = frontend_message_rx.recv().unwrap();
    let data = match msg {
        CommChannelMsg::Data(data) => data,
        _ => panic!("Expected data message"),
    };

    // Ensure we got a list of variables by unmarshalling the JSON. The list
    // should be empty since we don't have any variables in the R environment.
    let list: EnvironmentMessageList = serde_json::from_value(data).unwrap();
    assert!(list.variables.len() == 0);

    // Now create a variable in the R environment and ensure we get a list of
    // variables with the new variable in it.
    r_lock! {
        let sym = r_symbol!("everything");
        Rf_defineVar(sym, Rf_ScalarInteger(42), test_env.sexp);
    }

    // Request that the environment be refreshed
    let refresh = EnvironmentMessage::Refresh;
    let data = serde_json::to_value(refresh).unwrap();
    backend_msg_sender.send(CommChannelMsg::Data(data)).unwrap();

    // Wait for the new list of variables to be delivered
    let msg = frontend_message_rx.recv().unwrap();
    let data = match msg {
        CommChannelMsg::Data(data) => data,
        _ => panic!("Expected data message, got {:?}", msg),
    };

    // Unmarshal the list and check for the variable we created
    let list: EnvironmentMessageList = serde_json::from_value(data).unwrap();
    assert!(list.variables.len() == 1);
    let var = &list.variables[0];
    assert_eq!(var.name, "everything");
}
