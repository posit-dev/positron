//
// browser.rs
//
// Copyright (C) 2022 by Posit, PBC
//
//

use amalthea::events::PositronEvent;
use amalthea::events::ShowHelpUrlEvent;
use harp::exec::RFunction;
use harp::object::RObject;
use libR_sys::*;
use log::info;

use crate::interface::KERNEL;

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

    Rf_PrintValue(url);
    let url = RObject::view(url).to::<String>()?;

    // Check for help requests
    let port = RFunction::new("tools", "httpdPort")
        .call()?
        .to::<i32>()?;

    let prefix = format!("http://127.0.0.1:{}/", port);
    if url.starts_with(&prefix) {

        let event = PositronEvent::ShowHelpUrl(ShowHelpUrlEvent {
            url: url,
        });

        info!("Sending ShowHelpUrl event: {:#?}", event);
        let kernel = KERNEL.as_ref().unwrap().lock().unwrap();
        kernel.send_event(event);

    }

    Ok(())

}
