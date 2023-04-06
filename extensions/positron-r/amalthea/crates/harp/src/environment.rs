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
use crate::with_vector;

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

impl Sxpinfo {

    pub fn interpret(frame: &SEXP) -> &Self {
        unsafe {
            (*frame as *mut Sxpinfo).as_ref().unwrap()
        }
    }

    pub fn is_active(&self) -> bool {
        self.gp() & unsafe {ACTIVE_BINDING_MASK} != 0
    }

    pub fn is_immediate(&self) -> bool {
        self.extra() != 0
    }
}

#[derive(Debug, Eq, PartialEq)]
pub enum BindingKind {
    Regular,
    Active,
    Promise(bool),
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

    pub fn simple(display_type: String) -> Self {
        let type_info = display_type.clone();
        BindingType {
            display_type,
            type_info
        }
    }
}

impl Binding {
    pub fn new(env: SEXP, frame: SEXP) -> Self {
        unsafe {
            let name = RSymbol::new(TAG(frame));

            let info = Sxpinfo::interpret(&frame);

            if info.is_immediate() {
                // force the immediate bindings before we can safely call CAR()
                Rf_findVarInFrame(env, *name);
            }
            let value = CAR(frame);

            let kind = if info.is_active() {
                BindingKind::Active
            } else {
                match r_typeof(value) {
                    PROMSXP => BindingKind::Promise(PRVALUE(value) != R_UnboundValue),
                    _       => BindingKind::Regular
                }
            };

            Self {
                name, value, kind
            }
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
            BindingKind::Regular => has_children(self.value),
            BindingKind::Promise(true) => has_children(unsafe{PRVALUE(self.value)}),

            // TODO:
            //   - BindingKind::Promise(false) could have code and env as their children
            //   - BindingKind::Active could have their function
            _ => false
        }
    }

}

pub fn has_children(value: SEXP) -> bool {
    match r_typeof(value) {
        VECSXP  => !unsafe{ r_inherits(value, "POSIXlt") },
        LISTSXP => true,
        ENVSXP => true,

        _       => false
    }
}

fn is_simple_vector(value: SEXP) -> bool {
    unsafe {
        let class = Rf_getAttrib(value, R_ClassSymbol);

        match r_typeof(value) {
            LGLSXP  => class == R_NilValue,
            INTSXP  => class == R_NilValue || r_inherits(value, "factor"),
            REALSXP => class == R_NilValue,
            CPLXSXP => class == R_NilValue,
            STRSXP  => class == R_NilValue,
            RAWSXP  => class == R_NilValue,

            _       => false
        }
    }

}

fn first_class(value: SEXP) -> Option<String> {
    unsafe {
        let classes = Rf_getAttrib(value, R_ClassSymbol);
        if classes == R_NilValue {
            None
        } else {
            let classes = CharacterVector::new_unchecked(classes);
            Some(classes.get_unchecked(0).unwrap())
        }
    }
}

fn all_classes(value: SEXP) -> String {
    unsafe {
        let classes = Rf_getAttrib(value, R_ClassSymbol);
        let classes = CharacterVector::new_unchecked(classes);
        classes.format("/", 0).1
    }
}

fn regular_binding_display_value(value: SEXP) -> BindingValue {
    let rtype = r_typeof(value);
    if is_simple_vector(value) {
        with_vector!(value, |v| {
            let formatted = v.format(" ", 100);
            BindingValue::new(formatted.1, formatted.0)
        }).unwrap()
    } else if rtype == VECSXP && ! unsafe{r_inherits(value, "POSIXlt")}{
        // This includes data frames
        BindingValue::empty()
    } else {
        // TODO:
        //   - function
        //   - environment
        format_display_value(value)
    }
}

fn format_display_value(value: SEXP) -> BindingValue {
    unsafe {
        // try to call format() on the object
        let formatted = RFunction::new("base", "format")
            .add(value)
            .call();

        match formatted {
            Ok(fmt) => {
                if r_typeof(*fmt) == STRSXP {
                    let fmt = CharacterVector::unquoted(*fmt);
                    let fmt = fmt.format(" ", 100);

                    BindingValue::new(fmt.1, fmt.0)
                } else {
                    BindingValue::new(String::from("???"), false)
                }
            },
            Err(_) => {
                BindingValue::new(String::from("???"), false)
            }
        }
    }
}

fn regular_binding_type(value: SEXP) -> BindingType {
    let rtype = r_typeof(value);
    if is_simple_vector(value) {
        vec_type_info(value)
    } else if rtype == LISTSXP {

        let mut n = 0;
        let mut pairlist = value;
        unsafe {
            while pairlist != R_NilValue {
                if r_typeof(pairlist) != LISTSXP {
                    return BindingType::simple(String::from("pairlist [?]"));
                }
                pairlist = CDR(pairlist);
                n = n + 1;
            }
        }

        BindingType::simple(format!("pairlist [{}]", n))
    } else if rtype == VECSXP {
        unsafe {
            if r_inherits(value, "data.frame") {
                let dfclass = first_class(value).unwrap();

                let dim = RFunction::new("base", "dim.data.frame")
                    .add(value)
                    .call()
                    .unwrap();

                let dim = IntegerVector::new(dim).unwrap();
                let shape = dim.format(",", 0).1;

                BindingType::simple(
                    format!("{} [{}]", dfclass, shape)
                )
            } else {
                match first_class(value) {
                    None => BindingType::simple(String::from("list")),
                    Some(class) => {
                        BindingType::new(class, all_classes(value))
                    }
                }
                // TODO: should type_info be different ?
                // TODO: deal with record types, e.g. POSIXlt
            }
        }
    } else if rtype == SYMSXP {
        BindingType::simple(String::from("symbol"))
    } else if rtype == CLOSXP {
        BindingType::simple(String::from("function"))
    } else if rtype == ENVSXP {
        BindingType::simple(String::from("environment"))
    } else {
        let class = first_class(value);
        match class {
            Some(class) => BindingType::new(class, all_classes(value)),
            None        => BindingType::simple(String::from("???"))
        }
    }
}

fn vec_type(value: SEXP) -> String {
    match r_typeof(value) {
        INTSXP  => unsafe {
            if r_inherits(value, "factor") {
                let levels = Rf_getAttrib(value, R_LevelsSymbol);
                format!("fct({})", XLENGTH(levels))
            } else {
                String::from("int")
            }
        },
        REALSXP => String::from("dbl"),
        LGLSXP  => String::from("lgl"),
        STRSXP  => String::from("str"),
        RAWSXP  => String::from("raw"),
        CPLXSXP => String::from("cplx"),

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
        let dim = RObject::new(Rf_getAttrib(value, R_DimSymbol));

        if *dim == R_NilValue {
            format!("{}", Rf_xlength(value))
        } else {
            let dim = IntegerVector::new(dim).unwrap();
            dim.format(",", 0).1
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
            frame_bindings(env, FRAME(env), &mut bindings);
        } else {
            let n = XLENGTH(hash);
            for i in 0..n {
                frame_bindings(env, VECTOR_ELT(hash, i), &mut bindings);
            }
        }

        bindings
    }
}

unsafe fn frame_bindings(env: SEXP, mut frame: SEXP, bindings: &mut Vec<Binding> ) {
    while frame != R_NilValue {
        bindings.push(Binding::new(env, frame));
        frame = CDR(frame);
    }
}
