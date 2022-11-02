//
// local.rs
//
// Copyright (C) 2022 by Posit, PBC
//
//

#[macro_export]
macro_rules! local {
    ($($tokens:tt)*) => {
        (|| {
            $($tokens)*
        })()
    }
}
