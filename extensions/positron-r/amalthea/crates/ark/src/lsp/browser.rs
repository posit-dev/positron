//
// browser.rs
//
// Copyright (C) 2022 Posit Software, PBC. All rights reserved.
//
//

use amalthea::events::PositronEvent;
use amalthea::events::ShowHelpEvent;
use harp::exec::RFunction;
use harp::object::RObject;
use libR_sys::*;
use log::info;
use std::os::raw::c_char;

use crate::interface::KERNEL;

pub static mut PORT: u16 = 0;

#[harp::register]
pub unsafe extern "C" fn ps_browse_url(url: SEXP) -> SEXP {
    match ps_browse_url_impl(url) {
        Ok(_) => Rf_ScalarLogical(1),
        Err(error) => {
            log::error!("{}", error);
            Rf_ScalarLogical(0)
        }
    }
}

unsafe fn ps_browse_url_impl(url: SEXP) -> anyhow::Result<()> {
    // Extract URL
    let url = RObject::view(url).to::<String>()?;

    // Check for help requests
    let port = RFunction::new("tools", "httpdPort").call()?.to::<i32>()?;

    let prefix = format!("http://127.0.0.1:{}/", port);
    if url.starts_with(&prefix) {
        let replacement = format!("http://127.0.0.1:{}/", PORT);
        let url = url.replace(prefix.as_str(), replacement.as_str());
        let event = PositronEvent::ShowHelp(ShowHelpEvent {
            kind: "url".to_string(),
            content: url,
            focus: true,
        });

        info!("Sending ShowHelp event: {:#?}", event);
        let kernel = KERNEL.as_ref().unwrap().lock().unwrap();
        kernel.send_event(event);
    }

    Ok(())
}
