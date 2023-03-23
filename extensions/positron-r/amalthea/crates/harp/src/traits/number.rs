//
// number.rs
//
// Copyright (C) 2022 Posit Software, PBC. All rights reserved.
//
//

pub trait Number {}

impl Number for u8 {}
impl Number for u16 {}
impl Number for u32 {}
impl Number for u64 {}

impl Number for i8 {}
impl Number for i16 {}
impl Number for i32 {}
impl Number for i64 {}

impl Number for f32 {}
impl Number for f64 {}

