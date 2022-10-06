//
// utils.rs
//
// Copyright (C) 2022 by RStudio, PBC
//
//

use std::ffi::CStr;

use libR_sys::*;
use stdext::cstr;

use crate::error::Error;
use crate::object::RObject;
use crate::r_symbol;

pub unsafe fn r_check_type(object: SEXP, expected: u32) -> Result<(), Error> {

    let actual = TYPEOF(object) as u32;
    if actual != expected {
        return Err(Error::UnexpectedType(actual, vec![expected]));
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

pub unsafe fn r_type2char<T: Into<u32>>(kind: T) -> String {
    let kind = Rf_type2char(kind.into());
    let cstr = CStr::from_ptr(kind);
    return cstr.to_str().unwrap().to_string();
}

pub unsafe fn r_get_option<T: TryFrom<RObject, Error = Error>>(name: &str) -> Result<T, Error> {
    let result = Rf_GetOption1(r_symbol!(name));
    return RObject::new(result).try_into();
}

pub unsafe fn r_inherits(object: SEXP, class: &str) -> bool {
    return Rf_inherits(object, cstr!(class)) != 0;
}
