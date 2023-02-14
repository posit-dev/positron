//
// utils.rs
//
// Copyright (C) 2022 by Posit Software, PBC
//
//

use std::ffi::CStr;
use std::ffi::CString;

use libR_sys::*;

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
    let actual = r_typeof(object);

    if !expected.contains(&actual) {
        return Err(Error::UnexpectedType(actual, expected.to_vec()));
    }

    Ok(actual)
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

pub trait CharSxpEq {
    fn eq_charsxp(&self, s: SEXP) -> bool;
}

impl CharSxpEq for &str {
    fn eq_charsxp(&self, s: SEXP) -> bool {
        unsafe {
            s != R_NaString && (*self).eq(CStr::from_ptr(R_CHAR(s)).to_str().unwrap())
        }
    }
}

impl CharSxpEq for String {
    fn eq_charsxp(&self, s: SEXP) -> bool {
        (&self[..]).eq_charsxp(s)
    }
}

impl<S: CharSxpEq> PartialEq<[S]> for RObject {
    fn eq(&self, other: &[S]) -> bool {
        unsafe {
            let object = self.sexp;
            if r_typeof(object) != STRSXP {
                return false;
            }

            let n = Rf_xlength(object) as isize;
            if n != other.len() as isize {
                return false;
            }
            for i in 0..n {
                if !other.get_unchecked(i as usize).eq_charsxp(STRING_ELT(object, i)) {
                    return false;
                }
            }
            true
        }
    }
}

impl<S: CharSxpEq, const N: usize> PartialEq<[S; N]> for RObject {
    fn eq(&self, other: &[S; N]) -> bool {
        self.eq(&other[..])
    }
}

impl<S: CharSxpEq> PartialEq<Vec<S>> for RObject {
    fn eq(&self, other: &Vec<S>) -> bool {
        self.eq(&other[..])
    }
}

impl <S: CharSxpEq> PartialEq<S> for RObject {
    fn eq(&self, other: &S) -> bool {
        unsafe {
            let sexp = self.sexp;
            if Rf_length(sexp) != 1 {
                return false;
            }

            other.eq_charsxp(STRING_ELT(sexp, 0))
        }

    }
}

pub fn r_is_null(object: SEXP) -> bool {
    unsafe {
        Rf_isNull(object) == 1
    }
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
    let class = CString::new(class).unwrap();
    return Rf_inherits(object, class.as_ptr()) != 0;
}

pub unsafe fn r_formals(object: SEXP) -> Result<Vec<RArgument>> {

    // convert primitive functions into equivalent closures
    let mut object = RObject::new(object);
    if r_typeof(*object) == BUILTINSXP || r_typeof(*object) == SPECIALSXP {
        object = RFunction::new("base", "args").add(*object).call()?;
        if r_typeof(*object) != CLOSXP {
            return Ok(Vec::new());
        }
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

    let name = Rf_getAttrib(envir, r_symbol!("name"));
    if r_typeof(name) == STRSXP {
        let name = RObject::view(name).to::<String>()?;
        return Ok(name);
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
