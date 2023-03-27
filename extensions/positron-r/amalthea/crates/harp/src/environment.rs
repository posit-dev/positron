//
// environment.rs
//
// Copyright (C) 2022 Posit Software, PBC. All rights reserved.
//
//

use std::cmp::Ordering;

use c2rust_bitfields::BitfieldStruct;
use libR_sys::*;

use crate::object::RObject;
use crate::symbol::RSymbol;
use crate::utils::r_typeof;
use crate::vector::CharacterVector;
use crate::vector::IntegerVector;
use crate::vector::LogicalVector;
use crate::vector::NumericVector;
use crate::vector::RawVector;
use itertools::Itertools;

#[derive(Copy, Clone, BitfieldStruct)]
#[repr(C)]
pub struct Sxpinfo {
    #[bitfield(name = "rtype", ty = "libc::c_uint", bits = "0..=4")]
    #[bitfield(name = "scalar", ty = "libc::c_uint", bits = "5..=5")]
    #[bitfield(name = "obj", ty = "libc::c_uint", bits = "6..=6")]
    #[bitfield(name = "alt", ty = "libc::c_uint", bits = "7..=7")]
    #[bitfield(name = "gp", ty = "libc::c_uint", bits = "8..=23")]
    #[bitfield(name = "mark", ty = "libc::c_uint", bits = "24..=24")]
    #[bitfield(name = "debug", ty = "libc::c_uint", bits = "25..=25")]
    #[bitfield(name = "trace", ty = "libc::c_uint", bits = "26..=26")]
    #[bitfield(name = "spare", ty = "libc::c_uint", bits = "27..=27")]
    #[bitfield(name = "gcgen", ty = "libc::c_uint", bits = "28..=28")]
    #[bitfield(name = "gccls", ty = "libc::c_uint", bits = "29..=31")]
    #[bitfield(name = "named", ty = "libc::c_uint", bits = "32..=47")]
    #[bitfield(name = "extra", ty = "libc::c_uint", bits = "48..=63")]
    pub rtype_scalar_obj_alt_gp_mark_debug_trace_spare_gcgen_gccls_named_extra: [u8; 8],
}

pub static mut ACTIVE_BINDING_MASK: libc::c_uint = 1 << 15;

fn is_active_binding(frame: SEXP) -> bool {
    unsafe {
        (frame as *mut Sxpinfo).as_ref().unwrap().gp() & ACTIVE_BINDING_MASK != 0
    }
}

#[derive(Debug, Eq, PartialEq)]
pub enum BindingKind {
    Regular,
    Active,
    Promise(bool),
    // Immediate,
}

#[derive(Debug, Eq, PartialEq)]
pub struct Binding {
    pub name: RSymbol,
    pub value: SEXP,
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
        let value = unsafe {CAR(frame)};

        let kind = if is_active_binding(frame) {
            BindingKind::Active
        } else {
            match r_typeof(value) {
                PROMSXP => BindingKind::Promise(unsafe {PRVALUE(value) != R_UnboundValue}),

                // TODO: Immediate
                _ => BindingKind::Regular
            }
        };

        Self {
            name, value, kind
        }
    }

    pub fn describe(&self) -> String {

        match self.kind {
            BindingKind::Active => String::from("active binding"),
            BindingKind::Regular => describe_regular_binding(self.value),
            BindingKind::Promise(false) => String::from("promise"),
            BindingKind::Promise(true) => describe_regular_binding(unsafe{PRVALUE(self.value)})
        }
    }

}

fn describe_regular_binding(value: SEXP) -> String {
    if unsafe{ALTREP(value) != 0} {
        return describe_altrep(value);
    }

    // TODO: some form of R based dispatch

    match r_typeof(value) {
        // standard vector
        LGLSXP   => describe_vec(value),
        INTSXP   => describe_vec(value),
        REALSXP  => describe_vec(value),
        CPLXSXP  => describe_vec(value),
        STRSXP   => describe_vec(value),
        VECSXP   => {
            // TODO: data.frame
            describe_vec(value)
        },

        _       => String::from("???")
    }

}

fn vec_type(value: SEXP) -> String {
    let rtype = match r_typeof(value) {
        INTSXP  => "int",
        REALSXP => "dbl",
        LGLSXP  => "lgl",
        STRSXP  => "str",
        VECSXP  => "list",
        RAWSXP  => "raw",
        CPLXSXP => "cplx",

        // TODO: this should not happen
        _       => "???"
    };
    String::from(rtype)
}

fn describe_altrep(value: SEXP) -> String {
    // TODO: have something to differentiate altrep from standard
    //       we used to show the altrep class, e.g. base::compact_int*,
    //       but this takes a lot of real estate
    let glimpsed = altrep_vec_glimpse(value);
    let suffix = if glimpsed.0 {
        " (...)"
    } else {
        ""
    };
    format!("{} [{}] {}{}", vec_type(value), vec_shape(value), glimpsed.1, suffix)
}

fn describe_vec(value: SEXP) -> String {
    let glimpsed = altrep_vec_glimpse(value);
    let suffix = if glimpsed.0 {
        " (...)"
    } else {
        ""
    };

    format!("{} [{}] {}{}", vec_type(value), vec_shape(value), glimpsed.1, suffix)
}

fn vec_shape(value: SEXP) -> String {
    unsafe {
        let dim = RObject::new(Rf_getAttrib(value, R_DimSymbol));

        if *dim == R_NilValue {
            format!("{}", Rf_xlength(value))
        } else {
            let dim = IntegerVector::new(dim).unwrap();
            dim.into_iter()
                .format(", ")
                .to_string()
        }
    }
}

fn vec_glimpse(value: SEXP) -> (bool, String) {
    // TODO: turn this into a macro perhaps
    match unsafe{TYPEOF(value) as u32} {
        LGLSXP => {
            let vec = unsafe { LogicalVector::new(value) }.unwrap();
            vec.glimpse(30)
        },
        INTSXP => {
            let vec = unsafe { IntegerVector::new(value) }.unwrap();
            vec.glimpse(30)
        },
        REALSXP => {
            let vec = unsafe { NumericVector::new(value) }.unwrap();
            vec.glimpse(30)
        },
        RAWSXP => {
            let vec = unsafe { RawVector::new(value) }.unwrap();
            vec.glimpse(30)
        },

        STRSXP => {
            let vec = unsafe { CharacterVector::new(value) }.unwrap();
            vec.glimpse(30)
        },

        _ => {
            (true, String::from(""))
        }
    }
}

fn altrep_vec_glimpse(value: SEXP) -> (bool, String) {
    vec_glimpse(value)
}

#[allow(dead_code)]
fn altrep_class(object: SEXP) -> String {
    let serialized_klass = unsafe{
        ATTRIB(ALTREP_CLASS(object))
    };

    let klass = RSymbol::new(unsafe{CAR(serialized_klass)});
    let pkg = RSymbol::new(unsafe{CADR(serialized_klass)});

    format!("{}::{}", pkg, klass)
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
