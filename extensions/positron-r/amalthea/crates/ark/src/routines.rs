//
// routines.rs
//
// Copyright (C) 2022 by Posit, PBC
//
//

use harp::routines::r_add_call_method;

use crate::lsp::browser::ps_browse_url;

pub unsafe fn register_call_methods() {

    r_add_call_method("ps_browseUrl", ps_browse_url, 0);

}
