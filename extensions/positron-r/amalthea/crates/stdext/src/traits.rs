//
// traits.rs
//
// Copyright (C) 2022 Posit Software, PBC. All rights reserved.
//
//

pub trait TypesEqual {}
impl<T> TypesEqual for (T, T) {}
