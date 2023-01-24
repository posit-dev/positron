//
// object.rs
//
// Copyright (C) 2022 by Posit Software, PBC
//
//

use std::collections::HashMap;
use std::convert::TryFrom;
use std::ffi::CStr;
use std::ops::Deref;
use std::ops::DerefMut;
use std::os::raw::c_char;
use std::os::raw::c_int;
use std::sync::Once;

use libR_sys::*;
use log::trace;

use crate::error::Error;
use crate::exec::RFunction;
use crate::exec::RFunctionExt;
use crate::protect::RProtect;
use crate::utils::r_assert_length;
use crate::utils::r_assert_type;
use crate::utils::r_typeof;
use crate::vector::CharacterVector;
use crate::vector::Vector;

// Objects are protected using a doubly-linked list,
// allowing for quick insertion and removal of objects.
static PRECIOUS_LIST_ONCE: Once = Once::new();
static mut PRECIOUS_LIST : Option<SEXP> = None;

unsafe fn protect(object: SEXP) -> SEXP {
    // Nothing to do
    if object == R_NilValue {
        return R_NilValue;
    }

    // Protect the incoming object, just in case.
    Rf_protect(object);

    // Initialize the precious list.
    PRECIOUS_LIST_ONCE.call_once(|| {
        let precious_list = Rf_cons(R_NilValue, Rf_cons(R_NilValue, R_NilValue));
        R_PreserveObject(precious_list);
        PRECIOUS_LIST = Some(precious_list);
    });

    let precious_list = PRECIOUS_LIST.unwrap_unchecked();

    // Get references to the head, tail of the current precious list.
    let head = precious_list;
    let tail = CDR(precious_list);

    // The new cell will be inserted between the existing head and tail,
    // so create a new cell referencing the head and tail of the list.
    let cell = Rf_protect(Rf_cons(head, tail));

    // Set the TAG on the cell so the object is protected.
    SET_TAG(cell, object);

    // Point the CDR of the current head to the newly-created cell.
    SETCDR(head, cell);

    // Point the CAR of the current tail to the newly-created cell.
    SETCAR(tail, cell);

    // Clean up the protect stack and return.
    Rf_unprotect(2);

    trace!("Protecting cell:   {:?}", cell);
    return cell;

}

unsafe fn unprotect(cell: SEXP) {

    if cell == R_NilValue {
        return;
    }

    trace!("Unprotecting cell: {:?}", cell);

    // We need to remove the cell from the precious list.
    // The CAR of the cell points to the previous cell in the precious list.
    // The CDR of the cell points to the next cell in the precious list.
    let head = CAR(cell);
    let tail = CDR(cell);

    // Point the head back at the tail.
    SETCDR(head, tail);

    // Point the tail back at the head.
    SETCAR(tail, head);

    // There should now be no references to the cell above, allowing it
    // (and the object it contains) to be cleaned up.
    SET_TAG(cell, R_NilValue);

}

pub struct RObject {
    pub sexp: SEXP,
    pub cell: SEXP,
}

pub trait RObjectExt<T> {
    unsafe fn elt(&self, index: T) -> crate::error::Result<RObject>;
}

impl<T: Into<RObject>> RObjectExt<T> for RObject {
    unsafe fn elt(&self, index: T) -> crate::error::Result<RObject> {
        let index: RObject = index.into();
        RFunction::new("base", "[[")
            .add(self.sexp)
            .add(index)
            .call()
    }
}

impl RObject {

    pub unsafe fn new(data: SEXP) -> Self {
        RObject { sexp: data, cell: protect(data) }
    }

    pub unsafe fn view(data: SEXP) -> Self {
        RObject { sexp: data, cell: R_NilValue }
    }

    pub unsafe fn null() -> Self {
        RObject { sexp: R_NilValue, cell: R_NilValue }
    }

    // A helper function that makes '.try_into()' more ergonomic to use.
    pub unsafe fn to<U: TryFrom<RObject, Error = crate::error::Error>>(self) -> Result<U, Error> {
        TryInto::<U>::try_into(self)
    }

}

impl Drop for RObject {
    fn drop(&mut self) {
        unsafe {
            unprotect(self.cell);
        }
    }
}

impl Deref for RObject {
    type Target = SEXP;
    fn deref(&self) -> &Self::Target {
        &self.sexp
    }
}

impl DerefMut for RObject {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.sexp
    }
}

/// Convert other object types into RObjects.
impl From<SEXP> for RObject {
    fn from(value: SEXP) -> Self {
        unsafe { RObject::new(value) }
    }
}

impl From<bool> for RObject {
    fn from(value: bool) -> Self {
        unsafe {
            let value = Rf_ScalarLogical(value as c_int);
            return RObject::new(value);
        }
    }
}

impl From<i32> for RObject {
    fn from(value: i32) -> Self {
        unsafe {
            let value = Rf_ScalarInteger(value as c_int);
            return RObject::new(value);
        }
    }
}

impl From<f64> for RObject {
    fn from(value: f64) -> Self {
        unsafe {
            let value = Rf_ScalarReal(value);
            return RObject::new(value);
        }
    }
}

impl From<&str> for RObject {
    fn from(value: &str) -> Self {
        unsafe {
            let vector = Rf_protect(Rf_allocVector(STRSXP, 1));
            let element = Rf_mkCharLenCE(value.as_ptr() as *mut c_char, value.len() as i32, cetype_t_CE_UTF8);
            SET_STRING_ELT(vector, 0, element);
            Rf_unprotect(1);
            return RObject::new(vector);
        }
    }
}

impl From<String> for RObject {
    fn from(value: String) -> Self {
        value.as_str().into()
    }
}

impl From<Vec<String>> for RObject {
    fn from(value: Vec<String>) -> Self {
        unsafe {
            let n = value.len() as isize;
            let vector = Rf_protect(Rf_allocVector(STRSXP, n));
            for i in 0..n {
                let string = value.get_unchecked(i as usize);
                let element = Rf_mkCharLenCE(string.as_ptr() as *mut c_char, n as i32, cetype_t_CE_UTF8);
                SET_STRING_ELT(vector, i as R_xlen_t, element);
            }
            Rf_unprotect(1);
            return RObject::new(vector);
        }
    }
}


/// Convert RObject into other types.

impl From<RObject> for SEXP {
    fn from(object: RObject) -> Self {
        object.sexp
    }
}

impl TryFrom<RObject> for CharacterVector {
    type Error = crate::error::Error;

    fn try_from(value: RObject) -> Result<Self, Self::Error> {
        unsafe {
            r_assert_type(*value, &[STRSXP])?;
            Ok(CharacterVector::wrap(value))
        }
    }
}

// TODO: Need to handle NA elements as well.
impl TryFrom<RObject> for bool {
    type Error = crate::error::Error;
    fn try_from(value: RObject) -> Result<Self, Self::Error> {
        unsafe {
            r_assert_type(*value, &[LGLSXP])?;
            r_assert_length(*value, 1)?;
            return Ok(*LOGICAL(*value) != 0);
        }
    }
}

impl TryFrom<RObject> for String {
    type Error = crate::error::Error;
    fn try_from(value: RObject) -> Result<Self, Self::Error> {
        unsafe {

            let types = &[CHARSXP, STRSXP, SYMSXP];
            let charsexp = match r_typeof(*value) {
                CHARSXP => *value,
                STRSXP => { r_assert_length(*value, 1)?; STRING_ELT(*value, 0) },
                SYMSXP => PRINTNAME(*value),
                _ => return Err(Error::UnexpectedType(r_typeof(*value), types.to_vec())),
            };

            let utf8text = Rf_translateCharUTF8(charsexp);
            Ok(CStr::from_ptr(utf8text).to_str()?.to_string())
        }
    }
}

impl TryFrom<RObject> for Vec<String> {
    type Error = crate::error::Error;
    fn try_from(value: RObject) -> Result<Self, Self::Error> {
        unsafe {
            r_assert_type(*value, &[STRSXP, NILSXP])?;

            let mut result : Vec<String> = Vec::new();
            let n = Rf_length(*value);
            for i in 0..n {
                let charsexp = STRING_ELT(*value, i as isize);
                let cstr = Rf_translateCharUTF8(charsexp);
                let string = CStr::from_ptr(cstr);
                result.push(string.to_str().unwrap().to_string());
            }

            return Ok(result);
        }
    }
}

impl TryFrom<RObject> for i32 {
    type Error = crate::error::Error;
    fn try_from(value: RObject) -> Result<Self, Self::Error> {
        unsafe {
            r_assert_length(*value, 1)?;
            match r_typeof(*value) {
                INTSXP => { Ok((*INTEGER(*value)) as i32) }
                REALSXP => { Ok((*REAL(*value)) as i32) }
                _ => { Err(Error::UnexpectedType(r_typeof(*value), vec![INTSXP])) }
            }
        }
    }
}

impl TryFrom<RObject> for HashMap<String, String> {
    type Error = crate::error::Error;
    fn try_from(value: RObject) -> Result<Self, Self::Error> {
        unsafe {
            r_assert_type(*value, &[STRSXP, VECSXP])?;

            let names = Rf_getAttrib(*value, R_NamesSymbol);
            r_assert_type(names, &[STRSXP])?;

            let mut protect = RProtect::new();
            let value = protect.add(Rf_coerceVector(*value, STRSXP));

            let n = Rf_length(names);
            let mut map = HashMap::<String, String>::with_capacity(n as usize);

            for i in 0..Rf_length(names) {

                // Get access to element pointers.
                let lhs = R_CHAR(STRING_ELT(names, i as isize));
                let rhs = R_CHAR(STRING_ELT(value, i as isize));

                // Create strings.
                let lhs = CStr::from_ptr(lhs).to_str()?;
                let rhs = CStr::from_ptr(rhs).to_str()?;

                map.insert(lhs.to_string(), rhs.to_string());
            }

            Ok(map)
        }
    }
}
