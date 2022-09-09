//
// mod.rs
//
// Copyright (C) 2022 by RStudio, PBC
//
//

// NOTE: Routines here which need to interact with R are marked as unsafe,
// to indiciate that they require calling back to R. When calling such
// unsafe methods, calls should be made within a call to the 'rlock!'
// macro, which ensures that the current thread has exclusive access to
// the R interpreter. 'rlock!' uses a recursive mutex, so re-entrant or
// recursive calls to 'rlock!' can still be safe if necessary.

pub mod error;
pub mod exec;
pub mod lock;
pub mod macros;
pub mod modules;
pub mod object;
pub mod protect;
pub mod test;
pub mod traits;
pub mod utils;
