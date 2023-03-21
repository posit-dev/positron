//
// vector.rs
//
// Copyright (C) 2022 Posit Software, PBC. All rights reserved.
//
//

use std::ffi::CStr;
use std::marker::PhantomData;
use std::ops::Deref;
use std::ops::DerefMut;

use libR_sys::*;

use crate::error::Result;
use crate::object::RObject;
use crate::r_char;
use crate::utils::r_assert_capacity;
use crate::utils::r_assert_type;

pub trait TypesEqual {}
impl<T> TypesEqual for (T, T) {}

// TODO: Is there a way to express that 'ElementType' should be derived from 'SEXPTYPE'?
pub struct Vector<const SEXPTYPE: u32, ElementType, NativeType> {
    object: RObject,
    phantom: PhantomData<(ElementType, NativeType)>,
}

// Useful type aliases for clients.
pub type LogicalVector   = Vector<LGLSXP,  i32,  i32>;
pub type IntegerVector   = Vector<INTSXP,  i32,  i32>;
pub type NumericVector   = Vector<REALSXP, f64,  f64>;
pub type CharacterVector = Vector<STRSXP,  SEXP, String>;
pub type RawVector       = Vector<RAWSXP,  u8,   u8>;
pub type List            = Vector<VECSXP,  SEXP, SEXP>;

// Methods common to all R vectors.
impl<const SEXPTYPE: u32, ElementType, NativeType>
    Vector<{ SEXPTYPE }, ElementType, NativeType>
{

    pub fn new(object: RObject) -> Result<Self> {
        r_assert_type(*object, &[SEXPTYPE])?;
        Ok(Vector::<{ SEXPTYPE }, ElementType, NativeType> { object, phantom: PhantomData })
    }

    fn new_unchecked(object: RObject) -> Self {
        Vector::<{ SEXPTYPE }, ElementType, NativeType> { object, phantom: PhantomData }
    }

    pub unsafe fn of_length(size: usize) -> Self {
        let data = Rf_allocVector(SEXPTYPE, size as isize);
        let object = RObject::new(data);
        Vector::<{ SEXPTYPE }, ElementType, NativeType> { object, phantom: PhantomData }
    }

    pub fn len(&self) -> usize {
        unsafe { Rf_length(*self.object) as usize }
    }

    pub fn cast(self) -> RObject {
        self.object
    }

    pub fn data(&self) -> SEXP {
        self.object.sexp
    }

}

impl<const SEXPTYPE: u32, ElementType, NativeType>
    Vector<{ SEXPTYPE }, ElementType, NativeType>
    where
        (ElementType, NativeType): TypesEqual,
        NativeType: Copy,
{
    pub unsafe fn create(data: &[NativeType]) -> Self {
        let vector = Vector::of_length(data.len());
        let pointer = DATAPTR(*vector) as *mut NativeType;
        pointer.copy_from(data.as_ptr(), data.len());
        vector
    }

    pub fn get(&self, index: isize) -> Result<NativeType> {
        unsafe {
            r_assert_capacity(self.data(), index as u32)?;
            let pointer = DATAPTR(*self.object) as *mut NativeType;
            let offset = pointer.offset(index);
            Ok(*offset)
        }
    }
}

impl CharacterVector {

    pub unsafe fn create<T: AsRef<str>>(data: &[T]) -> Self {
        let n = data.len();
        let vector = CharacterVector::of_length(n);
        for i in 0..data.len() {
            let value = data.get_unchecked(i).as_ref();
            let charsexp = Rf_mkCharLenCE(value.as_ptr() as *const i8, value.len() as i32, cetype_t_CE_UTF8);
            SET_STRING_ELT(*vector, i as R_xlen_t, charsexp);
        }

        vector
    }

    pub fn get(&self, index: isize) -> Result<String> {
        unsafe {
            r_assert_capacity(self.data(), index as u32)?;
            let data = *self.object;
            let cstr = Rf_translateCharUTF8(STRING_ELT(data, index));
            let bytes = CStr::from_ptr(cstr).to_bytes();
            Ok(std::str::from_utf8_unchecked(bytes).to_string())
        }
    }

}

// Traits.
impl<const SEXPTYPE: u32, ElementType, NativeType> Deref
    for Vector<{ SEXPTYPE }, ElementType, NativeType>
{
    type Target = SEXP;

    fn deref(&self) -> &Self::Target {
        &*self.object
    }
}

impl<const SEXPTYPE: u32, ElementType, NativeType> DerefMut
    for Vector<{ SEXPTYPE }, ElementType, NativeType>
{
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut *self.object
    }
}

impl<const SEXPTYPE: u32, ElementType, NativeType> From<&[ElementType]>
    for Vector<{ SEXPTYPE }, ElementType, NativeType>
    where (ElementType, NativeType) : TypesEqual,
{
    fn from(array: &[ElementType]) -> Self {
        unsafe {

            let object = Rf_allocVector(SEXPTYPE, array.len() as isize);
            let pointer = DATAPTR(object) as *mut ElementType;
            pointer.copy_from(array.as_ptr(), array.len());

            let object = RObject::new(object);
            Vector::new_unchecked(object)

        }
    }
}

impl<const SEXPTYPE: u32, ElementType, NativeType> TryFrom<SEXP>
    for Vector<{ SEXPTYPE }, ElementType, NativeType>
{
    type Error = crate::error::Error;

    fn try_from(value: SEXP) -> std::result::Result<Self, Self::Error> {
        let object = unsafe { RObject::new(value) };
        Vector::new(object)
    }

}

impl<const SEXPTYPE: u32, ElementType, NativeType> TryFrom<RObject>
    for Vector<{ SEXPTYPE }, ElementType, NativeType>
{
    type Error = crate::error::Error;

    fn try_from(value: RObject) -> std::result::Result<Self, Self::Error> {
        Vector::new(value)
    }

}

impl<const SEXPTYPE: u32, ElementType, NativeType> Into<RObject>
    for Vector<{ SEXPTYPE }, ElementType, NativeType>
{
    fn into(self) -> RObject {
        self.object
    }
}

impl<const SEXPTYPE: u32, ElementType, NativeType> IntoIterator
    for Vector<{ SEXPTYPE }, ElementType, NativeType>
    where (ElementType, NativeType): TypesEqual
{
    type Item = NativeType;
    type IntoIter = std::vec::IntoIter<NativeType>;

    fn into_iter(self) -> Self::IntoIter {
        let ptr: *mut NativeType = unsafe { DATAPTR(*self) as *mut NativeType };
        let n = self.len() as usize;
        let vector = unsafe { Vec::from_raw_parts(ptr, n, n) };
        vector.into_iter()
    }

}

impl IntoIterator for CharacterVector {
    type Item = String;
    type IntoIter = std::vec::IntoIter<String>;

    fn into_iter(self) -> Self::IntoIter {
        let vector = unsafe { self.object.to::<Vec<String>>().unwrap() };
        vector.into_iter()
    }

}

// Some specializations.

impl<T> From<&[T]> for CharacterVector where T: AsRef<str> {

    fn from(array: &[T]) -> Self {

        unsafe {
            let vector = CharacterVector::of_length(array.len());
            let data = *vector;
            for i in 0..array.len() {
                let value = array.get_unchecked(i).as_ref();
                let elt = r_char!(value);
                SET_STRING_ELT(data, i as isize, elt)
            }
            vector
        }
    }

}

impl From<&str> for CharacterVector {
    fn from(value: &str) -> Self {
        Self::from(std::slice::from_ref(&value))
    }
}

impl<const N: usize> From<&[&str; N]> for CharacterVector {
    fn from(array: &[&str; N]) -> Self {
        CharacterVector::from(array.as_slice())
    }
}

#[cfg(test)]
mod tests {
    use crate::r_test;
    use crate::vector::CharacterVector;


    #[test]
    fn test_character_vector() { r_test! {

        let vector = CharacterVector::from(&["hello", "world"]);

        let mut iterator = vector.into_iter();

        let value = iterator.next();
        assert!(value.is_some());
        assert!(value.unwrap() == "hello");

        let value = iterator.next();
        assert!(value.is_some());
        assert!(value.unwrap() == "world");

        let value = iterator.next();
        assert!(value.is_none());

    } }
}
