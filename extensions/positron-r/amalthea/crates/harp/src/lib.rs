//
// lib.rs
//
// Copyright (C) 2022 by Posit Software, PBC
//
//

pub mod eval;
pub mod error;
pub mod exec;
pub mod lock;
pub mod object;
pub mod protect;
pub mod routines;
pub mod test;
pub mod utils;
pub mod vector;

pub use harp_macros::register;

pub fn initialize() {
    lock::initialize();
}

#[macro_export]
macro_rules! r_symbol {

    ($id:literal) => {{
        use std::os::raw::c_char;
        let value = concat!($id, "\0");
        libR_sys::Rf_install(value.as_ptr() as *const c_char)
    }};

    ($id:expr) => {{
        use std::os::raw::c_char;
        let cstr = [&*$id, "\0"].concat();
        libR_sys::Rf_install(cstr.as_ptr() as *const c_char)
    }};

}

#[macro_export]
macro_rules! r_string {

    ($id:expr) => {{
        use std::os::raw::c_char;
        use libR_sys::*;

        let mut protect = $crate::protect::RProtect::new();
        let value = &*$id;
        let string_sexp = protect.add(Rf_allocVector(STRSXP, 1));
        let char_sexp = Rf_mkCharLenCE(value.as_ptr() as *mut c_char, value.len() as i32, cetype_t_CE_UTF8);
        SET_STRING_ELT(string_sexp, 0, char_sexp);
        string_sexp
    }}

}

#[macro_export]
macro_rules! r_lock {

    ($($expr:tt)*) => {{
        #[allow(unused_unsafe)]
        $crate::lock::with_r_lock(|| {
            unsafe { $($expr)* } }
        )
    }}

}

/// Asserts that the given expression matches the given pattern
/// and optionally some further assertions
///
/// # Examples
///
/// ```
/// #[macro_use] extern crate harp;
/// # fn main() {
/// assert_match!(1 + 1, 2);
/// assert_match!(1 + 1, 2 => {
///    assert_eq!(40 + 2, 42)
/// });
/// # }
/// ```
#[macro_export]
macro_rules! assert_match {

    ($expression:expr, $pattern:pat_param => $code:block) => {
        assert!(match $expression {
            $pattern => {
                $code
                true
            },
            _ => false
        })
    };

    ($expression:expr, $pattern:pat_param) => {
        assert!(matches!($expression, $pattern))
    };
}
