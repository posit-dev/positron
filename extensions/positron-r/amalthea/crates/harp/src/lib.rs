//
// lib.rs
//
// Copyright (C) 2022 Posit Software, PBC. All rights reserved.
//
//

pub mod eval;
pub mod error;
pub mod exec;
pub mod interrupts;
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
macro_rules! r_char {

    ($id:expr) => {{
        use std::os::raw::c_char;
        use libR_sys::*;

        let value = &*$id;
        Rf_mkCharLenCE(value.as_ptr() as *mut c_char, value.len() as i32, cetype_t_CE_UTF8)
    }}

}

#[macro_export]
macro_rules! r_string {

    ($id:expr) => {{
        use libR_sys::*;

        let mut protect = $crate::protect::RProtect::new();
        let string_sexp = protect.add(Rf_allocVector(STRSXP, 1));
        SET_STRING_ELT(string_sexp, 0, crate::r_char!($id));
        string_sexp
    }}

}

#[macro_export]
macro_rules! r_double {
    ($id:expr) => {
        libR_sys::Rf_ScalarReal($id)
    }
}

#[macro_export]
macro_rules! r_pairlist_impl {

    ($head:expr, $tail:expr) => {{

        let head = $crate::object::RObject::from($head);
        let tail = $crate::object::RObject::from($tail);
        libR_sys::Rf_cons(*head, *tail)

    }};

}

#[macro_export]
macro_rules! r_pairlist {

    // Dotted pairlist entry.
    ($name:pat = $value:expr $(, $($tts:tt)*)?) => {{
        let value = $crate::r_pairlist_impl!($value, $crate::r_pairlist!($($($tts)*)?));
        libR_sys::SET_TAG(value, r_symbol!(stringify!($name)));
        value
    }};

    // Regular pairlist entry: recursive case.
    ($value:expr $(, $($tts:tt)*)?) => {
        $crate::r_pairlist_impl!($value, $crate::r_pairlist!($($($tts)*)?))
    };

    // Empty pairlist.
    () => {
        R_NilValue
    };

}

#[macro_export]
macro_rules! r_lang {

    ($($tts:tt)*) => {{
        let value = $crate::r_pairlist!($($tts)*);
        libR_sys::SET_TYPEOF(value, LISTSXP as i32);
        value
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

#[cfg(test)]
mod tests {
    use libR_sys::*;
    use crate::object::RObject;
    use crate::utils::r_typeof;

    use super::*;

    #[test]
    fn test_pairlist() { r_test! {

        let value = RObject::new(r_pairlist! {
            A = r_symbol!("a"),
            B = r_symbol!("b"),
            C = r_symbol!("c"),
            D = r_symbol!("d"),
        });

        assert!(CAR(*value) == r_symbol!("a"));
        assert!(CADR(*value) == r_symbol!("b"));
        assert!(CADDR(*value) == r_symbol!("c"));
        assert!(CADDDR(*value) == r_symbol!("d"));

        assert!(TAG(*value) == r_symbol!("A"));
        assert!(TAG(CDR(*value)) == r_symbol!("B"));

        let value = RObject::new(r_pairlist! {
            r_symbol!("a"),
            r_string!("b"),
            r_double!(42.0),
        });

        assert!(Rf_length(*value) == 3);

        let e1 = CAR(*value);
        assert!(r_typeof(e1) == SYMSXP);

        let e2 = CADR(*value);
        assert!(r_typeof(e2) == STRSXP);
        assert!(RObject::view(e2).to::<String>().unwrap() == "b");

        let e3 = CADDR(*value);
        assert!(r_typeof(e3) == REALSXP);
        assert!(RObject::view(e3).to::<f64>().unwrap() == 42.0);

        let value = RObject::new(r_pairlist! {});
        assert!(Rf_length(*value) == 0);

        let value = RObject::new(r_pairlist! { "a", 12, 42.0 });

        let e1 = CAR(*value);
        assert!(r_typeof(e1) == STRSXP);

        let e2 = CADR(*value);
        assert!(r_typeof(e2) == INTSXP);

        let e3 = CADDR(*value);
        assert!(r_typeof(e3) == REALSXP);

        let value = RObject::new(r_lang!("hello", A = 1, B = 2));
        assert!(r_typeof(CAR(*value)) == STRSXP);
        assert!(TAG(*value) == R_NilValue);

    }

}}

