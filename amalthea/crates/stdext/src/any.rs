//
// all.rs
//
// Copyright (C) 2022 by Posit, PBC
//
//

#[macro_export]
macro_rules! any {
    ($($expr:expr)*) => {{
        let result = false;
        $(let result = result || $expr;)*
        result
    }}
}

#[cfg(test)]
mod tests {

    #[test]
    fn test_any() {
        assert!(any!() == false);
        assert!(any!(false false) == false);
        assert!(any!(true false) == true);
        assert!(any!(true true) == true);
    }

}

