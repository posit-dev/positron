
//
// signals.rs
//
// Copyright (C) 2022 Posit Software, PBC. All rights reserved.
//
//

use std::sync::Arc;

use once_cell::sync::Lazy;
use parking_lot::Mutex;
use stdext::signals::Signal;

#[derive(Default)]
pub struct Signals {
    pub console_prompt: Signal<()>,
}

pub static SIGNALS: Lazy<Arc<Mutex<Signals>>> = Lazy::new(|| {
    Arc::new(Mutex::new(Signals::default()))
});
