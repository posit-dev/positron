//
// routines.rs
//
// Copyright (C) 2022 by Posit, PBC
//
//

use libR_sys::*;
use log::error;
use log::info;

static mut R_ROUTINES : Vec<R_CallMethodDef> = vec![];

// NOTE: This function is used via the #[harp::register] macro,
// which ensures that routines are initialized and executed on
// application startup.
pub unsafe fn add(def: R_CallMethodDef) {
    R_ROUTINES.push(def);
}

pub unsafe fn r_register_routines() {

    let info = R_getEmbeddingDllInfo();
    if info.is_null() {
        error!("internal error: no embedding DllInfo available");
        return;
    }

    // Transform into version expected by R.
    //
    // Note that we use this sort of secondary indirection to ensure that
    // the C strings for e.g. routine names remain alive through the lifetime
    // of the application. In theory, we could use static C strings and some
    // clever Rust macros to accomplish something similar, but this was the
    // most straightforward way to make progress for now.
    let routines = &mut R_ROUTINES;

    // Make sure we have an "empty" routine at the end.
    routines.push(R_CallMethodDef {
        name: std::ptr::null(),
        fun: None,
        numArgs: 0
    });

    info!("Registering embedded routines: {:#?}", routines);
    R_registerRoutines(info, std::ptr::null(), routines.as_ptr(), std::ptr::null(), std::ptr::null());

}

