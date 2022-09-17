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

use crate::macros::cstr;
use crate::r::error::Error;
use crate::r::macros::r_symbol;
use crate::r::object::RObject;

pub unsafe fn r_check_type(object: SEXP, expected: u32) -> Result<(), Error> {

    let actual = TYPEOF(object) as u32;
    if actual != expected {
        return Err(Error::UnexpectedType(actual, expected));
    }

    Ok(())

}

pub unsafe fn r_check_length(object: SEXP, expected: u32) -> Result<(), Error> {

    let actual = Rf_length(object) as u32;
    if actual != expected {
        return Err(Error::UnexpectedLength(actual, expected));
    }

    Ok(())
}

pub unsafe fn r_typeof(object: SEXP) -> u32 {
    TYPEOF(object) as u32
}

pub unsafe fn r_type2char(kind: u32) -> String {
    let kind = Rf_type2char(kind);
    let cstr = CStr::from_ptr(kind);
    return cstr.to_str().unwrap().to_string();
}

pub fn r_get_option<T: TryFrom<RObject, Error = Error>>(name: &str) -> Result<T, Error> {
    unsafe {
        let result = Rf_GetOption1(r_symbol!(name));
        return RObject::new(result).try_into();
    }
}

pub fn r_inherits(object: SEXP, class: &str) -> bool {
    unsafe {
        return Rf_inherits(object, cstr!(class)) != 0;
    }
}
