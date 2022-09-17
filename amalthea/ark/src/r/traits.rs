//
// traits.rs
//
// Copyright (C) 2022 by RStudio, PBC
//
//

use std::ffi::CStr;

use libR_sys::*;

use crate::r::error::Error;
use crate::r::utils::r_check_length;
use crate::r::utils::r_check_type;

pub trait SEXPExt<T> {
    type Error;
    fn to(self) -> Result<T, Self::Error>;
}

impl SEXPExt<String> for SEXP {
    type Error = Error;

    fn to(self) -> Result<String, Self::Error> {
        unsafe {
            r_check_type(self, STRSXP)?;
            r_check_length(self, 1)?;
            let cstr = R_CHAR(STRING_ELT(self, 0));
            return Ok(CStr::from_ptr(cstr).to_str().unwrap().to_string());
        }
    }

}
