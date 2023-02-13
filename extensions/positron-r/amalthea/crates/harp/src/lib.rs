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
macro_rules! r_lock {

    ($($expr:tt)*) => {{
        #[allow(unused_unsafe)]
        $crate::lock::with_r_lock(|| {
            unsafe { $($expr)* } }
        )
    }}

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
macro_rules! r_pairlist {

    ($name:ident = $head:expr$(,)?) => {{

        use libR_sys::*;

        let mut protect = $crate::protect::RProtect::new();
        let value = protect.add(Rf_cons($head, R_NilValue));
        SET_TAG(value, $crate::r_symbol!(stringify!($name)));

        value

    }};

    ($name:ident = $head:expr, $($rest:tt)+) => {{

        use libR_sys::*;

        let mut protect = $crate::protect::RProtect::new();
        let value = protect.add(Rf_cons($head, $crate::r_pairlist!($($rest)*)));
        SET_TAG(value, $crate::r_symbol!(stringify!($name)));

        value

    }};

    ($head:expr$(,)?) => {{
        use libR_sys::*;
        Rf_cons($head, R_NilValue)
    }};

    ($head:expr, $($rest:tt)+) => {{
        use libR_sys::*;
        Rf_cons($head, $crate::r_pairlist!($($rest)*))
    }};

}

#[macro_export]
macro_rules! r_lang {

    ($(rest:tt)*) => {
        let value = $crate::r_pairlist!($($rest)*);
        SET_TYPEOF(value, LISTSXP);
        value
    }

}

#[cfg(test)]
mod tests {
    use libR_sys::*;
    use crate::object::RObject;

    use super::*;

    #[test]
    fn test_pairlist() { r_test! {

        let value = RObject::new(r_pairlist! {
            A = r_symbol!("a"),
            B = r_symbol!("b"),
            r_symbol!("c"),
            r_symbol!("d"),
        });

        assert!(CAR(*value) == r_symbol!("a"));
        assert!(CADR(*value) == r_symbol!("b"));
        assert!(CADDR(*value) == r_symbol!("c"));
        assert!(CADDDR(*value) == r_symbol!("d"));

        assert!(TAG(*value) == r_symbol!("A"));
        assert!(TAG(CDR(*value)) == r_symbol!("B"));

    }}

}

