//
// browser.rs
//
// Copyright (C) 2022 by Posit Software, PBC
//
//

use amalthea::events::PositronEvent;
use amalthea::events::ShowHelpEvent;
use harp::exec::RFunction;
use harp::exec::RFunctionExt;
use harp::object::RObject;
use harp::object::RObjectExt;
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

    let url = RObject::view(url).to::<String>()?;

    // Check for help requests
    let port = RFunction::new("tools", "httpdPort")
        .call()?
        .to::<i32>()?;

    let prefix = format!("http://127.0.0.1:{}/", port);
    if url.starts_with(&prefix) {

        let endpoint = &url[prefix.len() - 1..];
        Rf_PrintValue(*RObject::from(endpoint));
        let response = RFunction::new("tools", "httpd")
            .add(endpoint)
            .call()?;

        let payload = response.elt("payload")?;
        let html = payload.to::<String>()?;

        // TODO (kevin): This is mostly just a placeholder.
        let event = PositronEvent::ShowHelp(ShowHelpEvent {
            content: html,
            kind: "html".to_string(),
        });

        info!("Sending ShowHelp event: {:#?}", event);
        let kernel = KERNEL.as_ref().unwrap().lock().unwrap();
        kernel.send_event(event);

    }

    Ok(())

}
