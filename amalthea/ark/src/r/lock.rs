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

pub struct RLockGuard {
    polled_events: Option<unsafe extern "C" fn()>
}

impl RLockGuard {

    pub fn lock() -> Self {

        let mut this = Self { polled_events: None };
        unsafe { this.lock_impl() };
        return this;

    }

    unsafe fn lock_impl(&mut self) {

        dlog!("Thread {:?} acquiring R lock", std::thread::current().id());

        // Acquire the lock.
        let _guard = LOCK.lock();

        // Let the main thread know there's a task waiting to be executed.
        TASKS_PENDING = true;

        // Wait for a response from the main thread,
        dlog!("Child thread waiting for response from main thread.");
        let receiver = INIT_RECV.as_ref().unwrap();
        let guard = receiver.try_lock().unwrap();
        guard.recv_timeout(Duration::from_secs(5)).unwrap();

        // Disable the polled event handler in this scope.
        // This ensures that we don't try to recursively process polled events.
        self.polled_events = R_PolledEvents;
        R_PolledEvents = Some(r_polled_events_disabled);


    }

    unsafe fn drop_impl(&mut self) {

        // Let the R session know we're done.
        let sender = FINI_SEND.as_ref().unwrap();
        let guard = sender.try_lock().unwrap();
        guard.send(()).unwrap();
        dlog!("Child thread has notified main thread it's finished.");

        // Let front-end know we're done working.
        TASKS_PENDING = false;

        // Restore the polled event handler.
        R_PolledEvents = self.polled_events;

    }


}

impl Drop for RLockGuard {

    fn drop(&mut self) {
        unsafe { self.drop_impl() };
    }

}

pub unsafe fn initialize() {

    let (sender, receiver) = channel();
    INIT_SEND = Some(Mutex::new(sender));
    INIT_RECV = Some(Mutex::new(receiver));

    let (sender, receiver) = channel();
    FINI_SEND = Some(Mutex::new(sender));
    FINI_RECV = Some(Mutex::new(receiver));

}

macro_rules! r_lock {

    ($($expr:tt)*) => {{
        let _guard = $crate::r::lock::RLockGuard::lock();
        unsafe { $($expr)* }
    }}

}
pub(crate) use r_lock;
