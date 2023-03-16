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
pub struct Symbol {
    pub sexp: SEXP
}

impl Symbol {
    pub fn new(sexp: SEXP) -> Self {
        Symbol { sexp }
    }
}

impl Deref for Symbol {
    type Target = SEXP;
    fn deref(&self) -> &Self::Target {
        &self.sexp
    }
}

impl From<Symbol> for String {
    fn from(symbol: Symbol) -> Self {
        unsafe {
            let utf8text = Rf_translateCharUTF8(PRINTNAME(*symbol));
            CStr::from_ptr(utf8text).to_str().unwrap().to_string()
        }
    }
}

impl std::fmt::Display for Symbol {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", String::from(*self))
    }
}
