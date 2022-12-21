//
// case.rs
//
// Copyright (C) 2022 by Posit Software, PBC
//
//

#[macro_export]
macro_rules! case {

    (
        $($cnd:expr => $result:expr$(,)?)+
        => $default:expr
    ) => {

        $crate::local! {

            $(
                if $cnd { return $result }
            )*

            $default

        }
    }

}


#[cfg(test)]
mod tests {

    #[test]
    fn test_case() {

        let x = 42;
        let result = case! {
            x < 42  => "apple",
            x > 42  => "banana",
            x == 42 => "cherry",
            => "danish"
        };

        assert!(result == "cherry");

    }

}


