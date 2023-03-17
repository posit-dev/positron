//
// environment.rs
//
// Copyright (C) 2022 Posit Software, PBC. All rights reserved.
//
//

use std::cmp::Ordering;

use libR_sys::*;

use crate::symbol::RSymbol;
use crate::utils::r_typeof;

#[derive(Debug, Eq, PartialEq)]
pub enum BindingKind {
    Regular,
    // Active,
    Promise(bool),
    // Immediate,
}

#[derive(Debug, Eq, PartialEq)]
pub struct Binding {
    pub name: RSymbol,
    pub binding: SEXP,
    pub kind: BindingKind
}

impl Ord for Binding {
    fn cmp(&self, other: &Self) -> Ordering {
        self.name.cmp(&other.name)
    }
}

impl PartialOrd for Binding {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Binding {
    pub fn new(frame: SEXP) -> Self {

        let name = RSymbol::new(unsafe {TAG(frame)});
        let binding = unsafe {CAR(frame)};
        let kind = match unsafe {r_typeof(binding)} {
            PROMSXP => BindingKind::Promise(unsafe {PRVALUE(binding) != R_UnboundValue}),

            // TODO: Active and Immediate
            _ => BindingKind::Regular
        };

        Self {
            name,
            binding,
            kind
        }
    }
}

pub fn env_bindings(env: SEXP) -> Vec<Binding> {
    unsafe {
        let mut bindings : Vec<Binding> = vec![];

        // 1: traverse the envinronment
        let hash  = HASHTAB(env);
        if hash == R_NilValue {
            frame_bindings(FRAME(env), &mut bindings);
        } else {
            let n = XLENGTH(hash);
            for i in 0..n {
                frame_bindings(VECTOR_ELT(hash, i), &mut bindings);
            }
        }

        bindings
    }
}

unsafe fn frame_bindings(mut frame: SEXP, bindings: &mut Vec<Binding> ) {
    while frame != R_NilValue {
        bindings.push(Binding::new(frame));

        frame = CDR(frame);
    }
}
