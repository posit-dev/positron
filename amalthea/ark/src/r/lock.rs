//
// lock.rs
//
// Copyright (C) 2022 by RStudio, PBC
//
//

// NOTE: All execution of R code should first attempt to acquire
// this lock before execution. The Ark LSP's execution model allows
// arbitrary threads and tasks to communicate with the R session,
// and we mediate that through a global execution lock which must be
// held when interacting with R.

use lazy_static::lazy_static;
use parking_lot::ReentrantMutex;

macro_rules! rlock {

    ($($expr:tt)*) => {{
        let _guard = $crate::r::lock::LOCK.lock();
        unsafe { $($expr)* }
    }}

}
pub(crate) use rlock;

lazy_static! {
    pub static ref LOCK: ReentrantMutex<()> = ReentrantMutex::new(());
}
