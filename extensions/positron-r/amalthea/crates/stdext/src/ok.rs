//
// ok.rs
//
// Copyright (C) 2022 Posit Software, PBC. All rights reserved.
//
//

pub trait Ok<T, E> {
    fn ok(self) -> Result<T, E>;
}

impl<T, E> Ok<T, E> for T {
    fn ok(self) -> Result<T, E> {
        Ok(self)
    }
}
