//
// complex_vector.rs
//
// Copyright (C) 2023 Posit Software, PBC. All rights reserved.
//
//

use libR_sys::*;

use crate::object::RObject;
use crate::vector::Vector;

#[derive(Debug, PartialEq, Clone, Copy)]
pub struct Complex {
    pub r: f64,
    pub i: f64,
}

impl Complex {
    fn new(x: Rcomplex) -> Self {
        Complex {
            r: x.r,
            i: x.i
        }
    }
}

#[harp_macros::vector]
pub struct ComplexVector {
    object: RObject,
}

impl Vector for ComplexVector {
    type Item = Complex;
    type Type = Complex;
    const SEXPTYPE: u32 = CPLXSXP;
    type UnderlyingType = Complex;
    type CompareType = Complex;

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

    fn is_na(x: &Self::UnderlyingType) -> bool {
        unsafe { R_IsNA(x.r) == 1 || R_IsNA(x.i) == 1 }
    }

    fn get_unchecked_elt(&self, index: isize) -> Self::UnderlyingType {
        unsafe { Complex::new(COMPLEX_ELT(self.data(), index as R_xlen_t)) }
    }

    fn convert_value(x: &Self::UnderlyingType) -> Self::Type {
        *x
    }

    fn format_one(&self, x: Self::Type) -> String {
        format!("{}+{}i", x.r.to_string(), x.i.to_string())
    }

}
