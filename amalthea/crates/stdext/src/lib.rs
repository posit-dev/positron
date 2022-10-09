//
// lib.rs
//
// Copyright (C) 2022 by RStudio, PBC
//
//

pub mod join;
pub mod unwrap;

#[macro_export]
macro_rules! cargs {

    ($($expr:expr),*) => {{
        use stdext::cstr;
        std::vec![$($crate::cstr!($expr)),*]
    }};

}


#[macro_export]
macro_rules! cstr {

    ($value:literal) => {{
        use std::os::raw::c_char;
        let value = std::concat!($value, "\0");
        value.as_ptr() as *mut c_char
    }};

    ($value:expr) => {{
        use std::os::raw::c_char;
        let value = [$value, "\0"].concat();
        value.as_ptr() as *mut c_char
    }};
}
