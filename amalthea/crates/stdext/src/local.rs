//
// local.rs
//
// Copyright (C) 2022 by RStudio, PBC
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
