//
// lib.rs
//
// Copyright (C) 2022 Posit Software, PBC. All rights reserved.
//
//

pub mod all;
pub mod any;
pub mod case;
pub mod event;
pub mod join;
pub mod local;
pub mod ok;
pub mod push;
pub mod spawn;
pub mod unwrap;

pub use crate::join::Joined;
pub use crate::ok::Ok;
pub use crate::push::Push;
pub use crate::unwrap::IntoOption;
pub use crate::unwrap::IntoResult;

#[macro_export]
macro_rules! cargs {

    ($($expr:expr),*) => {{
        vec![$($crate::cstr!($expr)),*]
    }};

}

#[macro_export]
macro_rules! cstr {
    ($value:literal) => {{
        use std::os::raw::c_char;
        let value = concat!($value, "\0");
        value.as_ptr() as *mut c_char
    }};
}

#[cfg(test)]
mod tests {

    use std::os::raw::c_char;

    use super::*;

    #[test]
    fn test_cstr() {
        let string = cstr!("Hello");
        assert_eq!(string, b"Hello\0".as_ptr() as *mut c_char);
    }
}
