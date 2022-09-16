//
// lock.rs
//
// Copyright (C) 2022 by RStudio, PBC
//
//

// The R lock is to be used by threads which wish to access the R runtime. The
// main thread owns access to the R runtime by default, but it can yield access
// to other threads through the use of the facilities in this module.
//
// Threads will then be given an opportunity to execute code in the next call
// made by R to the R_PolledEvents event handler, which happens quite frequently
// (usually via R_ProcessEvents).

use parking_lot::ReentrantMutex;
use parking_lot::ReentrantMutexGuard;

use crate::lsp::logger::dlog;

extern "C" {
    pub static mut R_PolledEvents: Option<unsafe extern "C" fn()>;
}

#[no_mangle]
pub extern "C" fn r_polled_events_disabled() {

}

// A re-entrant mutex, to ensure only one thread can access
// the R runtime at a time.
pub static mut R_RUNTIME_LOCK : ReentrantMutex<()> = ReentrantMutex::new(());

// A global lock guard, to be used with R_RUNTIME_LOCK. Global because R
// runtime methods need access.
pub static mut R_RUNTIME_LOCK_GUARD: Option<ReentrantMutexGuard<()>> = None;

// Child threads can set this to notify the main thread that there is work to be
// done that requires access to the R runtime. The main thread will check this
// flag when R_ProcessEvents is called, and if set, the main thread will then
// yield control to the child thread requesting access.
pub static mut R_RUNTIME_TASKS_PENDING: bool = false;

macro_rules! r_lock {

    ($($expr:tt)*) => {{

        // Let the logger know we're taking the lock.
        dlog!("Thread {:?} is requesting R runtime lock.", std::thread::current().id());
        let now = std::time::SystemTime::now();

        // Let the main thread know tasks are pending.
        unsafe { $crate::r::lock::R_RUNTIME_TASKS_PENDING = true };

        // Wait until we can get the runtime lock.
        unsafe { $crate::r::lock::R_RUNTIME_LOCK_GUARD = Some($crate::r::lock::R_RUNTIME_LOCK.lock()) };

        dlog!("Thread {:?} obtained lock after waiting for {} milliseconds.", std::thread::current().id(), now.elapsed().unwrap().as_millis());

        // Disable polled events in this scope.
        let polled_events = unsafe { $crate::r::lock::R_PolledEvents };
        unsafe { $crate::r::lock::R_PolledEvents = Some($crate::r::lock::r_polled_events_disabled) };

        // Execute the wrapped code.
        let result = unsafe { $($expr)* };

        // Restore the polled events handler.
        unsafe { $crate::r::lock::R_PolledEvents = polled_events };

        // Release the runtime lock.
        unsafe { $crate::r::lock::R_RUNTIME_LOCK_GUARD = None };

        // Tasks are no longer pending.
        unsafe { $crate::r::lock::R_RUNTIME_TASKS_PENDING = false };

        // Let the logger know we've released the lock..
        dlog!("Thread {:?} has released the R runtime lock.", std::thread::current().id());

        // Return the resulting expression.
        result

    }}

}
pub(crate) use r_lock;
