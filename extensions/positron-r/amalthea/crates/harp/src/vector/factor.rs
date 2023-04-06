//
// factor.rs
//
// Copyright (C) 2022 Posit Software, PBC. All rights reserved.
//
//

use libR_sys::*;

use crate::object::RObject;
use crate::r_symbol;
use crate::vector::Vector;
use crate::vector::CharacterVector;

#[harp_macros::vector]
pub struct Factor {
    object: RObject,
    levels: CharacterVector
}

impl Vector for Factor {
    type Item = i32;
    type Type = i32;
    const SEXPTYPE: u32 = INTSXP;
    type UnderlyingType = i32;
    type CompareType = i32;

    unsafe fn new_unchecked(object: impl Into<SEXP>) -> Self {
        let object = RObject::new(object.into());
        let levels = CharacterVector::new(Rf_getAttrib(*object, r_symbol!("levels"))).unwrap();

        Self {
            object,
            levels
        }
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

    fn is_na(x: &Self::UnderlyingType) -> bool {
        unsafe { *x == R_NaInt }
    }

    fn get_unchecked_elt(&self, index: isize) -> Self::UnderlyingType {
        unsafe { INTEGER_ELT(self.data(), index as R_xlen_t) }
    }

    fn convert_value(x: &Self::UnderlyingType) -> Self::Type {
        *x
    }

    fn format_one(&self, x: Self::Type) -> String {
        self.levels.get_unchecked((x - 1) as isize).unwrap()
    }
}
