//
// utils.rs
//
// Copyright (C) 2022 by Posit, PBC
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
use crate::vector::CharacterVector;
use crate::vector::Vector;

pub unsafe fn r_assert_type(object: SEXP, expected: &[u32]) -> Result<u32> {

    let actual = TYPEOF(object) as u32;
    for candidate in expected.iter() {
        if actual == *candidate {
            return Ok(actual)
        }
    }

    Err(Error::UnexpectedType(actual, expected.to_vec()))

}

pub unsafe fn r_assert_capacity(object: SEXP, required: u32) -> Result<u32> {

    let actual = Rf_length(object) as u32;
    if actual < required {
        return Err(Error::UnexpectedLength(actual, required));
    }

    Ok(actual)

}

pub unsafe fn r_assert_length(object: SEXP, expected: u32) -> Result<u32> {

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
    r_assert_type(*object, &[CLOSXP])?;

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

pub unsafe fn r_envir_name(envir: SEXP) -> Result<String> {

    r_assert_type(envir, &[ENVSXP])?;

    if R_IsPackageEnv(envir) != 0 {
        let name = RObject::from(R_PackageEnvName(envir));
        return name.to::<String>();
    }

    if R_IsNamespaceEnv(envir) != 0 {
        let spec = CharacterVector::try_from(R_NamespaceEnvSpec(envir))?;
        let package = spec.elt(0)?;
        return Ok(package);
    }

    Ok(format!("{:p}", envir))

}

pub unsafe fn r_stringify(object: SEXP, delimiter: &str) -> Result<String> {

    // handle SYMSXPs upfront
    if r_typeof(object) == SYMSXP {
        return RObject::view(object).to::<String>();
    }

    // call format on the object
    let object = RFunction::new("base", "format")
        .add(object)
        .call()?;

    // paste into a single string
    let object = RFunction::new("base", "paste")
        .add(object)
        .param("collapse", delimiter)
        .call()?
        .to::<String>()?;

    Ok(object)

}
