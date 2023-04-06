//
// spawn.rs
//
// Copyright (C) 2023 Posit Software, PBC. All rights reserved.
//
//

#[macro_export]
macro_rules! spawn {
    ($name:expr, $body:expr) => {
        std::thread::Builder::new()
            .name($name.to_string())
            .spawn($body)
            .unwrap()
    };
}