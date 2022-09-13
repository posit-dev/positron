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

use std::sync::Mutex;
use std::sync::mpsc::Receiver;
use std::sync::mpsc::Sender;
use std::sync::mpsc::channel;
use std::time::Duration;

use parking_lot::ReentrantMutex;
use lazy_static::lazy_static;

extern "C" {
    pub static mut R_PolledEvents: Option<unsafe extern "C" fn()>;
}

#[no_mangle]
extern "C" fn r_polled_events_disabled() {

}

// Does the LSP have some tasks that it wants to execute?
// The main thread uses this flag to decide whether to
// yield execution to the LSP thread for some time.
pub static mut TASKS_PENDING: bool = false;

static mut LOCK_ACQUIRED: bool = false;

// Used by the main thread to notify the LSP when it's safe to start working.
pub static mut LSP_EXECUTION_START_RESPONSE_SENDER: Option<Mutex<Sender<()>>> = None;
pub static mut LSP_EXECUTION_START_RESPONSE_RECEIVER: Option<Mutex<Receiver<()>>> = None;

// Used by the LSP to notify the main thread when we've finished a job.
pub static mut LSP_EXECUTION_FINISHED_SENDER: Option<Mutex<Sender<()>>> = None;
pub static mut LSP_EXECUTION_FINISHED_RECEIVER: Option<Mutex<Receiver<()>>> = None;

pub unsafe fn initialize() {

    // Used by the LSP to receive a response that we can start working.
    let (sender, receiver) = channel();
    LSP_EXECUTION_START_RESPONSE_SENDER = Some(Mutex::new(sender));
    LSP_EXECUTION_START_RESPONSE_RECEIVER = Some(Mutex::new(receiver));

    let (sender, receiver) = channel();
    LSP_EXECUTION_FINISHED_SENDER = Some(Mutex::new(sender));
    LSP_EXECUTION_FINISHED_RECEIVER = Some(Mutex::new(receiver));

}

pub unsafe fn with_r_lock<T, Callback: FnMut() -> T>(mut callback: Callback) -> T {

    dlog!("Thread {:?} acquiring R lock", std::thread::current().id());

    // If we already have the lock, we can run.
    if LOCK_ACQUIRED {
        dlog!("LSP already has lock; executing callback.");
        return callback();
    }

    // Let the main thread know there's a task waiting to be executed.
    dlog!("Setting TASKS_PENDING = true.");
    TASKS_PENDING = true;

    // Wait for a response from the main thread,
    dlog!("LSP waiting for response from main thread.");
    let receiver = LSP_EXECUTION_START_RESPONSE_RECEIVER.as_ref().unwrap();
    let guard = receiver.try_lock().unwrap();
    guard.recv_timeout(Duration::from_secs(5)).unwrap();

    // Temporarily disable the polled event handler, so that we can avoid
    // recursive attempts to handle polled events.
    let polled_events = R_PolledEvents;
    R_PolledEvents = Some(r_polled_events_disabled);

    // Mark the lock as acquired.
    LOCK_ACQUIRED = true;

    // Do some work.
    dlog!("LSP received response; about to do work.");
    let result = callback();
    dlog!("LSP finished doing work.");

    // Release the lock.
    LOCK_ACQUIRED = false;

    // Restore the polled event handler.
    R_PolledEvents = polled_events;

    // Let the R session know we're done.
    let sender = LSP_EXECUTION_FINISHED_SENDER.as_ref().unwrap();
    let guard = sender.try_lock().unwrap();
    guard.send(()).unwrap();
    dlog!("LSP has notified main thread it's finished.");

    // Let front-end know we're done working.
    dlog!("Setting TASKS_PENDING = false.");
    TASKS_PENDING = false;

    // Return the result.
    return result;

}

macro_rules! r_lock {

    ($($expr:tt)*) => {
        unsafe {
            $crate::r::lock::with_r_lock(|| { $($expr)* })
        }
    }

}
pub(crate) use r_lock;

use crate::lsp::logger::dlog;

lazy_static! {

    // A lock, controlling threaded access to the R interpreter.
    //
    // Needed because the LSP might execute different tasks concurrently
    // on different threads, but we want to make sure only one task can
    // interact with the interpreter at a time.
    pub static ref LOCK: ReentrantMutex<()> = ReentrantMutex::new(());

}
