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
use crate::error::Result;
use crate::exec::RArgument;
use crate::exec::RFunction;
use crate::exec::RFunctionExt;
use crate::object::RObject;
use crate::r_symbol;

pub unsafe fn r_check_type(object: SEXP, expected: &[u32]) -> Result<u32> {

    let actual = TYPEOF(object) as u32;
    for candidate in expected.iter() {
        if actual == *candidate {
            return Ok(actual)
        }
    }

    Err(Error::UnexpectedType(actual, expected.to_vec()))

}

pub unsafe fn r_check_length(object: SEXP, expected: u32) -> Result<u32> {

    let actual = Rf_length(object) as u32;
    if actual != expected {
        return Err(Error::UnexpectedLength(actual, expected));
    }

    Ok(actual)
}

pub unsafe fn r_typeof(object: SEXP) -> u32 {
    TYPEOF(object) as u32
}

pub unsafe fn r_type2char<T: Into<u32>>(kind: T) -> String {
    let kind = Rf_type2char(kind.into());
    let cstr = CStr::from_ptr(kind);
    return cstr.to_str().unwrap().to_string();
}

pub unsafe fn r_get_option<T: TryFrom<RObject, Error = Error>>(name: &str) -> Result<T> {
    let result = Rf_GetOption1(r_symbol!(name));
    return RObject::new(result).try_into();
}

pub unsafe fn r_inherits(object: SEXP, class: &str) -> bool {
    return Rf_inherits(object, cstr!(class)) != 0;
}

pub unsafe fn r_formals(object: SEXP) -> Result<Vec<RArgument>> {

    // convert primitive functions into equivalent closures
    let mut object = RObject::new(object);
    if r_typeof(*object) == BUILTINSXP || r_typeof(*object) == SPECIALSXP {
        object = RFunction::new("base", "args").add(*object).call()?;
    }

    // validate we have a closure now
    r_check_type(*object, &[CLOSXP])?;

    // get the formals
    let mut formals = FORMALS(*object);

    // iterate through the entries
    let mut arguments = Vec::new();

    while formals != R_NilValue {

        let name = RObject::from(TAG(formals)).to::<String>()?;
        let value = CAR(formals);
        arguments.push(RArgument::new(name.as_str(), RObject::new(value)));
        formals = CDR(formals);

    }

    Ok(arguments)

}
