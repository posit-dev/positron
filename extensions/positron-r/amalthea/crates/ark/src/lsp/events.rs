//
// events.rs
//
// Copyright (C) 2022 Posit Software, PBC. All rights reserved.
//
//

use once_cell::sync::Lazy;
use stdext::event::Event;

#[derive(Default)]
pub struct Events {
    pub console_prompt: Event<()>,
}

pub static EVENTS: Lazy<Events> = Lazy::new(|| Events::default());
