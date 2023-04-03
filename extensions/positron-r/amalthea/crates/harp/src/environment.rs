//
// environment.rs
//
// Copyright (C) 2022 Posit Software, PBC. All rights reserved.
//
//

use std::cmp::Ordering;

use c2rust_bitfields::BitfieldStruct;
use libR_sys::*;

use crate::exec::RFunction;
use crate::exec::RFunctionExt;
use crate::object::RObject;
use crate::symbol::RSymbol;
use crate::utils::r_inherits;
use crate::utils::r_typeof;
use crate::vector::CharacterVector;
use crate::vector::Factor;
use crate::vector::IntegerVector;
use crate::vector::LogicalVector;
use crate::vector::NumericVector;
use crate::vector::RawVector;
use crate::vector::Vector;

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

pub struct BindingValue {
    pub display_value: String,
    pub is_truncated: bool
}

impl BindingValue {
    pub fn new(display_value: String, is_truncated: bool) -> Self {
        BindingValue {
            display_value,
            is_truncated
        }
    }

    pub fn empty() -> Self {
        Self::new(String::from(""), false)
    }

    pub fn from(x: SEXP) -> Self {
        regular_binding_display_value(x)
    }
}

pub struct BindingType {
    pub display_type: String,
    pub type_info: String
}

impl BindingType {
    pub fn new(display_type: String, type_info: String) -> Self {
        BindingType {
            display_type,
            type_info
        }
    }

    pub fn from(value: SEXP) -> Self {
        regular_binding_type(value)
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

    pub fn get_value(&self) -> BindingValue {
        match self.kind {
            BindingKind::Regular => regular_binding_display_value(self.value),
            BindingKind::Promise(true) => regular_binding_display_value(unsafe{PRVALUE(self.value)}),

            BindingKind::Active => BindingValue::empty(),
            BindingKind::Promise(false) => BindingValue::empty()
        }
    }

    pub fn get_type(&self) -> BindingType {
        match self.kind {
            BindingKind::Active => BindingType::new(String::from("active binding"), String::from("")),
            BindingKind::Promise(false) => BindingType::new(String::from("promise"), String::from("")),

            BindingKind::Regular => regular_binding_type(self.value),
            BindingKind::Promise(true) => regular_binding_type(unsafe{PRVALUE(self.value)})
        }
    }

    pub fn has_children(&self) -> bool {
        match self.kind {
            // TODO: for now only lists have children
            BindingKind::Regular => r_typeof(self.value) == VECSXP,
            BindingKind::Promise(true) => r_typeof(unsafe{PRVALUE(self.value)}) == VECSXP,

            // TODO:
            //   - BindingKind::Promise(false) could have code and env as their children
            //   - BindingKind::Active could have their function
            _ => false
        }
    }

}

fn is_vector(value: SEXP) -> bool {
    match r_typeof(value) {
        LGLSXP => true,
        INTSXP => true,
        REALSXP => true,
        CPLXSXP => true,
        STRSXP => true,
        RAWSXP => true,
        VECSXP => true,

        _ => false
    }
}

fn regular_binding_display_value(value: SEXP) -> BindingValue {
    // TODO: some form of R based dispatch
    if is_vector(value) {
        vec_glimpse(value)
    } else {

        // TODO:
        //   - list (or does that go in vector too)
        //   - data.frame
        //   - function
        //   - environment
        //   - pairlist
        //   - calls

        BindingValue::new(String::from("???"), false)
    }

}

fn regular_binding_type(value: SEXP) -> BindingType {
    if is_vector(value) {
        vec_type_info(value)
    } else {
        BindingType::new(String::from("???"), String::from(""))
    }
}

fn vec_type(value: SEXP) -> String {
    match r_typeof(value) {
        INTSXP  => {
            if unsafe {r_inherits(value, "factor")} {
                String::from("fct")
            } else {
                String::from("int")
            }
        },
        REALSXP => String::from("dbl"),
        LGLSXP  => String::from("lgl"),
        STRSXP  => String::from("str"),
        RAWSXP  => String::from("raw"),
        CPLXSXP => String::from("cplx"),
        VECSXP  => unsafe {
            if r_inherits(value, "data.frame") {
                let classes = CharacterVector::new_unchecked(Rf_getAttrib(value, R_ClassSymbol));
                classes.get_unchecked(0).unwrap()
            } else {
                String::from("list")
            }
        },

        // TODO: this should not happen
        _       => String::from("???")
    }
}

fn vec_type_info(value: SEXP) -> BindingType {
    let display_type = format!("{} [{}]", vec_type(value), vec_shape(value));

    let mut type_info = display_type.clone();
    if unsafe{ ALTREP(value) == 1} {
        type_info.push_str(altrep_class(value).as_str())
    }

    BindingType::new(display_type, type_info)
}

fn vec_shape(value: SEXP) -> String {
    unsafe {
        let dim = if r_inherits(value, "data.frame") {
            RFunction::new("base", "dim.data.frame")
                .add(value)
                .call()
                .unwrap()
        } else {
            RObject::new(Rf_getAttrib(value, R_DimSymbol))
        };

        if *dim == R_NilValue {
            format!("{}", Rf_xlength(value))
        } else {
            let dim = IntegerVector::new(dim).unwrap();
            dim.format(",", 0).1
        }
    }
}

fn vec_glimpse(value: SEXP) -> BindingValue {
    // TODO: turn this into a macro perhaps
    match unsafe{TYPEOF(value) as u32} {
        LGLSXP => {
            let vec = unsafe { LogicalVector::new(value) }.unwrap();
            let formatted = vec.format(" ", 100);
            BindingValue::new(formatted.1, formatted.0)
        },
        INTSXP => {
            if unsafe { r_inherits(value, "factor") } {
                let vec = unsafe { Factor::new(value) }.unwrap();
                let formatted = vec.format(" ", 100);
                BindingValue::new(formatted.1, formatted.0)
            } else {
                let vec = unsafe { IntegerVector::new(value) }.unwrap();
                let formatted = vec.format(" ", 100);
                BindingValue::new(formatted.1, formatted.0)
            }
        },
        REALSXP => {
            let vec = unsafe { NumericVector::new(value) }.unwrap();
            let formatted = vec.format(" ", 100);
            BindingValue::new(formatted.1, formatted.0)
        },
        RAWSXP => {
            let vec = unsafe { RawVector::new(value) }.unwrap();
            let formatted = vec.format(" ", 100);
            BindingValue::new(formatted.1, formatted.0)
        },

        STRSXP => {
            let vec = unsafe { CharacterVector::new(value) }.unwrap();
            let formatted = vec.format(" ", 100);
            BindingValue::new(formatted.1, formatted.0)
        },

        VECSXP => {
            BindingValue::empty()
        },

        _ => {
            BindingValue::empty()
        }
    }
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
