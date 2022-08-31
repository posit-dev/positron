// 
// test.rs
// 
// Copyright (C) 2022 by RStudio, PBC
// 
// 

// Helper functions for ensuring R is runing before running tests
// that rely on an R session being available.

// TODO: Rust isn't smart enough to see that these methods are used in tests?
// We explicitly disable the warnings here since 'start_r()' is used by tests
// in other files.
#![allow(dead_code)]

use std::process::Command;
use std::sync::Once;

use libR_sys::*;

use crate::macros::cargs;
use crate::macros::cstr;

static INIT: Once = Once::new();

pub fn start_r() {

    INIT.call_once(|| {

        // TODO: Right now, tests can fail if the version of R discovered
        // on the PATH, and the version of R that 'ark' linked to at compile
        // time, do not match. We could relax this requirement by allowing
        // 'ark' to have undefined symbols, and use the DYLD_INSERT_LIBRARIES
        // trick to insert the right version of R when 'ark' is launched,
        // but for now we just have this comment as a reminder.

        // Set up R_HOME if necessary.
        if let Err(_) = std::env::var("R_HOME") {
            let result = Command::new("R").arg("RHOME").output().unwrap();
            let home = String::from_utf8(result.stdout).unwrap();
            std::env::set_var("R_HOME", home.trim());
        }

        // Build the argument list for Rf_initialize_R
        let mut arguments = cargs!["R", "--slave", "--no-save", "--no-restore"];

        unsafe {
            Rf_initialize_R(arguments.len() as i32, arguments.as_mut_ptr() as *mut *mut ::std::os::raw::c_char);
            setup_Rmainloop();
        }
    });
    
}
