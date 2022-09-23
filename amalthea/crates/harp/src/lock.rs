//
// lock.rs
//
// Copyright (C) 2022 by RStudio, PBC
//
//

use std::sync::Mutex;
use std::sync::MutexGuard;
use std::sync::Once;

use log::info;

// The R lock is to be used by threads which wish to access the R runtime. The
// main thread owns access to the R runtime by default, but it can yield access
// to other threads through the use of the facilities in this module.
//
// Threads will then be given an opportunity to execute code in the next call
// made by R to the R_PolledEvents event handler, which happens quite frequently
// (usually via R_ProcessEvents).

extern "C" {
    pub static mut R_PolledEvents: Option<unsafe extern "C" fn()>;
}

#[no_mangle]
pub extern "C" fn r_polled_events_disabled() {

}

// A re-entrant mutex, to ensure only one thread can access
// the R runtime at a time.
pub static mut R_RUNTIME_LOCK_ONCE : Once = Once::new();
pub static mut R_RUNTIME_LOCK : Option<Mutex<()>> = None;

// A global lock guard, to be used with R_RUNTIME_LOCK. Global because R
// runtime methods need access.
pub static mut R_RUNTIME_LOCK_GUARD: Option<MutexGuard<()>> = None;

// Child threads can set this to notify the main thread that there is work to be
// done that requires access to the R runtime. The main thread will check this
// flag when R_ProcessEvents is called, and if set, the main thread will then
// yield control to the child thread requesting access.
pub static mut R_RUNTIME_TASKS_PENDING: bool = false;

pub fn with_r_lock<T, F: FnMut() -> T>(mut callback: F) -> T {

    // Perform one-time initialization of the runtime lock.
    unsafe {
        R_RUNTIME_LOCK_ONCE.call_once(|| {
            R_RUNTIME_LOCK = Some(Mutex::new(()));
        });
    }

    // Let the logger know we're taking the lock.
    let id = std::thread::current().id();
    info!("Thread {:?} is requesting R runtime lock.", id);

    // Record how long it takes the acquire the lock.
    let now = std::time::SystemTime::now();

    // Let the main thread know tasks are pending.
    unsafe { R_RUNTIME_TASKS_PENDING = true };

    // Wait until we can get the runtime lock.
    unsafe { R_RUNTIME_LOCK_GUARD = Some(R_RUNTIME_LOCK.as_ref().unwrap_unchecked().lock().unwrap()) };

    // Log how long we were stuck waiting.
    let elapsed = now.elapsed().unwrap().as_millis();
    info!("Thread {:?} obtained lock after waiting for {} milliseconds.", id, elapsed);

    // Disable polled events in this scope.
    let polled_events = unsafe { R_PolledEvents };
    unsafe { R_PolledEvents = Some(r_polled_events_disabled) };

    // Execute the callback.
    let now = std::time::SystemTime::now();
    let result = callback();

    // Restore the polled events handler.
    unsafe { R_PolledEvents = polled_events };

    // Release the runtime lock.
    unsafe { R_RUNTIME_LOCK_GUARD = None };

    // Tasks are no longer pending.
    unsafe { R_RUNTIME_TASKS_PENDING = false };

    // Let the logger know we've released the lock..
    let elapsed = now.elapsed().unwrap().as_millis();
    info!("Thread {:?} has released the R runtime lock after {} milliseconds.", id, elapsed);

    // Return the resulting expression.
    result


}

