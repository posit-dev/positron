//
// symbol.rs
//
// Copyright (C) 2022 Posit Software, PBC. All rights reserved.
//
//

use libR_sys::*;
use std::ffi::CStr;

use std::ops::Deref;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct RSymbol {
    pub sexp: SEXP
}

impl RSymbol {
    pub fn new(sexp: SEXP) -> Self {
        RSymbol { sexp }
    }
}

impl Deref for RSymbol {
    type Target = SEXP;
    fn deref(&self) -> &Self::Target {
        &self.sexp
    }
}

impl From<RSymbol> for String {
    fn from(symbol: RSymbol) -> Self {
        unsafe {
            let utf8text = Rf_translateCharUTF8(PRINTNAME(*symbol));
            CStr::from_ptr(utf8text).to_str().unwrap().to_string()
        }
    }
}

impl std::fmt::Display for RSymbol {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", String::from(*self))
    }
}
