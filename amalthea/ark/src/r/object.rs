//
// object.rs
//
// Copyright (C) 2022 by RStudio, PBC
//
//

use std::convert::TryFrom;
use std::ffi::CStr;
use std::ops::Deref;
use std::ops::DerefMut;
use std::os::raw::c_char;
use std::os::raw::c_int;

use libR_sys::*;

use crate::r::macros::r_check_length;

unsafe fn protect(object: &mut RObject) {
    if object.data != R_NilValue {
        R_PreserveObject(object.data);
    }
}

unsafe fn unprotect(object: &mut RObject) {
    if object.data != R_NilValue {
        R_ReleaseObject(object.data);
    }
}

pub struct RObject {
    pub data: SEXP,
}

impl RObject {

    pub unsafe fn new(data: SEXP) -> Self {
        let mut this = RObject { data };
        protect(&mut this);
        return this;
    }

    pub unsafe fn null() -> Self {
        RObject { data: R_NilValue }
    }

}

impl Drop for RObject {
    fn drop(&mut self) {
        unsafe { unprotect(self) };
    }
}

impl Deref for RObject {
    type Target = SEXP;
    fn deref(&self) -> &Self::Target {
        unsafe { &self.data }
    }
}

impl DerefMut for RObject {
    fn deref_mut(&mut self) -> &mut Self::Target {
        unsafe { &mut self.data }
    }
}

/// <T> -> RObject
impl From<SEXP> for RObject {
    fn from(value: SEXP) -> Self {
        unsafe { RObject::new(value) }
    }
}

impl From<bool> for RObject {
    fn from(value: bool) -> Self {
        unsafe {
            let value = Rf_ScalarLogical(value as c_int);
            return RObject::new(value);
        }
    }
}

impl From<i32> for RObject {
    fn from(value: i32) -> Self {
        unsafe {
            let value = Rf_ScalarInteger(value as c_int);
            return RObject::new(value);
        }
    }
}

impl From<f64> for RObject {
    fn from(value: f64) -> Self {
        unsafe {
            let value = Rf_ScalarReal(value);
            return RObject::new(value);
        }
    }
}

impl From<&str> for RObject {
    fn from(value: &str) -> Self {
        unsafe {
            let vector = Rf_protect(Rf_allocVector(STRSXP, 1));
            let element = Rf_mkCharLenCE(value.as_ptr() as *mut c_char, value.len() as i32, cetype_t_CE_UTF8);
            SET_STRING_ELT(vector, 0, element);
            Rf_unprotect(1);
            return RObject::new(vector);
        }
    }
}

impl From<String> for RObject {
    fn from(value: String) -> Self {
        value.as_str().into()
    }
}

/// RObject -> <T>
impl TryFrom<RObject> for bool {
    type Error = crate::r::error::Error;
    fn try_from(value: RObject) -> Result<Self, Self::Error> {
        unsafe {
            // r_check_type!(value, LGLSXP);
            r_check_length!(value, 1);
            // r_check_na
            return Ok(*LOGICAL(*value) != 0);
        }
    }
}

impl TryFrom<RObject> for String {
    type Error = crate::r::error::Error;
    fn try_from(value: RObject) -> Result<Self, Self::Error> {
        unsafe {
            r_check_length!(value, 1);
            let cstr = R_CHAR(STRING_ELT(*value, 0));
            return Ok(CStr::from_ptr(cstr).to_str().unwrap().to_string());
        }
    }
}
