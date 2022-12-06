//
// show_message.rs
//
// Copyright (C) 2022 by Posit, PBC
//
//

use amalthea::events::{ShowMessageEvent, PositronEvent};
use harp::object::RObject;
use libR_sys::*;
use stdext::local;

use crate::request::Request;

use super::global::INSTANCE;

/// Shows a message in the Positron frontend
#[harp::register]
pub unsafe extern "C" fn ps_show_message(message: SEXP) -> SEXP {

    let result : anyhow::Result<()> = local! {
        // Convert message to a string
        let msg = RObject::view(message).to::<String>()?;

        // Get the global instance of the channel used to deliver requests to the
        // front end, and send a request to show the message
        if let Some(inst) = INSTANCE.get() {
            if let Err(err) = inst.channel.send(Request::DeliverEvent(PositronEvent::ShowMessage(ShowMessageEvent{message: msg}))) {
                anyhow::bail!("Failed to send message to front end: {}", err);
            }
        } else {
            anyhow::bail!("Client instance not initialized");
        }
        Ok(())
    };

    match result {
        Ok(_) => Rf_ScalarLogical(1),
        Err(_) => Rf_ScalarLogical(0),
    }
}
