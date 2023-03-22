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
        LGLSXP   => describe_vec("lgl", value),
        INTSXP   => describe_vec("int", value),
        REALSXP  => describe_vec("dbl", value),
        CPLXSXP  => describe_vec("cplx", value),
        STRSXP   => describe_vec("chr", value),
        VECSXP   => {
            // TODO: data.frame
            describe_vec("list", value)
        },

        _       => String::from("???")
    }

}

fn describe_altrep(value: SEXP) -> String {
    let rtype = match unsafe{TYPEOF(value) as u32} {
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

    format!("{} [{}] (altrep {}) {}", rtype, vec_shape(value), altrep_class(value), altrep_vec_glimpse(value))
}

fn describe_vec(rtype: &str, value: SEXP) -> String {
    format!("{} [{}] {}", rtype, vec_shape(value), vec_glimpse(value))
}

fn vec_shape(value: SEXP) -> String {
    unsafe {
        let dim = RObject::from(Rf_getAttrib(value, R_DimSymbol));

        if *dim == R_NilValue {
            format!("{}", Rf_xlength(value))
        } else {
            dim.i32_iter().unwrap()
                .map(|x| {
                    match x {
                        Some(value) => value.to_string(),
                        None => String::from("NA")
                    }
                })
                .format(", ")
                .to_string()
        }
    }
}

fn vec_glimpse(value: SEXP) -> String {
    match unsafe{TYPEOF(value) as u32} {
        INTSXP => {
            let mut iter = RObject::from(value).i32_iter().unwrap();

            let mut out = String::new();
            loop {
                match iter.next() {
                    None => break,

                    Some(x) => {
                        if out.len() > 20 {
                            out.push_str(" (...)");
                            break;
                        }
                        out.push_str(" ");
                        match x {
                            None => {
                                out.push_str("_");
                            },
                            Some(x) => {
                                out.push_str(x.to_string().as_str())
                            }
                        }
                    }
                }

            }

            out
        },
        _ => {
            String::from("(...)")
        }
    }
}

fn altrep_vec_glimpse(value: SEXP) -> String {
    vec_glimpse(value)
}

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
