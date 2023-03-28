//
// integer_vector.rs
//
// Copyright (C) 2022 Posit Software, PBC. All rights reserved.
//
//

use libR_sys::*;

use crate::object::RObject;
use crate::vector::Vector;

#[harp_macros::vector]
pub struct IntegerVector {
    object: RObject,
}

impl Vector for IntegerVector {
    type Item = i32;
    type Type = i32;
    const SEXPTYPE: u32 = INTSXP;

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

    unsafe fn get_unchecked(&self, index: isize) -> Self::Type {
        INTEGER_ELT(self.data(), index as R_xlen_t)
    }

}
