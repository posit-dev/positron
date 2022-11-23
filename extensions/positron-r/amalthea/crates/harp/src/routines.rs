//
// protect.rs
//
// Copyright (C) 2022 by Posit, PBC
//
//

use libR_sys::*;
use stdext::cstr;

pub fn initialize() {
    unsafe { register_methods() };
}

#[no_mangle]
pub extern "C" fn example() -> *mut std::os::raw::c_void {
    panic!("I guess it worked!");
}

pub unsafe fn register_methods() {

    let mut routines : Vec<R_CallMethodDef> = vec![];

    // for testing
    routines.push(R_CallMethodDef {
        name: cstr!("rs_example"),
        fun: Some(example),
        numArgs: 0,
    });

    // end with a null struct
    routines.push(R_CallMethodDef {
        name: std::ptr::null(),
        fun: None,
        numArgs: 0,
    });

    let info = R_getEmbeddingDllInfo();
    R_registerRoutines(info, std::ptr::null(), routines.as_ptr(), std::ptr::null(), std::ptr::null());

}
