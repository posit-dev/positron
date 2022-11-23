//
// protect.rs
//
// Copyright (C) 2022 by Posit, PBC
//
//

use std::ffi::CStr;
use std::os::raw::c_void;

use libR_sys::*;
use log::error;
use log::info;
use stdext::cstr;

static mut R_ROUTINES : Vec<R_CallMethodDef> = Vec::new();

pub unsafe fn r_add_routine(name: &str, routine: *const (), nargs: i32) {

    info!("Adding routine: {}", name);
    let fun = std::mem::transmute::<*const (), unsafe extern "C" fn() -> *mut c_void>(routine as _);

    let name = Box::new(cstr!(name));
    R_ROUTINES.push(R_CallMethodDef {
        name: cstr!(name),
        fun: Some(fun),
        numArgs: nargs,
    });

}

pub unsafe fn r_register_routines() {

    // end with a null struct
    R_ROUTINES.push(R_CallMethodDef {
        name: std::ptr::null(),
        fun: None,
        numArgs: 0,
    });

    let info = R_getEmbeddingDllInfo();
    if info.is_null() {
        error!("internal error: no embedding DllInfo available");
        return;
    }

    for routine in R_ROUTINES.iter() {
        let name = CStr::from_ptr(routine.name);
        info!("Routine name: '{}'", name.to_string_lossy());
    }

    info!("Registering embedded routines: {:#?}", R_ROUTINES);
    R_registerRoutines(info, std::ptr::null(), R_ROUTINES.as_ptr(), std::ptr::null(), std::ptr::null());

}
