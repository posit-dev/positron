//
// traits.rs
//
// Copyright (C) 2022 by RStudio, PBC
//
//

use std::ffi::CStr;

use libR_sys::*;

use crate::macros::cstr;
use crate::r::error::Error;
use crate::r::utils::r_check_length;
use crate::r::utils::r_check_type;

pub trait SEXPExt<T> {
    type Error;

    // Convert a SEXP -> T
    unsafe fn to(self) -> Result<T, Self::Error>;

    // Check whether an object inherits from some class
    unsafe fn inherits(&self, class: &str) -> bool;

}

impl SEXPExt<String> for SEXP {
    type Error = Error;

    unsafe fn to(self) -> Result<String, Self::Error> {
        r_check_type(self, STRSXP)?;
        r_check_length(self, 1)?;
        let cstr = R_CHAR(STRING_ELT(self, 0));
        return Ok(CStr::from_ptr(cstr).to_str().unwrap().to_string());
    }

    unsafe fn inherits(&self, class: &str) -> bool {
        Rf_inherits(*self, cstr!(class)) != 0
    }

}
