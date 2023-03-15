
//
// signals.rs
//
// Copyright (C) 2022 Posit Software, PBC. All rights reserved.
//
//

use once_cell::sync::Lazy;
use stdext::signals::Signal;

#[derive(Default)]
pub struct Signals {
    pub console_prompt: Signal<()>,
}

pub static SIGNALS: Lazy<Signals> = Lazy::new(|| {
    Signals::default()
});
