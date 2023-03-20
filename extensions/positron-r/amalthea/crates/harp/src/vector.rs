//
// vector.rs
//
// Copyright (C) 2022 Posit Software, PBC. All rights reserved.
//
//

use std::marker::PhantomData;

use libR_sys::*;

use crate::error::Result;
use crate::object::RObject;
use crate::utils::r_assert_capacity;
use crate::utils::r_assert_type;

// TODO: Is there a way to express that 'ElementType' should be derived from 'SEXPTYPE'?
pub struct Vector<const SEXPTYPE: u32, ElementType> {
    pub object: RObject,
    phantom: PhantomData<ElementType>,
}

// Useful type aliases for clients.
pub type LogicalVector   = Vector<LGLSXP,  i32>;
pub type IntegerVector   = Vector<INTSXP,  i32>;
pub type NumericVector   = Vector<REALSXP, f64>;
pub type CharacterVector = Vector<STRSXP,  SEXP>;
pub type RawVector       = Vector<RAWSXP,  u8>;
pub type List            = Vector<VECSXP,  SEXP>;

// Methods common to all R vectors.
impl<const SEXPTYPE: u32, ElementType> Vector<{ SEXPTYPE }, ElementType> {

    pub fn cast(object: RObject) -> Result<Self> {
        r_assert_type(*object, &[SEXPTYPE])?;
        Ok(Vector::<{ SEXPTYPE }, ElementType> { object, phantom: PhantomData })
    }

    pub fn length(&self) -> i32 {
        unsafe { Rf_length(*self.object) }
    }

    fn dataptr(&self) -> *mut ElementType {
        let pointer = unsafe { DATAPTR(*self.object) };
        pointer as *mut ElementType
    }

}

// Methods requiring specialization.
pub trait VectorBase {
    type ElementType;

    unsafe fn get(&self, index: u32) -> Result<Self::ElementType>;
}

impl<const SEXPTYPE: u32, ElementType> TryFrom<SEXP> for Vector<{ SEXPTYPE }, ElementType> {
    type Error = crate::error::Error;

    fn try_from(value: SEXP) -> std::result::Result<Self, Self::Error> {
        let object = unsafe { RObject::new(value) };
        Vector::<{ SEXPTYPE }, ElementType>::cast(object)
    }

}

impl<const SEXPTYPE: u32, ElementType> IntoIterator for Vector<{ SEXPTYPE }, ElementType> {
    type Item = ElementType;
    type IntoIter = std::vec::IntoIter<ElementType>;

    fn into_iter(self) -> Self::IntoIter {
        let ptr: *mut ElementType = self.dataptr();
        let n = self.length() as usize;
        let vector = unsafe { Vec::from_raw_parts(ptr, n, n) };
        vector.into_iter()
    }

}

impl VectorBase for CharacterVector {
    type ElementType = SEXP;

    unsafe fn get(&self, index: u32) -> Result<SEXP> {
        unsafe {
            r_assert_capacity(*self.object, index + 1)?;
            Ok(STRING_ELT(*self.object, index as isize))
        }
    }

}
