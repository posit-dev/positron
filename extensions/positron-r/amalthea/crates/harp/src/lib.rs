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
        Rf_install(value.as_ptr() as *const c_char)
    }};

    ($id:expr) => {{
        use std::os::raw::c_char;
        let cstr = [&*$id, "\0"].concat();
        Rf_install(cstr.as_ptr() as *const c_char)
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

#[macro_export]
macro_rules! r_pairlist_one {

    ($x:expr, $tail:expr) => {{

        enum MaybeNamed {
            UnNamed(SEXP),
            Named((&'static str, SEXP))
        }

        impl From<SEXP> for MaybeNamed {
            fn from(x: SEXP) -> Self {
                MaybeNamed::UnNamed(x)
            }
        }

        impl From<(&'static str, SEXP)> for MaybeNamed {
        fn from(x: (&'static str, SEXP)) -> Self {
                MaybeNamed::Named(x)
            }
        }

        let maybe_named : MaybeNamed = $x.into();

        let value: SEXP ;
        let mut tag: &str = "";

        match maybe_named {
            MaybeNamed::UnNamed(x) => {
                value = x;
            }

            MaybeNamed::Named(tuple) => {
                tag = tuple.0;
                value = tuple.1;
            }
        }

        let mut head = Rf_protect(value);
        head = Rf_cons(head, $tail);
        if !tag.is_empty() {
            SET_TAG(head, r_symbol!(tag))
        }
        Rf_unprotect(1);

        head

    }};
}

#[macro_export]
macro_rules! r_pairlist {
    ($head:expr) => {{
        crate::r_pairlist_one!($head, R_NilValue)
    }};

    ($head:expr, $($dots:expr),+) => {{
        crate::r_pairlist_one!($head, r_pairlist!($($dots),+))
    }};

}

#[macro_export]
macro_rules! r_lang {
    ($($dots:expr),+) => {{
        let call = r_pairlist!($($dots),+);
        SET_TYPEOF(call, LANGSXP as i32);
        call
    }};
}
