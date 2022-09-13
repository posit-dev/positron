//
// lock.rs
//
// Copyright (C) 2022 by RStudio, PBC
//
//

// NOTE: All execution of R code should first attempt to acquire
// this lock before execution. The Ark LSP's execution model allows
// arbitrary threads and tasks to communicate with the R session,
// and we mediate that via synchronization using a pair of channels
// used to signal the start + end of code execution in a thread.

use std::sync::Mutex;
use std::sync::mpsc::Receiver;
use std::sync::mpsc::Sender;
use std::sync::mpsc::channel;
use std::time::Duration;

use parking_lot::ReentrantMutex;

use crate::lsp::logger::dlog;

extern "C" {
    pub static mut R_PolledEvents: Option<unsafe extern "C" fn()>;
}

#[no_mangle]
extern "C" fn r_polled_events_disabled() {

}

// The thread currently holding the runtime lock.
static mut LOCK : ReentrantMutex<()> = ReentrantMutex::new(());

// Child threads can set this to notify the main thread
// that there is work to be done that requires access
// to the R runtime.
pub static mut TASKS_PENDING: bool = false;

// Channels used by the main thread to notify a child thread
// that is can now safely use the R runtime.
pub static mut INIT_SEND: Option<Mutex<Sender<()>>> = None;
pub static mut INIT_RECV: Option<Mutex<Receiver<()>>> = None;

// Channels used by the child threads to notify the main
// thread that it can now resume control.
pub static mut FINI_SEND: Option<Mutex<Sender<()>>> = None;
pub static mut FINI_RECV: Option<Mutex<Receiver<()>>> = None;

pub unsafe fn initialize() {

    let (sender, receiver) = channel();
    INIT_SEND = Some(Mutex::new(sender));
    INIT_RECV = Some(Mutex::new(receiver));

    let (sender, receiver) = channel();
    FINI_SEND = Some(Mutex::new(sender));
    FINI_RECV = Some(Mutex::new(receiver));

}

pub unsafe fn with_r_lock<T, Callback: FnMut() -> T>(mut callback: Callback) -> T {

    dlog!("Thread {:?} acquiring R lock", std::thread::current().id());

    // Acquire the lock.
    let _guard = LOCK.lock();

    // If we already have the lock, we can run.
    if TASKS_PENDING {
        dlog!("Child thread already has lock; executing callback.");
        return callback();
    }

    // Let the main thread know there's a task waiting to be executed.
    TASKS_PENDING = true;

    // Wait for a response from the main thread,
    dlog!("Child thread waiting for response from main thread.");
    let receiver = INIT_RECV.as_ref().unwrap();
    let guard = receiver.try_lock().unwrap();
    guard.recv_timeout(Duration::from_secs(5)).unwrap();

    // Temporarily disable the polled event handler, so that we can avoid
    // recursive attempts to handle polled events.
    let polled_events = R_PolledEvents;
    R_PolledEvents = Some(r_polled_events_disabled);

    // Do some work.
    let result = callback();

    // Restore the polled event handler.
    R_PolledEvents = polled_events;

    // Let the R session know we're done.
    let sender = FINI_SEND.as_ref().unwrap();
    let guard = sender.try_lock().unwrap();
    guard.send(()).unwrap();
    dlog!("Child thread has notified main thread it's finished.");

    // Let front-end know we're done working.
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
