//
// routines.rs
//
// Copyright (C) 2022 by Posit, PBC
//
//

use std::ffi::CString;
use std::ffi::c_void;
use std::sync::Arc;
use std::sync::Mutex;

use lazy_static::lazy_static;
use libR_sys::*;
use log::error;
use log::info;

struct RCallRoutine {
    pub name: CString,
    pub func: Option<unsafe extern "C" fn() -> *mut c_void>,
    pub nargs: i32,
}

lazy_static! {
    static ref R_ROUTINES: Arc<Mutex<Vec<RCallRoutine>>> = Arc::new(Default::default());
}

pub unsafe fn r_add_call_method(name: &str, func: unsafe extern "C" fn() -> SEXP, nargs: i32) {

    let mut routines = R_ROUTINES.lock().unwrap();
    let func = std::mem::transmute(func);
    routines.push(RCallRoutine {
        name: CString::new(name).unwrap(),
        func: Some(func),
        nargs: nargs,
    })
}

pub unsafe fn r_register_routines() {

    let info = R_getEmbeddingDllInfo();
    if info.is_null() {
        error!("internal error: no embedding DllInfo available");
        return;
    }

    // Collect our routines.
    let routines = R_ROUTINES.lock().unwrap();

    // Transform into version expected by R.
    //
    // Note that we use this sort of secondary indirection to ensure that
    // the C strings for e.g. routine names remain alive through the lifetime
    // of the application. In theory, we could use static C strings and some
    // clever Rust macros to accomplish something similar, but this was the
    // most straightforward way to make progress for now.
    let mut routines = routines.iter().map(|routine| {
        R_CallMethodDef {
            name: routine.name.as_ptr(),
            fun: routine.func,
            numArgs: routine.nargs,
        }
    }).collect::<Vec<_>>();

    // Make sure we have an "empty" routine at the end.
    routines.push(R_CallMethodDef {
        name: std::ptr::null(),
        fun: None,
        numArgs: 0
    });

    info!("Registering embedded routines: {:#?}", routines);
    R_registerRoutines(info, std::ptr::null(), routines.as_ptr(), std::ptr::null(), std::ptr::null());

}

