//
// raw_vector.rs
//
// Copyright (C) 2022 Posit Software, PBC. All rights reserved.
//
//

use libR_sys::*;

use crate::object::RObject;
use crate::vector::Vector;

#[harp_macros::vector]
pub struct RawVector {
    object: RObject,
}

impl Vector for RawVector {
    type Item = u8;
    type Type = u8;
    const SEXPTYPE: u32 = RAWSXP;
    type UnderlyingType = u8;

    unsafe fn new_unchecked(object: impl Into<SEXP>) -> Self {
        Self { object: RObject::new(object.into()) }
    }

    unsafe fn create<T>(data: T) -> Self
    where
        T: IntoIterator,
        <T as IntoIterator>::IntoIter: ExactSizeIterator,
        <T as IntoIterator>::Item: AsRef<Self::Item>
    {
        let it = data.into_iter();
        let count = it.len();

        let vector = Rf_allocVector(Self::SEXPTYPE, count as R_xlen_t);
        let dataptr = DATAPTR(vector) as *mut Self::Type;
        it.enumerate().for_each(|(index, value)| {
            *(dataptr.offset(index as isize)) = *value.as_ref();
        });

        Self::new_unchecked(vector)
    }

    fn data(&self) -> SEXP {
        self.object.sexp
    }

    fn is_na(_x: &Self::UnderlyingType) -> bool {
        false
    }

    fn get_unchecked_elt(&self, index: isize) -> Self::UnderlyingType {
        unsafe { RAW_ELT(self.data(), index as R_xlen_t) }
    }

    fn convert_value(x: &Self::UnderlyingType) -> Self::Type {
        *x
    }

}
