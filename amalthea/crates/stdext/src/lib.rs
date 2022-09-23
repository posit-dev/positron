//
// lib.rs
//
// Copyright (C) 2022 by RStudio, PBC
//
//

#[macro_export]
macro_rules! cstr {
    ($value:literal) => {{
        use std::os::raw::c_char;
        let value = concat!($value, "\0");
        value.as_ptr() as *mut c_char
    }};

    ($value:expr) => {{
        use std::os::raw::c_char;
        let value = [$value, "\0"].concat();
        value.as_ptr() as *mut c_char
    }};
}

#[macro_export]
macro_rules! cargs {

    ($($expr:expr),*) => {{
        use stdext::cstr;
        vec![$(cstr!($expr)),*]
    }};

}

#[cfg(test)]
mod tests {
    #[test]
    fn it_works() {
        let result = 2 + 2;
        assert_eq!(result, 4);
    }
}
