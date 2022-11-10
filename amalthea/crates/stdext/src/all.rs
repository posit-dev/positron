//
// all.rs
//
// Copyright (C) 2022 by Posit, PBC
//
//

#[macro_export]
macro_rules! all {
    ($($expr:expr$(,)?)*) => {{
        let result = true;
        $(let result = result && $expr;)*
        result
    }}
}

#[cfg(test)]
mod tests {

    #[test]
    fn test_all() {
        assert!(all!() == true);
        assert!(all!(false, false true) == false);
        assert!(all!(true, false) == false);
        assert!(all!(true true) == true);
    }

}

