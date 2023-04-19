//
// environment.rs
//
// Copyright (C) 2022 Posit Software, PBC. All rights reserved.
//
//

use std::cmp::Ordering;

use itertools::Itertools;
use libR_sys::*;

use crate::exec::RFunction;
use crate::exec::RFunctionExt;
use crate::object::RObject;
use crate::symbol::RSymbol;
use crate::utils::Sxpinfo;
use crate::utils::r_assert_type;
use crate::utils::r_inherits;
use crate::utils::r_is_altrep;
use crate::utils::r_is_null;
use crate::utils::r_typeof;
use crate::vector::CharacterVector;
use crate::vector::Factor;
use crate::vector::IntegerVector;
use crate::vector::LogicalVector;
use crate::vector::NumericVector;
use crate::vector::RawVector;
use crate::vector::ComplexVector;
use crate::vector::Vector;
use crate::with_vector;

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

    pub fn from(value: SEXP) -> Self {
        if value == unsafe { R_NilValue } {
            return Self::simple(String::from("NULL"))
        }

        if RObject::view(value).is_s4() {
            return Self::from_class(value, String::from("S4"));
        }

        if is_simple_vector(value) {
            return vec_type_info(value);
        }

        let rtype = r_typeof(value);
        match rtype {
            EXPRSXP => Self::from_class(value, format!("expression [{}]", unsafe { XLENGTH(value) })),
            LANGSXP => Self::from_class(value, String::from("language")),
            CLOSXP  => Self::from_class(value, String::from("function")),
            ENVSXP  => Self::from_class(value, String::from("environment")),
            SYMSXP  => {
                if value == unsafe { R_MissingArg } {
                    Self::simple(String::from("missing"))
                } else {
                    Self::simple(String::from("symbol"))
                }
            },

            LISTSXP => {
                match pairlist_size(value) {
                    Ok(n)  => Self::simple(format!("pairlist [{}]", n)),
                    Err(_) => Self::simple(String::from("pairlist [?]"))
                }
            },

            VECSXP => unsafe {
                if r_inherits(value, "data.frame") {
                    let dfclass = first_class(value).unwrap();

                    let dim = RFunction::new("base", "dim.data.frame")
                        .add(value)
                        .call()
                        .unwrap();

                    let dim = IntegerVector::new(dim).unwrap();
                    let shape = dim.format(",", 0).1;

                    Self::simple(
                        format!("{} [{}]", dfclass, shape)
                    )
                } else {
                    Self::from_class(value, format!("list [{}]", XLENGTH(value)))
                }
            },
            _      => Self::from_class(value, String::from("???"))
        }

    }

    pub fn simple(display_type: String) -> Self {
        Self {
            display_type,
            type_info: String::from("")
        }
    }

    fn from_class(value: SEXP, default: String) -> Self {
        match first_class(value) {
            None        => Self::simple(default),
            Some(class) => Self::new(class, all_classes(value))
        }
    }

    fn new(display_type: String, type_info: String) -> Self {
        Self {
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
            BindingKind::Active => BindingType::simple(String::from("active binding")),
            BindingKind::Promise(false) => BindingType::simple(String::from("promise")),

            BindingKind::Regular => BindingType::from(self.value),
            BindingKind::Promise(true) => BindingType::from(unsafe{PRVALUE(self.value)})
        }
    }

    pub fn has_children(&self) -> bool {
        match self.kind {
            BindingKind::Regular => has_children(self.value),
            BindingKind::Promise(true) => has_children(unsafe{PRVALUE(self.value)}),

            // TODO:
            //   - BindingKind::Promise(false) could have code and env as their children
            //   - BindingKind::Active could have their function
            _ => false
        }
    }

    pub fn is_hidden(&self) -> bool {
        String::from(self.name).starts_with(".")
    }

}

pub fn has_children(value: SEXP) -> bool {
    if RObject::view(value).is_s4() {
        unsafe {
            let names = RFunction::new("methods", ".slotNames").add(value).call().unwrap();
            let names = CharacterVector::new_unchecked(names);
            names.len() > 0
        }
    } else {
        match r_typeof(value) {
            VECSXP   => unsafe { XLENGTH(value) != 0 },
            EXPRSXP  => unsafe { XLENGTH(value) != 0 },
            LISTSXP  => true,
            ENVSXP   => true,
            _        => false
        }
    }
}

fn is_simple_vector(value: SEXP) -> bool {
    unsafe {
        let class = Rf_getAttrib(value, R_ClassSymbol);

        match r_typeof(value) {
            LGLSXP | REALSXP | CPLXSXP | STRSXP | RAWSXP => r_is_null(class),
            INTSXP  => r_is_null(class) || r_inherits(value, "factor"),

            _       => false
        }
    }
}

fn first_class(value: SEXP) -> Option<String> {
    unsafe {
        let classes = Rf_getAttrib(value, R_ClassSymbol);
        if r_is_null(classes) {
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
    } else if rtype == LISTSXP {
        BindingValue::empty()
    } else if rtype == SYMSXP && value == unsafe{ R_MissingArg } {
        BindingValue::new(String::from("<missing>"), false)
    } else if rtype == CLOSXP {
        unsafe {
            let args      = RFunction::from("args").add(value).call().unwrap();
            let formatted = RFunction::from("format").add(*args).call().unwrap();
            let formatted = CharacterVector::new_unchecked(formatted);
            let out = formatted.iter().take(formatted.len() -1).map(|o|{ o.unwrap() }).join("");
            BindingValue::new(out, false)
        }
    } else {
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

fn pairlist_size(mut pairlist: SEXP) -> Result<isize, crate::error::Error> {
    let mut n = 0;
    unsafe {
        while pairlist != R_NilValue {
            r_assert_type(pairlist, &[LISTSXP])?;

            pairlist = CDR(pairlist);
            n = n + 1;
        }
    }
    Ok(n)
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
    let display_type = format!("{}{}", vec_type(value), vec_shape(value));

    let mut type_info = display_type.clone();
    if r_is_altrep(value) {
        type_info.push_str(altrep_class(value).as_str())
    }

    BindingType::new(display_type, type_info)
}

fn vec_shape(value: SEXP) -> String {
    unsafe {
        let dim = RObject::new(Rf_getAttrib(value, R_DimSymbol));

        if r_is_null(*dim) {
            if XLENGTH(value) == 1 {
                String::from("")
            } else {
                format!(" [{}]", Rf_xlength(value))
            }
        } else {
            let dim = IntegerVector::new(dim).unwrap();
            format!(" [{}]", dim.format(",", 0).1)
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

pub fn env_bindings<Retain>(env: SEXP, retain: Retain) -> Vec<Binding>
where
    Retain: Fn(&Binding) -> bool
{
    unsafe {
        let hash  = HASHTAB(env);
        if r_is_null(hash) {
            frame_bindings(env, FRAME(env), retain)
        } else {
            let mut bindings : Vec<Binding> = vec![];

            let n = XLENGTH(hash);
            for i in 0..n {
                bindings.append(&mut frame_bindings(env, VECTOR_ELT(hash, i), &retain));
            }
            bindings
        }
    }
}

unsafe fn frame_bindings<Retain>(env: SEXP, mut frame: SEXP, retain: Retain) -> Vec<Binding>
where
    Retain: Fn(&Binding) -> bool
{
    let mut bindings: Vec<Binding> = vec![];
    while frame != R_NilValue {
        let binding = Binding::new(env, frame);
        if retain(&binding) {
            bindings.push(binding);
        }

        frame = CDR(frame);
    }
    bindings
}
