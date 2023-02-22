//
// interrupts.rs
//
// Copyright (C) 2022 by Posit Software, PBC
//
//

use libR_sys::*;

static mut R_INTERRUPTS_SUSPENDED: i32 = 0;

pub struct RInterruptsSuspendedScope
{
    suspended: Rboolean,
}

impl RInterruptsSuspendedScope {

    pub unsafe fn new() -> RInterruptsSuspendedScope {
        let suspended = R_interrupts_suspended;
        R_interrupts_suspended = 1;
        R_INTERRUPTS_SUSPENDED += 1;
        RInterruptsSuspendedScope { suspended }
    }

}

impl Drop for RInterruptsSuspendedScope {

    fn drop(&mut self) { unsafe {
        R_INTERRUPTS_SUSPENDED -= 1;
        if R_INTERRUPTS_SUSPENDED == 0 {
            R_interrupts_suspended = self.suspended;
        }
    }}

}
