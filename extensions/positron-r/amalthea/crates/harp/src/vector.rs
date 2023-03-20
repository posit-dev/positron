//
// vector.rs
//
// Copyright (C) 2022 Posit Software, PBC. All rights reserved.
//
//

use std::ffi::CStr;

use libR_sys::*;

use crate::error::Result;
use crate::object::RObject;
use crate::utils::r_assert_capacity;
use crate::utils::r_assert_type;

pub struct Vector<const RTYPE: u32> {
    pub object: RObject,
}

// Methods common to all R vectors.
impl<const RTYPE: u32> Vector<RTYPE> {

    pub fn cast(object: RObject) -> Result<Self> {
        r_assert_type(*object, &[RTYPE])?;
        Ok(Vector::<RTYPE> { object })
    }

}

// Methods requiring specialization.
pub trait VectorBase {
    type ElementType;

    unsafe fn element(&self, index: u32) -> Result<Self::ElementType>;
}

impl<const RTYPE: u32> TryFrom<SEXP> for Vector<RTYPE> {
    type Error = crate::error::Error;

    fn try_from(value: SEXP) -> std::result::Result<Self, Self::Error> {
        let object = unsafe { RObject::new(value) };
        Vector::<RTYPE>::cast(object)
    }

}

impl VectorBase for CharacterVector {
    type ElementType = String;

    unsafe fn element(&self, index: u32) -> Result<String> {
        unsafe {
            r_assert_capacity(*self.object, index + 1)?;
            let charsexp = STRING_ELT(*self.object, index as isize);
            let cstr = Rf_translateCharUTF8(charsexp);
            let string = CStr::from_ptr(cstr).to_string_lossy().to_string();
            Ok(string)
        }
    }
}

// Useful type aliases for clients.
pub type LogicalVector   = Vector<LGLSXP>;
pub type IntegerVector   = Vector<INTSXP>;
pub type NumericVector   = Vector<REALSXP>;
pub type CharacterVector = Vector<STRSXP>;
pub type RawVector       = Vector<RAWSXP>;
pub type List            = Vector<VECSXP>;

