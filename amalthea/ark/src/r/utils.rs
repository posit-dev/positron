//
// utils.rs
//
// Copyright (C) 2022 by RStudio, PBC
//
//

// These routines are wrappers to useful R APIs, which instead
// produce results more easily consumable by Rust.
//
// All APIs here should be marked unsafe, so that callers are
// required to hold an R lock when invoking these.

use std::ffi::CStr;

use libR_sys::*;

pub unsafe fn type2char(object: SEXP) -> String {
    let kind = Rf_type2char(TYPEOF(object) as u32);
    let cstr = CStr::from_ptr(kind);
    return cstr.to_str().unwrap().to_string();
}
