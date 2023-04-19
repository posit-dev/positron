//
// utils.rs
//
// Copyright (C) 2022 Posit Software, PBC. All rights reserved.
//
//

use c2rust_bitfields::BitfieldStruct;

use std::ffi::CStr;
use std::ffi::CString;
use std::os::raw::c_void;

use libR_sys::*;
use once_cell::sync::Lazy;
use regex::Regex;

use crate::error::Error;
use crate::error::Result;
use crate::exec::RArgument;
use crate::exec::RFunction;
use crate::exec::RFunctionExt;
use crate::object::RObject;
use crate::protect::RProtect;
use crate::r_symbol;
use crate::vector::CharacterVector;
use crate::vector::Vector;

// NOTE: Regex::new() is quite slow to compile, so it's much better to keep
// a single singleton pattern and use that repeatedly for matches.
static RE_SYNTACTIC_IDENTIFIER: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"^[\p{L}\p{Nl}.][\p{L}\p{Nl}\p{Mn}\p{Mc}\p{Nd}\p{Pc}.]*$").unwrap());

extern "C" {
    fn R_removeVarFromFrame(
        symbol: SEXP,
        envir: SEXP,
    ) -> c_void;
}

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
pub static mut S4_OBJECT_MASK: libc::c_uint = 1 << 4;

impl Sxpinfo {

    pub fn interpret(x: &SEXP) -> &Self {
        unsafe {
            (*x as *mut Sxpinfo).as_ref().unwrap()
        }
    }

    pub fn is_active(&self) -> bool {
        self.gp() & unsafe {ACTIVE_BINDING_MASK} != 0
    }

    pub fn is_immediate(&self) -> bool {
        self.extra() != 0
    }

    pub fn is_s4(&self) -> bool {
        self.gp() & unsafe {S4_OBJECT_MASK} != 0
    }

    pub fn is_altrep(&self) -> bool {
        self.alt() != 0
    }

    pub fn is_object(&self) -> bool {
        self.obj() != 0
    }
}

pub fn r_assert_type(
    object: SEXP,
    expected: &[u32],
) -> Result<u32> {
    let actual = r_typeof(object);

    if !expected.contains(&actual) {
        return Err(Error::UnexpectedType(actual, expected.to_vec()));
    }

    Ok(actual)
}

pub unsafe fn r_assert_capacity(
    object: SEXP,
    required: u32,
) -> Result<u32> {
    let actual = Rf_length(object) as u32;
    if actual < required {
        return Err(Error::UnexpectedLength(actual, required));
    }

    Ok(actual)
}

pub unsafe fn r_assert_length(
    object: SEXP,
    expected: u32,
) -> Result<u32> {
    let actual = Rf_length(object) as u32;
    if actual != expected {
        return Err(Error::UnexpectedLength(actual, expected));
    }

    Ok(actual)
}

pub fn r_is_null(object: SEXP) -> bool {
    unsafe { object == R_NilValue }
}

pub fn r_is_altrep(object: SEXP) -> bool {
    Sxpinfo::interpret(&object).is_altrep()
}

pub fn r_is_object(object: SEXP) -> bool {
    Sxpinfo::interpret(&object).is_object()
}

pub fn r_is_s4(object: SEXP) -> bool {
    Sxpinfo::interpret(&object).is_s4()
}

pub fn r_typeof(object: SEXP) -> u32 {
    // SAFETY: The type of an R object is typically considered constant,
    // and TYPEOF merely queries the R type directly from the SEXPREC struct.
    let object = object.into();
    unsafe { TYPEOF(object) as u32 }
}

pub unsafe fn r_type2char<T: Into<u32>>(kind: T) -> String {
    let kind = Rf_type2char(kind.into());
    let cstr = CStr::from_ptr(kind);
    return cstr.to_str().unwrap().to_string();
}

pub unsafe fn r_get_option<T: TryFrom<RObject, Error = Error>>(name: &str) -> Result<T> {
    let result = Rf_GetOption1(r_symbol!(name));
    return RObject::new(result).try_into();
}

pub unsafe fn r_inherits(
    object: SEXP,
    class: &str,
) -> bool {
    let class = CString::new(class).unwrap();
    return Rf_inherits(object, class.as_ptr()) != 0;
}

pub unsafe fn r_formals(object: SEXP) -> Result<Vec<RArgument>> {
    // convert primitive functions into equivalent closures
    let mut object = RObject::new(object);
    if r_typeof(*object) == BUILTINSXP || r_typeof(*object) == SPECIALSXP {
        object = RFunction::new("base", "args").add(*object).call()?;
        if r_typeof(*object) != CLOSXP {
            return Ok(Vec::new());
        }
    }

    // validate we have a closure now
    r_assert_type(*object, &[CLOSXP])?;

    // get the formals
    let mut formals = FORMALS(*object);

    // iterate through the entries
    let mut arguments = Vec::new();

    while formals != R_NilValue {
        let name = RObject::from(TAG(formals)).to::<String>()?;
        let value = CAR(formals);
        arguments.push(RArgument::new(name.as_str(), RObject::new(value)));
        formals = CDR(formals);
    }

    Ok(arguments)
}

pub unsafe fn r_envir_name(envir: SEXP) -> Result<String> {
    r_assert_type(envir, &[ENVSXP])?;

    if envir == R_BaseNamespace || envir == R_BaseEnv {
        return Ok("base".to_string());
    }

    if R_IsPackageEnv(envir) != 0 {
        let name = RObject::from(R_PackageEnvName(envir));
        return name.to::<String>();
    }

    if R_IsNamespaceEnv(envir) != 0 {
        let spec = R_NamespaceEnvSpec(envir);
        if let Ok(vector) = CharacterVector::new(spec) {
            let package = vector.get(0)?.unwrap();
            return Ok(package.to_string());
        }
    }

    let name = Rf_getAttrib(envir, r_symbol!("name"));
    if r_typeof(name) == STRSXP {
        let name = RObject::view(name).to::<String>()?;
        return Ok(name);
    }

    Ok(format!("{:p}", envir))
}

pub unsafe fn r_envir_get(
    symbol: &str,
    envir: SEXP,
) -> Option<SEXP> {
    let value = Rf_findVar(r_symbol!(symbol), envir);
    if value == R_UnboundValue {
        return None;
    }

    Some(value)
}

pub unsafe fn r_envir_set(
    symbol: &str,
    value: SEXP,
    envir: SEXP,
) {
    Rf_defineVar(r_symbol!(symbol), value, envir);
}

pub unsafe fn r_envir_remove(
    symbol: &str,
    envir: SEXP,
) {
    R_removeVarFromFrame(r_symbol!(symbol), envir);
}

pub unsafe fn r_stringify(
    object: SEXP,
    delimiter: &str,
) -> Result<String> {
    // handle SYMSXPs upfront
    if r_typeof(object) == SYMSXP {
        return RObject::view(object).to::<String>();
    }

    // call format on the object
    let object = RFunction::new("base", "format").add(object).call()?;

    // paste into a single string
    let object = RFunction::new("base", "paste")
        .add(object)
        .param("collapse", delimiter)
        .call()?
        .to::<String>()?;

    Ok(object)
}

pub unsafe fn r_inspect(object: SEXP) {
    let mut protect = RProtect::new();
    let inspect = protect.add(Rf_lang2(r_symbol!("inspect"), object));
    let internal = protect.add(Rf_lang2(r_symbol!(".Internal"), inspect));
    Rf_eval(internal, R_BaseEnv);
}

pub fn r_symbol_valid(name: &str) -> bool {
    RE_SYNTACTIC_IDENTIFIER.is_match(name)
}

pub fn r_symbol_quote_invalid(name: &str) -> String {
    if RE_SYNTACTIC_IDENTIFIER.is_match(name) {
        name.to_string()
    } else {
        format!("`{}`", name.replace("`", "\\`"))
    }
}
