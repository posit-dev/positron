//
// vector.rs
//
// Copyright (C) 2022 by Posit, PBC
//
//

use std::ffi::CStr;

use libR_sys::*;

use crate::error::Result;
use crate::object::RObject;
use crate::utils::r_assert_capacity;

pub trait Vector {
    type ElementType;

    unsafe fn wrap(object: RObject) -> Self;
    unsafe fn elt(&self, index: u32) -> Result<Self::ElementType>;
}

pub struct CharacterVector {
    pub object: RObject,
}

impl Vector for CharacterVector {
    type ElementType = String;

    unsafe fn wrap(object: RObject) -> Self {
        Self { object }
    }

    unsafe fn elt(&self, index: u32) -> Result<String> {
        r_assert_capacity(*self.object, index + 1)?;
        let charsexp = STRING_ELT(*self.object, index as isize);
        let cstr = Rf_translateCharUTF8(charsexp);
        let string = CStr::from_ptr(cstr).to_string_lossy().to_string();
        Ok(string)
    }
}

impl TryFrom<SEXP> for CharacterVector {
    type Error = crate::error::Error;

    fn try_from(value: SEXP) -> Result<Self> {
        unsafe { RObject::new(value).to::<CharacterVector>() }
    }
}
