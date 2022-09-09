//
// macros.rs
//
// Copyright (C) 2022 by RStudio, PBC
//
//

// NOTE: We provide an API for Rf_install() as rust's strings are not
// nul-terminated by default, and so we need to do the work to ensure
// the strings we pass to Rf_install() are nul-terminated C strings.
macro_rules! r_symbol {

    ($id:literal) => {{
        use std::os::raw::c_char;
        let value = concat!($id, "\0");
        Rf_install(value.as_ptr() as *const c_char)
    }};

    ($id:expr) => {{
        use std::os::raw::c_char;
        let cstr = [&*$id, "\0"].concat();
        Rf_install(cstr.as_ptr() as *const c_char)
    }};

}
pub(crate) use r_symbol;

macro_rules! r_string {

    ($id:expr) => {{
        use std::os::raw::c_char;
        use libR_sys::*;

        let mut protect = $crate::r::protect::RProtect::new();
        let value = &*$id;
        let string_sexp = protect.add(Rf_allocVector(STRSXP, 1));
        let char_sexp = Rf_mkCharLenCE(value.as_ptr() as *mut c_char, value.len() as i32, cetype_t_CE_UTF8);
        SET_STRING_ELT(string_sexp, 0, char_sexp);
        string_sexp
    }}

}
pub(crate) use r_string;

macro_rules! r_check_length {

    ($object:expr, $expected:expr) => {{
        let actual = Rf_length(*$object);
        let expected = $expected;
        if actual != expected {
            return Err($crate::r::error::Error::UnexpectedLength(actual, expected));
        }
    }}

}
pub(crate) use r_check_length;

// Mainly for debugging.
macro_rules! rlog {

    ($x:expr) => {{

        use crate::r::macros::*;
        use libR_sys::*;

        let callee = Rf_protect(Rf_lang3(
            r_symbol!("::"),
            r_symbol!("base"),
            r_symbol!("format"),
        ));

        let mut errc = 0;
        let call = Rf_protect(Rf_lang2(callee, $x));
        let result = R_tryEvalSilent(call, R_GlobalEnv, &mut errc);
        if errc != 0 {
            let robj = extendr_api::Robj::from_sexp(result);
            if let Ok(strings) = extendr_api::Strings::try_from(robj) {
                for string in strings.iter() {
                    dlog!("{}", string);
                }
            }
        } else {
            dlog!("Error logging value '{}'", stringify!($x));
        }

        Rf_unprotect(2);

    }}

}
pub(crate) use rlog;

