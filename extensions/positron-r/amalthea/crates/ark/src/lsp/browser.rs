//
// browser.rs
//
// Copyright (C) 2022 by Posit, PBC
//
//

use harp::object::RObject;
use libR_sys::*;
use stdext::local;

#[harp::register]
pub unsafe extern "C" fn ps_browse_url(url: SEXP) -> SEXP {

    let result : anyhow::Result<()> = local! {
        let url = RObject::view(url).to::<String>()?;
        let _output = std::process::Command::new("open").arg(url).output()?;
        Ok(())
    };

    match result {
        Ok(_) => Rf_ScalarLogical(1),
        Err(_) => Rf_ScalarLogical(0),
    }

}
