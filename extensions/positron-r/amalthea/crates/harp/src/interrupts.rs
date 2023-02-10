//
// interrupts.rs
//
// Copyright (C) 2022 by Posit Software, PBC
//
//

use libR_sys::*;

pub struct RInterruptsSuspendedScope
{
    suspended: Rboolean,
}

impl RInterruptsSuspendedScope {

    pub fn new() -> RInterruptsSuspendedScope {
        let suspended = unsafe { R_interrupts_suspended };
        RInterruptsSuspendedScope { suspended }
    }

}

impl Drop for RInterruptsSuspendedScope {

    fn drop(&mut self) {
        unsafe { R_interrupts_suspended = self.suspended }
    }

}
