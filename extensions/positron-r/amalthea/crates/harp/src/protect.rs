//
// protect.rs
//
// Copyright (C) 2022 Posit Software, PBC. All rights reserved.
//
//

use libR_sys::*;

// NOTE: The RProtect struct uses R's stack-based object protection, and so is
// only appropriate for R objects with 'automatic' lifetime. In general, this
// should only be used when interfacing with native R APIs; general usages
// should use the RObject struct instead.
pub struct RProtect {
    count: i32,
}

impl RProtect {

    /// SAFETY: Assumes that the R lock is held.
    pub unsafe fn new() -> Self {
        Self { count: 0 }
    }

    /// SAFETY: Assumes that the R lock is held.
    pub unsafe fn add(&mut self, object: SEXP) -> SEXP {
        self.count += 1;
        return Rf_protect(object);
    }

}

impl Drop for RProtect {

    /// SAFETY: Assumes that the R lock is held.
    fn drop(&mut self) {
        unsafe { Rf_unprotect(self.count) }
    }
}
